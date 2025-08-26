from __future__ import annotations
from io import BytesIO
from typing import Optional
from PIL import Image
import time
import requests


def ensure_dpi_bytes(image_bytes: bytes, dpi: int = 300, format_hint: Optional[str] = None) -> bytes:
    """Force DPI metadata by re-encoding in-memory.
    Defaults to JPEG output (smaller transfer) unless format_hint is provided
    ("PNG"/"JPEG"/...). For JPEG, alpha is flattened onto black to avoid
    black artifacts.
    """
    im = Image.open(BytesIO(image_bytes))
    out = BytesIO()
    fmt = (format_hint or im.format or "JPEG").upper()
    save_kwargs = {"dpi": (dpi, dpi)}
    if fmt in {"JPG", "JPEG"}:
        # Flatten alpha onto black background to avoid black where transparency exists
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            base = Image.new("RGB", im.size, (0, 0, 0))
            if im.mode != "RGBA":
                im = im.convert("RGBA")
            base.paste(im, mask=im.split()[-1])
            im = base
        else:
            im = im.convert("RGB")
        save_kwargs.update({"quality": 95, "subsampling": 0, "optimize": True, "progressive": True})
        fmt = "JPEG"
    im.save(out, fmt, **save_kwargs)
    return out.getvalue()


def enhance_image_bytes(image_bytes: bytes, scale: int = 2, dpi: int = 300) -> bytes:
    """Upscale using ImgUpscaler (imglarger) API directly with in-memory bytes."""
    if scale not in (2, 4):
        raise ValueError("scale must be 2 or 4")

    UPLOAD_URL = "https://get1.imglarger.com/api/UpscalerNew/UploadNew"
    STATUS_URL = "https://get1.imglarger.com/api/UpscalerNew/CheckStatusNew"
    DEFAULT_HEADERS = {
        "Origin": "https://fr.imgupscaler.com",
        "Referer": "https://fr.imgupscaler.com/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
    }

    # Guess mime from bytes and normalize unsupported formats for the upstream service
    try:
        im = Image.open(BytesIO(image_bytes))
        fmt = (im.format or "PNG").upper()
    except Exception:
        fmt = "PNG"

    # The upstream upscaler endpoint rejects WEBP (returns code 999). Convert to PNG first.
    if fmt not in {"PNG", "JPG", "JPEG"}:
        try:
            im = Image.open(BytesIO(image_bytes))
            out_norm = BytesIO()
            # Preserve alpha if present; PNG supports transparency
            im.save(out_norm, "PNG")
            image_bytes = out_norm.getvalue()
            fmt = "PNG"
        except Exception:
            # If normalization fails, fall back to labeling as PNG to maximize compatibility
            fmt = "PNG"

    mime = "image/png" if fmt == "PNG" else ("image/jpeg" if fmt in {"JPG", "JPEG"} else "image/webp")

    sess = requests.Session()
    sess.headers.update(DEFAULT_HEADERS)

    # 1) Upload
    files = {"myfile": (f"input.{fmt.lower()}", image_bytes, mime)}
    data = {"scaleRadio": str(scale)}
    for attempt in range(2):
        try:
            r = sess.post(UPLOAD_URL, files=files, data=data, timeout=60)
            r.raise_for_status()
            break
        except requests.exceptions.Timeout:
            if attempt >= 1:
                raise
            time.sleep(2.0 * (attempt + 1))
    jr = r.json()
    if jr.get("code") != 200 or "data" not in jr or "code" not in jr["data"]:
        raise RuntimeError(f"Unexpected upload response: {jr}")
    job_code = jr["data"]["code"]

    # 2) Poll
    start = time.time()
    timeout = 300.0
    poll_interval = 5.0
    status = None
    last_payload = None

    def _check_status(sess: requests.Session, job_code: str, scale: int, retries: int = 1):
        payload = {"code": job_code, "scaleRadio": str(scale)}
        for attempt in range(retries + 1):
            try:
                rr = sess.post(
                    STATUS_URL,
                    json=payload,
                    headers={"Content-Type": "application/json; charset=UTF-8"},
                    timeout=30,
                )
                if rr.status_code == 415:
                    rr = sess.post(
                        STATUS_URL,
                        data=payload,
                        headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
                        timeout=30,
                    )
                rr.raise_for_status()
                return rr.json()
            except requests.exceptions.Timeout:
                if attempt >= retries:
                    raise
                time.sleep(2.0 * (attempt + 1))

    while time.time() - start < timeout:
        pj = _check_status(sess, job_code, scale)
        last_payload = pj
        if pj.get("code") != 200 or "data" not in pj:
            raise RuntimeError(f"Unexpected status payload: {pj}")
        d = pj["data"]
        status = d.get("status")
        if status == "success":
            urls = d.get("downloadUrls") or []
            if not urls:
                raise RuntimeError(f"No download URL in: {pj}")
            download_url = urls[0]
            # Download with one retry on timeout
            last_exc = None
            for attempt in range(2):
                try:
                    dr = sess.get(download_url, stream=True, timeout=120)
                    dr.raise_for_status()
                    chunks = []
                    for chunk in dr.iter_content(chunk_size=1 << 16):
                        if chunk:
                            chunks.append(chunk)
                    data = b"".join(chunks)
                    break
                except requests.exceptions.Timeout as e:
                    last_exc = e
                    if attempt >= 1:
                        raise
                    time.sleep(2.0 * (attempt + 1))
            # Ensure requested DPI explicitly
            if dpi:
                data = ensure_dpi_bytes(data, dpi, "JPEG")
            return data
        elif status in {"waiting", "processing", "queued"}:
            time.sleep(poll_interval)
        elif status in {"failed", "error"}:
            raise RuntimeError(f"Upscale task failed: {pj}")
        else:
            time.sleep(poll_interval)

    raise RuntimeError(f"Upscale timeout after {timeout}s. Last status: {status} // payload: {last_payload}")
