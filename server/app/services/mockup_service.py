from __future__ import annotations
from typing import List, Tuple
from pathlib import Path
import json
from io import BytesIO
from PIL import Image

# Reuse logic similar to back/mockup_builder.py but return bytes only

# Centralized resources under server/app/resources/mockups
APP_DIR = Path(__file__).resolve().parents[1]
RES_DIR = APP_DIR / "resources" / "mockups"
CONFIG_PATH = RES_DIR / "config.json"


def _fit_cover_center(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    sw, sh = img.size
    scale = max(target_w / sw, target_h / sh)
    new_w, new_h = int(sw * scale), int(sh * scale)
    img_resized = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    right = left + target_w
    bottom = top + target_h
    return img_resized.crop((left, top, right, bottom))


def _ensure_rgba(im: Image.Image) -> Image.Image:
    return im.convert("RGBA") if im.mode != "RGBA" else im


def _load_image(path_str: str) -> Image.Image:
    p = Path(path_str)
    if not p.is_absolute():
        p = RES_DIR / path_str
    if not p.exists():
        raise FileNotFoundError(f"File not found in resources: {path_str} (looked under {RES_DIR})")
    im = Image.open(p)
    return im.convert("RGB") if im.mode not in ("RGB", "RGBA") else im


def build_mockups(product_image_bytes: bytes) -> List[Tuple[str, bytes]]:
    """Compose mockups defined in server/app/resources/mockups/config.json and return list of (filename, bytes)."""
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    quality = int(cfg.get("jpeg_quality", 92))

    product = Image.open(BytesIO(product_image_bytes))

    out: List[Tuple[str, bytes]] = []
    for item in cfg["mockups"]:
        name = item["name"]
        bg_path = item["background_path"]
        overlay_path = item.get("overlay_path")
        placement = item["placement"]
        # Target output file name (relative path kept inside zip only)
        out_path = item.get("output") or f"mockups/output/{name}.jpg"

        bg = _load_image(bg_path)
        bg = _ensure_rgba(bg)

        overlay = None
        if overlay_path:
            overlay = _load_image(overlay_path)
            overlay = _ensure_rgba(overlay)

        prod_rgba = _ensure_rgba(product)
        x, y = placement["x"], placement["y"]
        w, h = placement["width"], placement["height"]
        fitted = _fit_cover_center(prod_rgba, w, h)

        canvas = _ensure_rgba(bg)
        canvas.alpha_composite(_ensure_rgba(fitted), dest=(x, y))
        if overlay is not None:
            canvas = Image.alpha_composite(canvas, _ensure_rgba(overlay))

        result_rgb = canvas.convert("RGB")
        buf = BytesIO()
        result_rgb.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
        out.append((Path(out_path).name, buf.getvalue()))

    return out
