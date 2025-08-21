from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any, Tuple
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

@router.post("/process")
async def process(
    image: UploadFile = File(...),
    dpi: int = Form(300),
    enhance: bool = Form(False),
    upscale: int = Form(2),
    mockups: bool = Form(False),
    video: bool = Form(False),
    texts: bool = Form(False),
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

    files: List[Tuple[str, bytes]] = []
    manifest: Dict[str, Any] = {
        "dpi": dpi,
        "enhance": enhance,
        "upscale": upscale,
        "mockups": mockups,
        "video": video,
        "texts": texts,
        "generated": [],
    }

    logger.info(
        f"[process] start filename={getattr(image, 'filename', None)} dpi={dpi} "
        f"enhance={enhance} upscale={upscale} mockups={mockups} video={video} texts={texts}"
    )

    # Start text generation early (from raw input) in parallel with image processing
    texts_task = None
    if texts:
        if not os.getenv("OPENAI_API_KEY"):
            raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")
        logger.info("[process] starting text generation (from raw input)…")
        texts_task = asyncio.create_task(asyncio.to_thread(generate_texts, raw))

    # 1) Enhance / ensure DPI
    try:
        t0 = time.perf_counter()
        if enhance:
            processed = await asyncio.to_thread(enhance_image_bytes, raw, upscale, dpi)
            manifest["generated"].append({"type": "enhanced_image"})
            logger.info(f"[process] enhance x{upscale} done in {time.perf_counter()-t0:.2f}s")
        else:
            processed = await asyncio.to_thread(ensure_dpi_bytes, raw, dpi)
            manifest["generated"].append({"type": "dpi_image"})
            logger.info(f"[process] ensure_dpi({dpi}) done in {time.perf_counter()-t0:.2f}s")

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

    # 2) Kick off mockups (and texts already running) in parallel, then do video (depends on mockups)
    mockup_bytes: List[bytes] = []

    mockups_task = None
    # texts_task already started earlier if requested

    if mockups:
        logger.info("[process] starting mockups generation…")
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
        except Exception as e:
            logger.exception("[process] Mockups failed")
            raise HTTPException(status_code=500, detail=f"Mockups failed: {e}")

    # 3) Video (after mockups)
    if video:
        t_v = time.perf_counter()
        try:
            frames = mockup_bytes if mockup_bytes else [processed_png, processed_png, processed_png]
            mp4 = await asyncio.to_thread(build_preview_video, frames)
            files.append(("video/preview.mp4", mp4))
            manifest["generated"].append({"type": "video"})
            logger.info(f"[process] video generated in {time.perf_counter()-t_v:.2f}s")
        except Exception as e:
            logger.exception("[process] Video failed")
            raise HTTPException(status_code=500, detail=f"Video failed: {e}")

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
        except Exception as e:
            logger.exception("[process] Texts failed")
            raise HTTPException(status_code=500, detail=f"Texts failed: {e}")

    # 5) Manifest
    files.append((
        "manifest.json",
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ))

    t_zip = time.perf_counter()
    zip_bytes = await asyncio.to_thread(build_zip_bytes, files)
    logger.info(f"[process] zip built with {len(files)} files in {time.perf_counter()-t_zip:.2f}s; total={time.perf_counter()-t_start:.2f}s")

    return StreamingResponse(iter([zip_bytes]), media_type="application/zip", headers={
        "Content-Disposition": "attachment; filename=package.zip"
    })

