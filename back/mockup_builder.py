import json
from pathlib import Path
from PIL import Image

CONFIG_PATH = Path("mockups/config.json")

def fit_cover_center(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """
    Redimensionne l'image pour couvrir entièrement (cover) la zone (target_w x target_h),
    en conservant le ratio et en centrant. Coupe l'excédent en haut/bas ou gauche/droite.
    """
    sw, sh = img.size
    scale = max(target_w / sw, target_h / sh)  # cover => max
    new_w, new_h = int(sw * scale), int(sh * scale)
    img_resized = img.resize((new_w, new_h), Image.LANCZOS)

    # Crop centré à la taille exacte
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    right = left + target_w
    bottom = top + target_h
    return img_resized.crop((left, top, right, bottom))

def ensure_rgba(im: Image.Image) -> Image.Image:
    return im.convert("RGBA") if im.mode != "RGBA" else im

def compose_mockup(bg: Image.Image, product: Image.Image, placement: dict, overlay: Image.Image | None) -> Image.Image:
    """
    Place 'product' dans 'bg' à la zone 'placement' (x,y,width,height) en mode cover centré.
    Puis applique l'overlay (cadre) par-dessus si fourni.
    """
    x, y = placement["x"], placement["y"]
    w, h = placement["width"], placement["height"]

    # Prépare le produit à la taille de la zone
    product_fitted = fit_cover_center(product, w, h)

    # Assure-toi que le background est RGBA pour une composition propre
    canvas = ensure_rgba(bg)

    # Colle l'image produit dans la zone
    canvas.alpha_composite(ensure_rgba(product_fitted), dest=(x, y))

    # Applique le cadre/overlay (avec alpha) si présent
    if overlay is not None:
        canvas = Image.alpha_composite(canvas, ensure_rgba(overlay))

    return canvas

def load_image(path_str: str) -> Image.Image:
    p = Path(path_str)
    if not p.exists():
        raise FileNotFoundError(f"Fichier introuvable: {p}")
    im = Image.open(p)
    # Convertir en sRGB si nécessaire (Pillow ne gère pas les profils ICC avancés sans plug-ins;
    # pour notre cas, un simple convert RGB suffit)
    return im.convert("RGB") if im.mode not in ("RGB","RGBA") else im

def main():
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    input_img_path = cfg["input_image"]
    quality = int(cfg.get("jpeg_quality", 92))

    product = load_image(input_img_path)

    for item in cfg["mockups"]:
        name = item["name"]
        bg_path = item["background_path"]
        overlay_path = item.get("overlay_path")
        placement = item["placement"]
        out_path = Path(item["output"])
        out_path.parent.mkdir(parents=True, exist_ok=True)

        bg = load_image(bg_path)
        # Si background est RGB, on veut un canvas RGBA pour alpha_composite
        bg = ensure_rgba(bg)

        overlay = None
        if overlay_path:
            overlay = Image.open(overlay_path)
            overlay = ensure_rgba(overlay)

        # IMPORTANT : le produit doit être RGBA pour alpha_composite
        prod_rgba = ensure_rgba(product)

        # Compose
        result = compose_mockup(bg, prod_rgba, placement, overlay)

        # Sauvegarde (converti en RGB pour JPEG)
        result_rgb = result.convert("RGB")
        result_rgb.save(out_path, "JPEG", quality=quality, optimize=True, progressive=True)
        print(f"✅ {name} -> {out_path}")

if __name__ == "__main__":
    main()
