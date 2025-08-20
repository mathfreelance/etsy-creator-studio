#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Upscale 2x via ImgUpscaler (imglarger) non-officiel.
Requêtes utilisées (déduites du navigateur) :
- POST https://get1.imglarger.com/api/UpscalerNew/UploadNew  (multipart: myfile, scaleRadio)
- POST https://get1.imglarger.com/api/UpscalerNew/CheckStatusNew (form/json: code, scaleRadio)
- GET  downloadUrls[0] quand status == "success"
"""

import time
import argparse
import mimetypes
from pathlib import Path
import requests
from PIL import Image  # <-- pour forcer les DPI

UPLOAD_URL = "https://get1.imglarger.com/api/UpscalerNew/UploadNew"
STATUS_URL = "https://get1.imglarger.com/api/UpscalerNew/CheckStatusNew"

# Quelques en-têtes pour mimer le navigateur (souvent utiles si le serveur est tatillon).
DEFAULT_HEADERS = {
    "Origin": "https://fr.imgupscaler.com",
    "Referer": "https://fr.imgupscaler.com/",
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
}


class UpscaleError(Exception):
    pass


def _force_dpi_300_inplace(img_path: Path) -> None:
    """
    Ouvre le fichier et le réenregistre au même emplacement avec une métadonnée 300 DPI.
    (Note: pour un JPEG, cela réencode l'image.)
    """
    # Pillow choisit le format selon l'extension; on garde la même extension.
    with Image.open(img_path) as im:
        format_hint = (img_path.suffix or "").lstrip(".").upper()  # "JPG", "PNG", etc.
        save_kwargs = {"dpi": (300, 300)}
        if format_hint in {"JPG", "JPEG"}:
            # Qualité raisonnable pour limiter la perte lors du ré-encodage
            save_kwargs.update({"quality": 95, "subsampling": 0, "optimize": True, "progressive": True})
            im = im.convert("RGB")  # sécurité pour JPEG
        im.save(img_path, **save_kwargs)


def upscale_image(
    input_path: str,
    scale: int = 2,
    output_path: str | None = None,
    poll_interval: float = 5.0,
    timeout: float = 300.0,
    session: requests.Session | None = None,
) -> Path:
    """
    Envoie `input_path` à ImgUpscaler (2x ou 4x selon `scale`), poll jusqu'au succès,
    télécharge l'image finale puis la réécrit en place avec un tag 300 DPI.
    Retourne le chemin du fichier final (unique).

    :param input_path: chemin du fichier source (png/jpg/webp, etc.)
    :param scale: 2 ou 4 (conforme au paramètre `scaleRadio` vu dans DevTools)
    :param output_path: chemin de sortie (optionnel). Si None, auto-généré.
    :param poll_interval: secondes entre deux checks de statut
    :param timeout: délai max total (secondes)
    """
    if scale not in (2, 4):
        raise ValueError("`scale` doit être 2 ou 4 (valeurs supportées par `scaleRadio`).")

    inp = Path(input_path)
    if not inp.is_file():
        raise FileNotFoundError(f"Fichier introuvable: {inp}")

    sess = session or requests.Session()
    sess.headers.update(DEFAULT_HEADERS)

    # 1) Upload
    guessed_type = mimetypes.guess_type(inp.name)[0] or "application/octet-stream"
    with inp.open("rb") as f:
        files = {"myfile": (inp.name, f, guessed_type)}
        data = {"scaleRadio": str(scale)}
        r = sess.post(UPLOAD_URL, files=files, data=data, timeout=60)
    r.raise_for_status()
    jr = r.json()
    if jr.get("code") != 200 or "data" not in jr or "code" not in jr["data"]:
        raise UpscaleError(f"Réponse upload inattendue: {jr}")

    job_code = jr["data"]["code"]

    # 2) Polling
    start = time.time()
    status = None
    last_payload = None

    def _check_status(sess, job_code, scale):
        payload = {"code": job_code, "scaleRadio": str(scale)}
        # 1er essai : JSON
        r = sess.post(
            STATUS_URL,
            json=payload,
            headers={"Content-Type": "application/json; charset=UTF-8"},
            timeout=30,
        )
        if r.status_code == 415:
            # 2e essai : x-www-form-urlencoded
            r = sess.post(
                STATUS_URL,
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
                timeout=30,
            )
        r.raise_for_status()
        return r.json()

    while time.time() - start < timeout:
        pj = _check_status(sess, job_code, scale)
        last_payload = pj

        if pj.get("code") != 200 or "data" not in pj:
            raise UpscaleError(f"Réponse status inattendue: {pj}")

        d = pj["data"]
        status = d.get("status")

        if status == "success":
            urls = d.get("downloadUrls") or []
            if not urls:
                raise UpscaleError(f"Aucune URL de téléchargement dans: {pj}")
            download_url = urls[0]

            dr = sess.get(download_url, stream=True, timeout=120)
            dr.raise_for_status()

            ext = "." + (d.get("imagemimetype") or "jpg").lstrip(".")
            # un seul fichier final, on garde le nom demandé par l'utilisateur si fourni
            if output_path:
                out = Path(output_path)
                if out.suffix == "":
                    out = out.with_suffix(ext)
            else:
                # sinon: <nom-source>_<factor>x.<ext renvoyée> (comportement précédent)
                suggested_name = Path(d.get("originalfilename") or inp.stem).stem + f"_{scale}x{ext}"
                out = inp.with_name(suggested_name)

            # Téléchargement du fichier (brut)
            with out.open("wb") as out_f:
                for chunk in dr.iter_content(chunk_size=1 << 16):
                    if chunk:
                        out_f.write(chunk)

            # Forcer les DPI à 300 (en place) -> un seul résultat final
            _force_dpi_300_inplace(out)
            return out

        elif status in {"waiting", "processing", "queued"}:
            time.sleep(poll_interval)
        elif status in {"failed", "error"}:
            raise UpscaleError(f"Tâche en échec: {pj}")
        else:
            time.sleep(poll_interval)

    raise UpscaleError(f"Timeout après {timeout}s. Dernier statut: {status} // payload: {last_payload}")


def main():
    parser = argparse.ArgumentParser(description="Upscale 2x/4x via ImgUpscaler (API non officielle).")
    parser.add_argument("input", help="Chemin de l'image source (png/jpg/webp...).")
    parser.add_argument("-s", "--scale", type=int, default=2, choices=[2, 4], help="Facteur d'agrandissement (2 ou 4).")
    parser.add_argument("-o", "--output", default=None, help="Chemin de sortie (optionnel).")
    parser.add_argument("--poll", type=float, default=5.0, help="Intervalle de polling en secondes.")
    parser.add_argument("--timeout", type=float, default=300.0, help="Délai max en secondes.")
    args = parser.parse_args()

    out = upscale_image(
        input_path=args.input,
        scale=args.scale,
        output_path=args.output,
        poll_interval=args.poll,
        timeout=args.timeout,
    )
    print(f"✅ Fichier final (300 DPI): {out.resolve()}")


if __name__ == "__main__":
    main()
