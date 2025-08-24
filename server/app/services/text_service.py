from __future__ import annotations
from typing import Dict, Any, List
import base64
import json
import os
from io import BytesIO
from PIL import Image
from openai import OpenAI

MODEL = os.getenv("OPENAI_MODEL", "gpt-5")
DETAIL = os.getenv("OPENAI_IMAGE_DETAIL", "low")
MAX_RETRIES = 2

DESCRIPTION_TMPL = (
    "{intro}\n\n"
    "• Instant Download ✅ – No waiting, print at home or at a professional shop.\n"
    "• High-Resolution Digital File ✅ – 300 DPI quality for crisp and detailed printing.\n"
    "• Versatile Decor ✅ – Works in multiple rooms and styles.\n\n"
    "🎨 Why you’ll love it:\n{love}\n\n"
    "📂 What’s included:\nHigh-quality printable files in multiple sizes for easy printing and framing.\n\n"
    "💡 How to print:\n• At home with a printer and quality paper.\n• At a local print shop or office supply store.\n• Through online print services.\n\n"
    "⚠️ Please note:\n• This is a digital product only – no physical item will be shipped.\n\n"
    "Copyright Notice ©️:\n"
    "• This artwork is protected by copyright and intended for personal use only. Commercial use is strictly forbidden.\n"
    "• Redistribution, sharing, or resale of this digital art print file is not permitted."
)

SYSTEM_PROMPT = (
    "You are an expert Etsy SEO copywriter for digital printable wall art.\n"
    "Always return a valid MINIFIED JSON object only. No extra text.\n\n"
    "TASK (from ONE image) — return ONLY these fields in ENGLISH:\n"
    "- title: 130–140 characters inclusive (maximize length within range. Character '&' is forbidden. Uppercase on first letter of each word).\n"
    "- intro: 2–3 sentences in a vivid, non-generic voice. Include at least TWO concrete visual details observed in the image (e.g., specific colors, textures, named objects/setting), and ONE audience/use case. Avoid boilerplate like “digital printable wall art”, “perfect for living rooms/bedrooms/offices”, “add a touch of…”, “makes a great gift”. Do not list multiple rooms (name at most one). Aim for natural, emotive copy (e.g., “Bring Mediterranean charm…”), not inventory-like description.\n"
    "- love: 2–3 sentences (emotion, benefits, uniqueness).\n"
    "- alt_seo: one paragraph, 400–500 characters inclusive, no line breaks.\n"
    "- tags: ONE string, comma-separated, EXACTLY 13 tags total, each tag ≤ 20 characters (count spaces), all lowercase, no duplicates.\n\n"
    "STYLE\n- Clear, warm, benefit-driven, keyword-rich (include subject, style, digital, printable, poster/wall art).\n"
    "- Output JSON only, minified. Validate all constraints before output.\n\n"
    "OUTPUT (minified JSON only):\n{\"title\":\"...\",\"intro\":\"...\",\"love\":\"...\",\"alt_seo\":\"...\",\"tags\":\"tag1, tag2, ... (13 total)\"}"
)

USER_INSTRUCTIONS = (
    "You will receive exactly one attached image.\n"
    "Analyze the visual content and return ONLY the minified JSON with: title, intro, love, alt_seo, tags. No extra text."
)


def _b64_data_url(image_bytes: bytes) -> str:
    try:
        im = Image.open(BytesIO(image_bytes))
        fmt = (im.format or "PNG").upper()
    except Exception:
        fmt = "PNG"
    mime = "image/png" if fmt == "PNG" else ("image/jpeg" if fmt in {"JPG", "JPEG"} else "image/webp")
    data = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime};base64,{data}"


def _parse_json_maybe(s: str) -> Dict[str, Any]:
    s = s.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.startswith("json"):
            s = s[4:].strip()
    return json.loads(s)


def _validate_fields(payload: Dict[str, Any]) -> (bool, List[str]):
    errors: List[str] = []
    title = payload.get("title", "")
    intro = payload.get("intro", "").strip()
    love = payload.get("love", "").strip()
    alt = payload.get("alt_seo", "")
    tags_str = payload.get("tags", "")

    if not (130 <= len(title) <= 140):
        errors.append(f"title length must be 130–140, got {len(title)}")
    if not intro:
        errors.append("intro is empty")
    if not love:
        errors.append("love is empty")
    if not (400 <= len(alt) <= 500):
        errors.append(f"alt_seo length must be 400–500, got {len(alt)}")
    if "\n" in alt or "\r" in alt:
        errors.append("alt_seo must be one paragraph (no line breaks)")

    tags = [t.strip() for t in tags_str.split(",") if t.strip()]
    if len(tags) != 13:
        errors.append(f"tags must contain exactly 13 tags, got {len(tags)}")
    lowered = [t.lower() for t in tags]
    if len(set(lowered)) != len(lowered):
        errors.append("tags contain duplicates")
    for t in tags:
        if len(t) > 20:
            errors.append(f"tag '{t}' exceeds 20 characters")
        if t != t.lower():
            errors.append(f"tag '{t}' must be lowercase")

    return (len(errors) == 0, errors)


def _build_description(intro: str, love: str) -> str:
    return DESCRIPTION_TMPL.format(intro=intro.strip(), love=love.strip())


def generate_texts(image_bytes: bytes, context: str | None = None) -> Dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY not set")

    client = OpenAI()
    data_url = _b64_data_url(image_bytes)

    corrections = None
    last_json = None
    for attempt in range(MAX_RETRIES + 1):
        user_content = []
        if corrections:
            user_content.append({
                "type": "text",
                "text": "Previous output violated constraints:\n- " + "\n- ".join(corrections) + "\nReturn corrected JSON now."
            })
            if context and context.strip():
                user_content.append({
                    "type": "text",
                    "text": f"Reminder — user context: {context.strip()}"
                })
        else:
            user_content.append({"type": "text", "text": USER_INSTRUCTIONS})
            if context and context.strip():
                user_content.append({
                    "type": "text",
                    "text": f"Additional context from user: {context.strip()}"
                })
        user_content.append({"type": "image_url", "image_url": {"url": data_url, "detail": DETAIL}})

        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
        raw = resp.choices[0].message.content
        try:
            compact = _parse_json_maybe(raw)
        except Exception:
            corrections = ["output must be a single valid minified JSON object, nothing else."]
            if attempt == MAX_RETRIES:
                raise
            continue

        ok, errs = _validate_fields(compact)
        if ok:
            result: Dict[str, Any] = {
                "title": compact["title"],
                "alt_seo": compact["alt_seo"],
                "description": _build_description(compact["intro"], compact["love"]),
                "tags": compact["tags"],
            }
            return result
        else:
            corrections = errs
            last_json = compact
            if attempt == MAX_RETRIES:
                raise RuntimeError("OpenAI output failed validation: " + "; ".join(errs))

    # Should not reach here
    raise RuntimeError("Text generation failed")
