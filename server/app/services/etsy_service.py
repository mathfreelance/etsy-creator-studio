import os
import time
import json
import base64
import hashlib
import secrets
from typing import Dict, Optional, Tuple, List
from pathlib import Path

import requests

ETSY_API_BASE = "https://openapi.etsy.com/v3/application"
ETSY_AUTH_URL = "https://www.etsy.com/oauth/connect"
ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token"

# JSON-backed token store (single-user/dev). Replace with DB for multi-user.
_TOKEN_FILE = Path(os.getenv("ETSY_TOKEN_FILE") or (Path(__file__).resolve().parent / "resources" / "etsy_tokens.json"))


def _load_tokens_from_file() -> Dict[str, object]:
    try:
        p = _TOKEN_FILE
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            with p.open("r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
    except Exception:
        pass
    return {}


def _persist_tokens(store: Dict[str, object]) -> None:
    try:
        p = _TOKEN_FILE
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False)
    except Exception:
        # Non-fatal persistence failure shouldn't break auth flow
        pass


# Load tokens at import so they survive server restarts/page refreshes
_token_store: Dict[str, object] = _load_tokens_from_file()

# In-memory PKCE cache: state -> code_verifier
_pkce_cache: Dict[str, str] = {}


def _env(name: str, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return v


def generate_pkce_pair() -> Tuple[str, str, str]:
    """Return (state, code_verifier, code_challenge) and cache verifier by state."""
    state = secrets.token_urlsafe(16)
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(40)).decode("utf-8").rstrip("=")
    sha256 = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(sha256).decode("utf-8").rstrip("=")
    _pkce_cache[state] = code_verifier
    return state, code_verifier, code_challenge


def pop_code_verifier(state: str) -> Optional[str]:
    return _pkce_cache.pop(state, None)


def build_auth_url(redirect_uri: Optional[str] = None, scopes: Optional[str] = None, use_pkce: bool = True) -> Tuple[str, Optional[str]]:
    """Build the Etsy OAuth authorization URL. Returns (url, state) when PKCE is used; otherwise (url, None)."""
    client_id = _env("ETSY_CLIENT_ID", _env("ETSY_API_KEY", ""))
    redirect = redirect_uri or _env("ETSY_REDIRECT_URI")
    # Include transactions_r by default to allow reading sales/transactions
    scope_str = scopes or _env("ETSY_SCOPES", "listings_r listings_w shops_r transactions_r")

    params = {
        "response_type": "code",
        "redirect_uri": redirect,
        "scope": scope_str,
        "client_id": client_id,
    }

    if use_pkce:
        state, _verifier, challenge = generate_pkce_pair()
        params["state"] = state
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
        return f"{ETSY_AUTH_URL}?" + requests.compat.urlencode(params), state
    else:
        return f"{ETSY_AUTH_URL}?" + requests.compat.urlencode(params), None


def _save_tokens(data: Dict[str, object]) -> None:
    # data typically contains: access_token, refresh_token, expires_in
    _token_store["access_token"] = data.get("access_token")
    if data.get("refresh_token"):
        _token_store["refresh_token"] = data.get("refresh_token")
    # expires_in is seconds from now
    expires_in = int(data.get("expires_in", 3600))
    _token_store["expires_at"] = int(time.time()) + max(expires_in - 60, 300)  # refresh 1 min early
    _persist_tokens(_token_store)


def has_tokens() -> bool:
    return bool(_token_store.get("access_token") or _token_store.get("refresh_token"))


def exchange_code_for_token(code: str, code_verifier: Optional[str]) -> Dict[str, object]:
    client_id = _env("ETSY_CLIENT_ID", _env("ETSY_API_KEY", ""))
    client_secret = os.getenv("ETSY_CLIENT_SECRET")
    redirect_uri = _env("ETSY_REDIRECT_URI")

    data = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code": code,
    }
    # Prefer PKCE if verifier provided
    if code_verifier:
        data["code_verifier"] = code_verifier
    # Include client_secret when available (confidential app)
    if client_secret:
        data["client_secret"] = client_secret

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    resp = requests.post(ETSY_TOKEN_URL, data=data, headers=headers, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"Token exchange failed: {resp.status_code} {resp.text}")
    tokens = resp.json()
    _save_tokens(tokens)
    return tokens


def _refresh_token_if_needed() -> None:
    access_token = _token_store.get("access_token")
    expires_at = _token_store.get("expires_at", 0)
    now = int(time.time())
    if access_token and now < int(expires_at):
        return
    # refresh
    refresh_token = _token_store.get("refresh_token")
    if not refresh_token:
        # no refresh token available
        _token_store.clear()
        _persist_tokens(_token_store)
        return

    client_id = _env("ETSY_CLIENT_ID", _env("ETSY_API_KEY", ""))
    client_secret = os.getenv("ETSY_CLIENT_SECRET")

    data = {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
    }
    if client_secret:
        data["client_secret"] = client_secret

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    resp = requests.post(ETSY_TOKEN_URL, data=data, headers=headers, timeout=30)
    if resp.status_code >= 400:
        # Invalidate and let caller treat as not authenticated so UI can show reconnect
        _token_store.clear()
        _persist_tokens(_token_store)
        raise PermissionError("NOT_AUTHENTICATED")
    tokens = resp.json()
    _save_tokens(tokens)


def get_auth_headers() -> Dict[str, str]:
    _refresh_token_if_needed()
    access = _token_store.get("access_token")
    if not access:
        raise PermissionError("NOT_AUTHENTICATED")
    api_key = _env("ETSY_CLIENT_ID", _env("ETSY_API_KEY", ""))
    return {
        "Authorization": f"Bearer {access}",
        "x-api-key": api_key,
    }


def get_prefs() -> Dict[str, str]:
    """Return user preferences (shop_id, taxonomy_id) from the JSON token store.

    If taxonomy_id is missing on first run, initialize it to the default "2078" and persist it.
    """
    shop_id = str(_token_store.get("shop_id") or "")
    taxonomy_id = str(_token_store.get("taxonomy_id") or "").strip()
    if not taxonomy_id:
        taxonomy_id = "2078"
        _token_store["taxonomy_id"] = taxonomy_id
        _persist_tokens(_token_store)
    return {
        "shop_id": shop_id,
        "taxonomy_id": taxonomy_id,
    }


def set_prefs(shop_id: Optional[str] = None, taxonomy_id: Optional[str] = None) -> Dict[str, str]:
    """Persist preferences into the same JSON file as tokens."""
    changed = False
    if shop_id is not None and str(shop_id).strip():
        _token_store["shop_id"] = str(shop_id).strip()
        changed = True
    if taxonomy_id is not None and str(taxonomy_id).strip():
        _token_store["taxonomy_id"] = str(taxonomy_id).strip()
        changed = True
    if changed:
        _persist_tokens(_token_store)
    return get_prefs()


def create_draft_listing(*, title: str, description: str, tags: str, price: str, quantity: str, taxonomy_id: str, who_made: str = "i_did", when_made: str = "2020_2025", materials: Optional[str] = None, shop_id: Optional[str] = None) -> Dict[str, object]:
    headers = get_auth_headers().copy()
    headers["Content-Type"] = "application/x-www-form-urlencoded"

    # No env fallback for IDs: must be provided/persisted
    sid = shop_id or ""
    tid = taxonomy_id or ""
    if not sid:
        raise RuntimeError("Missing shop_id. Configure preferences via /etsy/prefs.")
    if not tid:
        raise RuntimeError("Missing taxonomy_id. Configure preferences via /etsy/prefs.")

    # Build as list of tuples to support repeated fields (e.g., materials[])
    form_items = [
        ("quantity", quantity),
        ("title", title),
        ("description", description),
        ("price", price),
        ("who_made", who_made),
        ("when_made", when_made),
        ("taxonomy_id", tid),
        ("tags", tags),  # comma-separated
        ("type", "download"),
        ("is_digital", "true"),
    ]
    if materials:
        # Accept comma-separated materials and send as repeated fields (array)
        mats = [m.strip() for m in materials.split(",") if m.strip()]
        for m in mats:
            form_items.append(("materials[]", m))

    url = f"{ETSY_API_BASE}/shops/{sid}/listings"
    resp = requests.post(url, headers=headers, data=form_items, timeout=60)
    if resp.status_code >= 400:
        raise RuntimeError(f"createDraftListing failed: {resp.status_code} {resp.text}")
    return resp.json()


def upload_listing_image(listing_id: int, image_bytes: bytes, filename: str, shop_id: Optional[str] = None, rank: int = 1, content_type: str = "image/jpeg", alt_text: Optional[str] = None) -> Dict[str, object]:
    headers = get_auth_headers().copy()
    sid = shop_id or ""
    if not sid:
        raise RuntimeError("Missing shop_id for upload_listing_image")
    url = f"{ETSY_API_BASE}/shops/{sid}/listings/{listing_id}/images"
    files = {
        "image": (filename, image_bytes, content_type or "image/jpeg"),
    }
    data = {"rank": str(rank)}
    if alt_text:
        # Etsy max length 500
        data["alt_text"] = alt_text[:500]
    resp = requests.post(url, headers=headers, files=files, data=data, timeout=60)
    if resp.status_code >= 400:
        raise RuntimeError(f"uploadListingImage failed: {resp.status_code} {resp.text}")
    return resp.json()


def upload_listing_file(listing_id: int, file_bytes: bytes, filename: str, shop_id: Optional[str] = None) -> Dict[str, object]:
    headers = get_auth_headers().copy()
    sid = shop_id or ""
    if not sid:
        raise RuntimeError("Missing shop_id for upload_listing_file")
    url = f"{ETSY_API_BASE}/shops/{sid}/listings/{listing_id}/files"
    files = {
        "file": (filename, file_bytes, "image/jpeg"),
    }
    # Etsy requires a user-facing name for the digital file
    data = {"name": filename}
    resp = requests.post(url, headers=headers, files=files, data=data, timeout=60)
    if resp.status_code >= 400:
        raise RuntimeError(f"uploadListingFile failed: {resp.status_code} {resp.text}")
    return resp.json()


def upload_listing_video(listing_id: int, video_bytes: bytes, filename: str, shop_id: Optional[str] = None) -> Dict[str, object]:
    headers = get_auth_headers().copy()
    sid = shop_id or ""
    if not sid:
        raise RuntimeError("Missing shop_id for upload_listing_video")
    url = f"{ETSY_API_BASE}/shops/{sid}/listings/{listing_id}/videos"
    files = {
        "video": (filename, video_bytes, "video/mp4"),
    }
    data = {"name": filename}
    resp = requests.post(url, headers=headers, files=files, data=data, timeout=120)
    if resp.status_code >= 400:
        raise RuntimeError(f"uploadListingVideo failed: {resp.status_code} {resp.text}")
    return resp.json()


def ensure_download_type(listing_id: int, shop_id: Optional[str] = None) -> None:
    headers = get_auth_headers().copy()
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    sid = shop_id or ""
    if not sid:
        raise RuntimeError("Missing shop_id for ensure_download_type")
    url = f"{ETSY_API_BASE}/shops/{sid}/listings/{listing_id}"
    data = {
        "type": "download",
        "is_digital": "true",
    }
    resp = requests.patch(url, headers=headers, data=data, timeout=30)
    if resp.status_code >= 400:
        # Some accounts may not require this; don't fail hard
        pass


def get_properties_by_taxonomy_id(taxonomy_id: str) -> Dict[str, object]:
    headers = get_auth_headers().copy()
    url = f"{ETSY_API_BASE}/seller-taxonomy/nodes/{taxonomy_id}/properties"
    resp = requests.get(url, headers=headers, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"getPropertiesByTaxonomyId failed: {resp.status_code} {resp.text}")
    return resp.json()


def update_listing_property(listing_id: int, property_id: int, values: List[str], shop_id: Optional[str] = None) -> Dict[str, object]:
    headers = get_auth_headers().copy()
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    sid = shop_id or _env("ETSY_SHOP_ID")
    url = f"{ETSY_API_BASE}/shops/{sid}/listings/{listing_id}/properties/{property_id}"
    # Send values as repeated fields
    data = [("values", v) for v in values]
    resp = requests.put(url, headers=headers, data=data, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"updateListingProperty failed: {resp.status_code} {resp.text}")
    return resp.json()


def apply_orientation_and_pieces(listing_id: int, taxonomy_id: str, orientation: str = "vertical", pieces_included: str = "1", shop_id: Optional[str] = None) -> None:
    try:
        props = get_properties_by_taxonomy_id(taxonomy_id)
        items = props if isinstance(props, list) else props.get("results") or props.get("data") or []
        orientation_prop_id = None
        orientation_value_id = None
        pieces_prop_id = None
        pieces_value_id = None

        # Normalize
        want_orientation = (orientation or "").strip().lower()
        want_pieces = (pieces_included or "1").strip()

        for p in items:
            name = (p.get("name") or p.get("property_name") or "").strip().lower()
            pid = p.get("property_id") or p.get("id")
            vals = p.get("possible_values") or p.get("values") or []
            if not pid:
                continue
            if "orientation" in name and orientation_prop_id is None:
                orientation_prop_id = int(pid)
                for v in vals:
                    vname = (v.get("name") or v.get("value_name") or "").strip().lower()
                    vid = v.get("value_id") or v.get("id")
                    if not vid:
                        continue
                    if want_orientation in vname:
                        orientation_value_id = str(vid)
                        break
            if ("pieces" in name or "number of pieces" in name) and pieces_prop_id is None:
                pieces_prop_id = int(pid)
                for v in vals:
                    vname = (v.get("name") or v.get("value_name") or "").strip().lower()
                    vid = v.get("value_id") or v.get("id")
                    if not vid:
                        continue
                    if vname.startswith(want_pieces):
                        pieces_value_id = str(vid)
                        break

        if orientation_prop_id and orientation_value_id:
            update_listing_property(listing_id, orientation_prop_id, [orientation_value_id], shop_id)
        if pieces_prop_id and pieces_value_id:
            update_listing_property(listing_id, pieces_prop_id, [pieces_value_id], shop_id)
    except Exception:
        # Non-fatal; properties vary by taxonomy and account
        pass


def update_listing_inventory(listing_id: int, price: str, quantity: str, sku: str, currency_code: str = "EUR", shop_id: Optional[str] = None) -> Dict[str, object]:
    headers = get_auth_headers().copy()
    headers["Content-Type"] = "application/json"
    sid = shop_id or ""
    if not sid:
        raise RuntimeError("Missing shop_id for update_listing_inventory")
    url = f"{ETSY_API_BASE}/shops/{sid}/listings/{listing_id}/inventory"
    # Minimal single-product inventory with one offering
    body = {
        "products": [
            {
                "sku": sku,
                "property_values": [],
                "offerings": [
                    {
                        "price": price,
                        "quantity": int(quantity),
                        "is_enabled": True,
                        "currency_code": currency_code,
                    }
                ],
            }
        ]
    }
    resp = requests.put(url, headers=headers, json=body, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"updateListingInventory failed: {resp.status_code} {resp.text}")
    return resp.json()


def get_defaults() -> Dict[str, str]:
    prefs = get_prefs()
    return {
        "shop_id": prefs.get("shop_id", ""),
        "taxonomy_id": prefs.get("taxonomy_id", ""),
        "price": os.getenv("ETSY_DEFAULT_PRICE", "5.00"),
        "quantity": os.getenv("ETSY_DEFAULT_QUANTITY", "10"),
        # Default materials fallback if env not set
        "materials": os.getenv(
            "ETSY_MATERIALS",
            "A3, A4, A5, Digital Download, High Resolution JPG, Printable File, Instant Download, Printable Poster",
        ),
        "orientation": os.getenv("ETSY_ORIENTATION", "vertical"),
        "pieces_included": os.getenv("ETSY_PIECES_INCLUDED", "1"),
        "currency_code": os.getenv("CURRENCY_CODE", "EUR"),
    }


def get_shop(shop_id: Optional[str] = None) -> Dict[str, object]:
    """Fetch Etsy shop details for the given shop_id or the persisted preference.

    Raises when not authenticated or when shop_id is missing.
    """
    headers = get_auth_headers().copy()
    # Prefer explicit param, then persisted preference
    sid = (shop_id or get_defaults().get("shop_id") or "").strip()
    if not sid:
        # Auto-detect from tokens if possible
        sid = ensure_shop_id()
    url = f"{ETSY_API_BASE}/shops/{sid}"
    resp = requests.get(url, headers=headers, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"getShop failed: {resp.status_code} {resp.text}")
    return resp.json()


def get_shop_listings(shop_id: Optional[str] = None, state: Optional[str] = "active", limit: int = 24, offset: int = 0) -> Dict[str, object]:
    """Fetch Etsy listings for the shop. Defaults to active listings.

    state can be one of: active, draft, inactive, expired, sold_out, featured (as supported by Etsy).
    """
    headers = get_auth_headers().copy()
    sid = (shop_id or get_defaults().get("shop_id") or "").strip()
    if not sid:
        # Auto-detect from tokens if possible
        sid = ensure_shop_id()
    # Build endpoint path
    if state and state.strip():
        path = f"listings/{state.strip()}"
    else:
        path = "listings"
    url = f"{ETSY_API_BASE}/shops/{sid}/{path}"
    params = {
        "limit": max(1, min(int(limit or 24), 100)),
        "offset": max(0, int(offset or 0)),
    }
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"getShopListings failed: {resp.status_code} {resp.text}")
    return resp.json()


def _extract_array(resp_json: Dict[str, object]) -> List[dict]:
    """Best-effort normalizer for Etsy list responses."""
    try:
        if isinstance(resp_json, list):
            return list(resp_json)
        if isinstance(resp_json.get("results"), list):
            return resp_json["results"]  # type: ignore[index]
        if isinstance(resp_json.get("transactions"), list):
            return resp_json["transactions"]  # type: ignore[index]
        if isinstance(resp_json.get("data"), list):
            return resp_json["data"]  # type: ignore[index]
        data = resp_json.get("data")
        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]  # type: ignore[index]
    except Exception:
        pass
    return []


def get_shop_sales(shop_id: Optional[str] = None, page_limit: int = 100, max_pages: int = 10) -> Dict[str, object]:
    """Aggregate sales by listing using the Transactions endpoint.

    Returns a JSON object with:
      - ok: bool
      - total_sales: int (sum of quantities)
      - revenue: float (sum of price*qty in shop currency when available)
      - currency_code: str
      - by_listing: { listing_id: { sales: int, revenue: float } }

    Best-effort parsing with robust fallbacks to avoid 500s.
    """
    headers = get_auth_headers().copy()
    sid = (shop_id or get_defaults().get("shop_id") or "").strip()
    if not sid:
        sid = ensure_shop_id()

    currency_code = get_defaults().get("currency_code", "EUR")
    by_listing: Dict[str, Dict[str, float]] = {}
    total_sales = 0
    revenue = 0.0

    # Paginate Transactions endpoint; if unavailable, return ok=False gracefully.
    base_url = f"{ETSY_API_BASE}/shops/{sid}/transactions"
    try:
        offset = 0
        for _ in range(max_pages):
            params = {
                "limit": max(1, min(int(page_limit or 100), 100)),
                "offset": max(0, int(offset or 0)),
            }
            resp = requests.get(base_url, headers=headers, params=params, timeout=30)
            if resp.status_code >= 400:
                # Break on client/server error and return best-effort aggregates so far
                break
            j = resp.json()
            arr = _extract_array(j)
            if not arr:
                break

            for tx in arr:
                try:
                    lid = tx.get("listing_id") or tx.get("listingId") or tx.get("listingId")
                    if not lid:
                        continue
                    key = str(lid)
                    qty = int(tx.get("quantity") or 1)
                    # Parse price: support nested money objects or plain strings/numbers
                    price_val = 0.0
                    price_obj = tx.get("price")
                    if isinstance(price_obj, dict):
                        amt = price_obj.get("amount")
                        if isinstance(amt, (int, float)):
                            # Etsy money amounts are in minor units
                            price_val = float(amt) / 100.0
                        else:
                            # sometimes price can be a string in the dict
                            try:
                                price_val = float(str(price_obj.get("price")))
                            except Exception:
                                pass
                        cc = price_obj.get("currency_code") or price_obj.get("currency")
                        if isinstance(cc, str):
                            currency_code = cc
                    else:
                        try:
                            price_val = float(str(tx.get("price") or 0))
                        except Exception:
                            price_val = 0.0

                    by_listing.setdefault(key, {"sales": 0.0, "revenue": 0.0})
                    by_listing[key]["sales"] += float(qty)
                    by_listing[key]["revenue"] += price_val * float(qty)
                    total_sales += qty
                    revenue += price_val * qty
                except Exception:
                    continue

            # Stop if fewer than requested returned
            if len(arr) < params["limit"]:
                break
            offset += params["limit"]

        # Convert sales from float to int in final payload
        normalized = {k: {"sales": int(v.get("sales", 0)), "revenue": float(v.get("revenue", 0.0))} for k, v in by_listing.items()}
        return {
            "ok": True,
            "total_sales": int(total_sales),
            "revenue": float(revenue),
            "currency_code": currency_code,
            "by_listing": normalized,
        }
    except Exception:
        # Graceful fallback, avoid 500 to the client
        return {
            "ok": False,
            "total_sales": 0,
            "revenue": 0.0,
            "currency_code": currency_code,
            "by_listing": {},
        }


def get_my_shops() -> Dict[str, object]:
    """Fetch the list of shops for the authenticated user.

    This is used to auto-detect and persist the user's shop_id after OAuth.
    """
    headers = get_auth_headers().copy()
    url = f"{ETSY_API_BASE}/users/me/shops"
    resp = requests.get(url, headers=headers, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"getMyShops failed: {resp.status_code} {resp.text}")
    return resp.json()


def get_me() -> Dict[str, object]:
    """Fetch basic info about the authenticated user (user_id, shop_id).

    Endpoint: GET /users/me
    """
    headers = get_auth_headers().copy()
    url = f"{ETSY_API_BASE}/users/me"
    resp = requests.get(url, headers=headers, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"getMe failed: {resp.status_code} {resp.text}")
    return resp.json()


def ensure_shop_id() -> str:
    """Return a persisted shop_id; if missing but tokens exist, auto-detect it and persist.

    Raises RuntimeError with the standard "Missing shop_id" message if not resolvable.
    """
    sid = str(_token_store.get("shop_id") or "").strip()
    if sid:
        return sid
    # Require valid tokens
    _ = get_auth_headers()
    # Fetch minimal user info; prefer explicit shop_id from response, else fallback to user_id
    me = get_me()
    sid = str(me.get("shop_id") or me.get("user_id") or "").strip()
    if sid:
        _token_store["shop_id"] = sid
        _persist_tokens(_token_store)
        return sid
    raise RuntimeError("Missing shop_id. Configure preferences via /etsy/prefs.")
