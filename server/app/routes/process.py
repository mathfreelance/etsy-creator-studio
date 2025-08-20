from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any
from io import BytesIO
import os
import json
from PIL import Image

from ..services.enhancer_service import enhance_image_bytes, ensure_dpi_bytes
from ..services.mockup_service import build_mockups
from ..services.video_service import build_preview_video
from ..services.text_service import generate_texts
from ..utils.zipper import build_zip_bytes

router = APIRouter(tags=["process"])

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

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload")

    files: List[tuple[str, bytes]] = []
    manifest: Dict[str, Any] = {
        "dpi": dpi,
        "enhance": enhance,
        "upscale": upscale,
        "mockups": mockups,
        "video": video,
        "texts": texts,
        "generated": [],
    }

    # 1) Enhance / ensure DPI
    try:
        if enhance:
            processed = enhance_image_bytes(raw, scale=upscale, dpi=dpi)
            manifest["generated"].append({"type": "enhanced_image"})
        else:
            processed = ensure_dpi_bytes(raw, dpi)
            manifest["generated"].append({"type": "dpi_image"})
        # Normalize to PNG with requested DPI for consistency in the ZIP
        try:
            im = Image.open(BytesIO(processed))
            out_png_io = BytesIO()
            im.save(out_png_io, "PNG", dpi=(dpi, dpi))
            processed_png = out_png_io.getvalue()
        except Exception:
            processed_png = processed
        files.append(("image/processed.png", processed_png))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Enhance/DPI failed: {e}")

    mockup_bytes: List[bytes] = []

    # 2) Mockups
    if mockups:
        try:
            mocks = build_mockups(processed_png)
            for path_name, bytes_ in mocks:
                files.append((f"mockups/{path_name}", bytes_))
                mockup_bytes.append(bytes_)
            manifest["generated"].append({"type": "mockups", "count": len(mocks)})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Mockups failed: {e}")

    # 3) Video
    if video:
        try:
            frames = mockup_bytes if mockup_bytes else [processed_png, processed_png, processed_png]
            mp4 = build_preview_video(frames)
            files.append(("video/preview.mp4", mp4))
            manifest["generated"].append({"type": "video"})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Video failed: {e}")

    # 4) Texts
    if texts:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")
        try:
            payload = generate_texts(processed_png)
            files.append((
                "texts/etsy_metadata.json",
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            ))
            manifest["generated"].append({"type": "texts", "fields": [k for k in payload.keys()]})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Texts failed: {e}")

    # 5) Manifest
    files.append((
        "manifest.json",
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ))

    zip_bytes = build_zip_bytes(files)

    return StreamingResponse(iter([zip_bytes]), media_type="application/zip", headers={
        "Content-Disposition": "attachment; filename=package.zip"
    })

