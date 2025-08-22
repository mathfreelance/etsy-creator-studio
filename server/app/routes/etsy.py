from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, HTMLResponse
from typing import Optional, List, Annotated

from ..services import etsy_service as etsy

router = APIRouter(prefix="/etsy", tags=["etsy"])


@router.get("/auth/start")
def etsy_auth_start():
    """Return the Etsy OAuth URL for the client to redirect the user to."""
    try:
        url, state = etsy.build_auth_url()
        return {"url": url, "state": state}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auth/callback")
def etsy_auth_callback(request: Request):
    """Handle OAuth callback from Etsy. Exchanges code for tokens and closes the window."""
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")

    verifier: Optional[str] = None
    if state:
        verifier = etsy.pop_code_verifier(state)

    try:
        etsy.exchange_code_for_token(code, verifier)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OAuth failed: {e}")

    # Simple HTML that notifies opener and closes the window
    html = """
    <!doctype html>
    <html>
      <head><meta charset=\"utf-8\"><title>Etsy Connected</title></head>
      <body>
        <script>
          try {
            if (window.opener) {
              window.opener.postMessage({ type: 'etsyConnected', ok: true }, '*');
            }
          } catch (e) {}
          window.close();
        </script>
        <p>Etsy connection complete. You can close this window.</p>
      </body>
    </html>
    """
    return HTMLResponse(content=html)


@router.get("/auth/status")
def etsy_auth_status():
    """Return whether the current session has valid Etsy auth tokens.

    This will attempt to obtain auth headers, which refreshes tokens if needed.
    If no valid token is available, returns connected=False.
    """
    try:
        etsy.get_auth_headers()
        return {"connected": True}
    except Exception:
        return {"connected": False}


@router.get("/prefs")
def get_prefs():
    """Return saved Etsy preferences (shop_id, taxonomy_id) from JSON store only.

    No .env fallback. If not set, values are empty strings.
    """
    try:
        return etsy.get_prefs()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prefs")
async def set_prefs(request: Request):
    """Update and persist Etsy preferences. Accepts JSON body with shop_id and/or taxonomy_id."""
    try:
        data = await request.json()
        shop_id = (data or {}).get("shop_id")
        taxonomy_id = (data or {}).get("taxonomy_id")
        saved = etsy.set_prefs(shop_id=shop_id, taxonomy_id=taxonomy_id)
        return saved
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/listings/draft")
async def create_draft_listing(request: Request):
    """Create an Etsy draft listing, upload media, and attach the digital file.

    Expects multipart/form-data. If 'image' is not provided, uses 'processed' for the listing image as well.
    Enforces a 20 MB limit for the digital file. If 'processed' is missing, falls back to 'image' for the digital file.
    """
    try:
        form = await request.form()

        # Files
        processed = form.get("processed")
        image = form.get("image")
        mockups = []
        try:
            mockups = form.getlist("mockups") or []
        except Exception:
            mockups = []
        video = form.get("video")

        # Text/meta
        title = form.get("title")
        description = form.get("description")
        tags = form.get("tags")
        price = form.get("price")
        quantity = form.get("quantity")
        taxonomy_id = form.get("taxonomy_id")
        shop_id = form.get("shop_id")
        materials = form.get("materials")
        orientation = form.get("orientation")
        pieces_included = form.get("pieces_included")
        alt_seo = form.get("alt_seo")

        # Read bytes
        processed_bytes: Optional[bytes] = None
        if processed is not None:
            try:
                processed_bytes = await processed.read()
            except TypeError:
                # Fallback if object isn't awaitable (shouldn't happen with Starlette UploadFile)
                processed_bytes = processed.file.read() if hasattr(processed, "file") else None
            if not processed_bytes:
                processed_bytes = None

        image_bytes: bytes = b""
        img_ct: str = "image/png"
        if image is not None:
            try:
                image_bytes = await image.read()
            except TypeError:
                image_bytes = image.file.read() if hasattr(image, "file") else b""
            img_ct = getattr(image, "content_type", None) or "image/png"

        # Determine digital payload and validate size
        digital_bytes = processed_bytes or image_bytes
        if not digital_bytes:
            raise HTTPException(status_code=400, detail="Missing file: 'processed' or 'image' is required")
        if len(digital_bytes) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Digital file exceeds 20 MB limit")

        # Defaults: uses persisted prefs for IDs; price/quantity from defaults
        defaults = etsy.get_defaults()
        price = price or defaults["price"]
        quantity = quantity or defaults["quantity"]
        taxonomy_id = taxonomy_id or defaults["taxonomy_id"]
        shop_id = shop_id or defaults["shop_id"]
        if not taxonomy_id or not shop_id:
            raise HTTPException(status_code=400, detail="shop_id ou taxonomy_id manquant. Configure-les dans les Préférences (POST /etsy/prefs).")
        # Merge provided materials with defaults (deduplicated)
        mats_default = [m.strip() for m in (defaults.get("materials") or "").split(",") if m.strip()]
        mats_user = [m.strip() for m in (materials or "").split(",") if m.strip()]
        seen = set()
        merged_mats: List[str] = []
        for m in (mats_user + mats_default):
            key = m.lower()
            if key not in seen:
                seen.add(key)
                merged_mats.append(m)
        materials = ", ".join(merged_mats) if merged_mats else None
        orientation = (orientation or defaults.get("orientation") or "vertical").lower()
        pieces_included = pieces_included or defaults.get("pieces_included") or "1"

        # Minimal fallbacks for texts
        title = title or "Digital Download"
        description = description or "High-resolution digital download."
        tags = tags or "digital,download,printable"

        # Create draft listing
        listing = etsy.create_draft_listing(
            title=title,
            description=description,
            tags=tags,
            price=price,
            quantity=quantity,
            taxonomy_id=taxonomy_id,
            materials=materials,
            shop_id=shop_id,
        )
        listing_id = int(listing.get("listing_id") or listing.get("listing", {}).get("listing_id"))

        # Do NOT upload 'image' or 'processed' as listing photos.
        # Only upload mockups below.

        # Ensure type is digital
        etsy.ensure_download_type(listing_id, shop_id=shop_id)

        # Upload listing photos from mockups only (max 10 images)
        if mockups:
            rank = 1
            for i, mf in enumerate(mockups[:9]):
                try:
                    mb: bytes = b""
                    try:
                        mb = await mf.read()
                    except TypeError:
                        mb = mf.file.read() if hasattr(mf, "file") else b""
                    if not mb:
                        continue
                    etsy.upload_listing_image(
                        listing_id,
                        mb,
                        filename=getattr(mf, "filename", f"mockup-{i+1}.png"),
                        shop_id=shop_id,
                        rank=rank,
                        content_type=getattr(mf, "content_type", None) or "image/png",
                        alt_text=(alt_seo or title or "")[:500],
                    )
                    rank += 1
                    if rank > 10:
                        break
                except Exception:
                    continue

        # Ensure type is digital
        etsy.ensure_download_type(listing_id, shop_id=shop_id)

        # Upload the digital file using computed payload
        digital_name = "processed.png" if processed_bytes else "image.png"
        etsy.upload_listing_file(listing_id, digital_bytes, filename=digital_name, shop_id=shop_id)

        # Upload video if provided
        if video is not None:
            try:
                vb: bytes = b""
                try:
                    vb = await video.read()
                except TypeError:
                    vb = video.file.read() if hasattr(video, "file") else b""
                if vb:
                    etsy.upload_listing_video(
                        listing_id,
                        vb,
                        filename=getattr(video, "filename", "preview.mp4"),
                        shop_id=shop_id,
                    )
            except Exception:
                pass

        # Apply listing properties (orientation, pieces) best-effort
        try:
            etsy.apply_orientation_and_pieces(
                listing_id,
                taxonomy_id,
                orientation=orientation,
                pieces_included=pieces_included,
                shop_id=shop_id,
            )
        except Exception:
            pass

        # No SKU/inventory update
        return {"ok": True, "listing_id": listing_id, "listing": listing}

    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
