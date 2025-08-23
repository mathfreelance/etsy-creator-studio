from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any, Tuple, Set, AsyncGenerator
from io import BytesIO
import os
import json
from PIL import Image
import asyncio
import time
import logging

from ..services.enhancer_service import enhance_image_bytes, ensure_dpi_bytes
from ..services.mockup_service import build_mockups
from ..services.video_service import build_preview_video
from ..services.text_service import generate_texts
from ..utils.zipper import build_zip_bytes

router = APIRouter(tags=["process"])
logger = logging.getLogger("uvicorn.error")

# In-memory progress channels keyed by request id (rid)
_PROG_CHANNELS: Dict[str, Set[asyncio.Queue]] = {}
_PROG_LOCK = asyncio.Lock()
_PROG_STATE: Dict[str, Dict[str, Any]] = {}

# In-memory cancellation flags keyed by rid
_CANCELLED_RIDS: Set[str] = set()

def _is_cancelled(rid: str | None) -> bool:
    return bool(rid and rid in _CANCELLED_RIDS)

async def _push_progress(rid: str | None, payload: Dict[str, Any]) -> None:
    """Push a progress payload to all SSE subscribers for the given rid."""
    if not rid:
        return
    try:
        async with _PROG_LOCK:
            # Record last-known state for replay on late subscribers
            st = _PROG_STATE.setdefault(rid, {"steps": {}, "done": False, "error": None})
            if isinstance(payload, dict):
                ev = payload.get("event")
                if ev == "step" and payload.get("step") and payload.get("status"):
                    st["steps"][payload["step"]] = payload["status"]
                elif ev == "done":
                    st["done"] = True
                elif ev == "error":
                    st["error"] = payload
            queues = _PROG_CHANNELS.get(rid)
            if not queues:
                return
            for q in list(queues):
                try:
                    q.put_nowait(payload)
                except Exception:
                    pass
    except Exception:
        # Never let progress push break processing
        pass

@router.get("/process/stream")
async def process_stream(rid: str | None = None):
    """Server-Sent Events endpoint streaming progress for a given request id (rid)."""
    if not rid:
        raise HTTPException(status_code=400, detail="rid is required")

    async def gen() -> AsyncGenerator[str, None]:
        q: asyncio.Queue = asyncio.Queue()
        # Capture replay snapshot under lock
        replay: list[Dict[str, Any]] = []
        done_flag = False
        async with _PROG_LOCK:
            subs = _PROG_CHANNELS.setdefault(rid, set())
            subs.add(q)
            st = _PROG_STATE.get(rid)
            if st:
                # Recreate step events for last-known statuses in a deterministic order
                for step, status in st.get("steps", {}).items():
                    replay.append({"event": "step", "step": step, "status": status})
                if st.get("error"):
                    replay.append(st["error"])  # emit the error payload as-is
                if st.get("done"):
                    done_flag = True
        try:
            # Initial hello
            yield f"data: {json.dumps({'event': 'connected'})}\n\n"
            # Replay last-known statuses (if any)
            for item in replay:
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
            if done_flag:
                return
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                    if isinstance(item, dict) and item.get("event") in {"done", "error"}:
                        break
                except asyncio.TimeoutError:
                    # Keep-alive comment per SSE spec
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            async with _PROG_LOCK:
                subs = _PROG_CHANNELS.get(rid)
                if subs and q in subs:
                    subs.remove(q)
                if subs is not None and len(subs) == 0:
                    _PROG_CHANNELS.pop(rid, None)
                    _PROG_STATE.pop(rid, None)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    })

@router.post("/process/abort")
async def process_abort(rid: str | None = None):
    """Mark a running process (by rid) as cancelled.

    Frontend should pass the same rid used to start processing. Processing will
    best-effort stop at safe checkpoints.
    """
    if not rid:
        raise HTTPException(status_code=400, detail="rid is required")
    _CANCELLED_RIDS.add(rid)
    # Notify listeners
    await _push_progress(rid, {"event": "error", "step": "abort", "detail": "Cancelled by user"})
    return {"ok": True}

@router.post("/process")
async def process(
    image: UploadFile = File(...),
    dpi: int = Form(300),
    enhance: bool = Form(False),
    upscale: int = Form(2),
    mockups: bool = Form(False),
    video: bool = Form(False),
    texts: bool = Form(False),
    rid: str | None = Form(None),
    context: str | None = Form(None),
):
    """Process an uploaded image and return a ZIP package.

    Example curl:
      curl -X POST "http://localhost:8000/api/process" \
        -F "image=@/path/to/image.jpg" \
        -F "dpi=300" -F "enhance=true" -F "upscale=2" \
        -F "mockups=true" -F "video=true" -F "texts=true" \
        -o package.zip
    """
    if upscale not in (2, 4):
        raise HTTPException(status_code=400, detail="upscale must be 2 or 4")

    t_start = time.perf_counter()
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload")
    await _push_progress(rid, {"event": "started"})
    if _is_cancelled(rid):
        raise HTTPException(status_code=499, detail="Cancelled")

    files: List[Tuple[str, bytes]] = []
    manifest: Dict[str, Any] = {
        "dpi": dpi,
        "enhance": enhance,
        "upscale": upscale,
        "mockups": mockups,
        "video": video,
        "texts": texts,
        "context": context,
        "generated": [],
    }

    logger.info(
        f"[process] start filename={getattr(image, 'filename', None)} dpi={dpi} "
        f"enhance={enhance} upscale={upscale} mockups={mockups} video={video} texts={texts} has_ctx={bool(context and context.strip())}"
    )
    # Mark image step as started as soon as processing begins
    await _push_progress(rid, {"event": "step", "step": "image", "status": "started"})

    # Start text generation early (from raw input) in parallel with image processing
    texts_task = None
    if texts:
        if not os.getenv("OPENAI_API_KEY"):
            raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")
        logger.info("[process] starting text generation (from raw input)…")
        texts_task = asyncio.create_task(asyncio.to_thread(generate_texts, raw, context))
        await _push_progress(rid, {"event": "step", "step": "texts", "status": "started"})

    # 1) Enhance / ensure DPI
    try:
        t0 = time.perf_counter()
        if enhance:
            processed = await asyncio.to_thread(enhance_image_bytes, raw, upscale, dpi)
            manifest["generated"].append({"type": "enhanced_image"})
            logger.info(f"[process] enhance x{upscale} done in {time.perf_counter()-t0:.2f}s")
            await _push_progress(rid, {"event": "step", "step": "image", "status": "done", "mode": "enhance", "scale": upscale})
        else:
            processed = await asyncio.to_thread(ensure_dpi_bytes, raw, dpi)
            manifest["generated"].append({"type": "dpi_image"})
            logger.info(f"[process] ensure_dpi({dpi}) done in {time.perf_counter()-t0:.2f}s")
            await _push_progress(rid, {"event": "step", "step": "image", "status": "done", "mode": "dpi", "dpi": dpi})

        # Normalize to PNG with requested DPI for consistency in the ZIP
        t1 = time.perf_counter()
        try:
            def to_png_bytes(data: bytes, dpi_val: int) -> bytes:
                im = Image.open(BytesIO(data))
                out_png_io = BytesIO()
                im.save(out_png_io, "PNG", dpi=(dpi_val, dpi_val))
                return out_png_io.getvalue()

            processed_png = await asyncio.to_thread(to_png_bytes, processed, dpi)
        except Exception:
            processed_png = processed
        files.append(("image/processed.png", processed_png))
        logger.info(f"[process] normalize->PNG done in {time.perf_counter()-t1:.2f}s")
    except Exception as e:
        logger.exception("[process] Enhance/DPI failed")
        raise HTTPException(status_code=500, detail=f"Enhance/DPI failed: {e}")
    if _is_cancelled(rid):
        raise HTTPException(status_code=499, detail="Cancelled")

    # 2) Kick off mockups (and texts already running) in parallel, then do video (depends on mockups)
    mockup_bytes: List[bytes] = []

    mockups_task = None
    # texts_task already started earlier if requested

    if mockups:
        logger.info("[process] starting mockups generation…")
        # Mark mockups step as started when we kick off generation
        await _push_progress(rid, {"event": "step", "step": "mockups", "status": "started"})
        mockups_task = asyncio.create_task(asyncio.to_thread(build_mockups, processed_png))

    # text generation already launched at start if enabled

    # Await mockups first (video may depend on them)
    if mockups_task:
        t_m = time.perf_counter()
        try:
            mocks = await mockups_task
            for path_name, bytes_ in mocks:
                files.append((f"mockups/{path_name}", bytes_))
                mockup_bytes.append(bytes_)
            manifest["generated"].append({"type": "mockups", "count": len(mocks)})
            logger.info(f"[process] mockups generated ({len(mocks)}) in {time.perf_counter()-t_m:.2f}s")
            await _push_progress(rid, {"event": "step", "step": "mockups", "status": "done", "count": len(mocks)})
        except Exception as e:
            logger.exception("[process] Mockups failed")
            await _push_progress(rid, {"event": "error", "step": "mockups", "detail": str(e)})
            raise HTTPException(status_code=500, detail=f"Mockups failed: {e}")
        if _is_cancelled(rid):
            raise HTTPException(status_code=499, detail="Cancelled")

    # 3) Video (after mockups)
    if video:
        t_v = time.perf_counter()
        try:
            # Mark video step as started before building preview
            await _push_progress(rid, {"event": "step", "step": "video", "status": "started"})
            frames = mockup_bytes if mockup_bytes else [processed_png, processed_png, processed_png]
            mp4 = await asyncio.to_thread(build_preview_video, frames)
            files.append(("video/preview.mp4", mp4))
            manifest["generated"].append({"type": "video"})
            logger.info(f"[process] video generated in {time.perf_counter()-t_v:.2f}s")
            await _push_progress(rid, {"event": "step", "step": "video", "status": "done"})
        except Exception as e:
            logger.exception("[process] Video failed")
            await _push_progress(rid, {"event": "error", "step": "video", "detail": str(e)})
            raise HTTPException(status_code=500, detail=f"Video failed: {e}")
        if _is_cancelled(rid):
            raise HTTPException(status_code=499, detail="Cancelled")

    # 4) Texts (await if started)
    if texts_task:
        t_t = time.perf_counter()
        try:
            payload = await texts_task
            files.append((
                "texts/etsy_metadata.json",
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            ))
            manifest["generated"].append({"type": "texts", "fields": [k for k in payload.keys()]})
            logger.info(f"[process] texts generated fields={list(payload.keys())} in {time.perf_counter()-t_t:.2f}s")
            await _push_progress(rid, {"event": "step", "step": "texts", "status": "done", "fields": list(payload.keys())})
        except Exception as e:
            logger.exception("[process] Texts failed")
            await _push_progress(rid, {"event": "error", "step": "texts", "detail": str(e)})
            raise HTTPException(status_code=500, detail=f"Texts failed: {e}")
        if _is_cancelled(rid):
            raise HTTPException(status_code=499, detail="Cancelled")

    # 5) Manifest
    files.append((
        "manifest.json",
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ))

    t_zip = time.perf_counter()
    await _push_progress(rid, {"event": "step", "step": "zip", "status": "started"})
    zip_bytes = await asyncio.to_thread(build_zip_bytes, files)
    logger.info(f"[process] zip built with {len(files)} files in {time.perf_counter()-t_zip:.2f}s; total={time.perf_counter()-t_start:.2f}s")
    await _push_progress(rid, {"event": "step", "step": "zip", "status": "done", "files": len(files)})
    await _push_progress(rid, {"event": "done"})

    # Clear cancellation flag (if any)
    if rid:
        _CANCELLED_RIDS.discard(rid)

    return StreamingResponse(iter([zip_bytes]), media_type="application/zip", headers={
        "Content-Disposition": "attachment; filename=package.zip"
    })

