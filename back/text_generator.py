# seo_generator_from_img_compact_desc.py
import os, json, base64, sys
from typing import Tuple, List, Dict, Any
from openai import OpenAI
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

IMAGE_PATH = "7.png"
OUTPUT_JSON = "etsy_metadata.json"
MODEL = "gpt-5"          # ou "gpt-5-mini" si tu veux réduire encore le coût
MAX_RETRIES = 2
DETAIL = "low"           # "low" pour réduire le coût; "high" si besoin de plus de précision

# --- Description assemblée localement (ton squelette fixe) ---
DESCRIPTION_TMPL = """{intro}

• Instant Download ✅ – No waiting, print at home or at a professional shop.
• High-Resolution Digital File ✅ – 300 DPI quality for crisp and detailed printing.
• Versatile Decor ✅ – Works in multiple rooms and styles.

🎨 Why you’ll love it:
{love}

📂 What’s included:
High-quality printable files in multiple sizes for easy printing and framing.

💡 How to print:
• At home with a printer and quality paper.
• At a local print shop or office supply store.
• Through online print services.

⚠️ Please note:
• This is a digital product only – no physical item will be shipped.

Copyright Notice ©️:
• This artwork is protected by copyright and intended for personal use only. Commercial use is strictly forbidden.
• Redistribution, sharing, or resale of this digital art print file is not permitted."""

# --- Prompts ---

SYSTEM_PROMPT = """You are an expert Etsy SEO copywriter for digital printable wall art.
Always return a valid MINIFIED JSON object only. No extra text.

TASK (from ONE image) — return ONLY these fields in ENGLISH:
- title: 130–140 characters inclusive (maximize length within range).
- intro: 2–3 sentences in a vivid, non-generic voice. Include at least TWO concrete visual details observed in the image (e.g., specific colors, textures, named objects/setting), and ONE audience/use case. Avoid boilerplate like “digital printable wall art”, “perfect for living rooms/bedrooms/offices”, “add a touch of…”, “makes a great gift”. Do not list multiple rooms (name at most one). Aim for natural, emotive copy (e.g., “Bring Mediterranean charm…”), not inventory-like description.
- love: 2–3 sentences (emotion, benefits, uniqueness).
- alt_seo: one paragraph, 400–500 characters inclusive, no line breaks.
- tags: ONE string, comma-separated, EXACTLY 13 tags total, each tag ≤ 20 characters (count spaces), all lowercase, no duplicates.

STYLE
- Clear, warm, benefit-driven, keyword-rich (include subject, style, digital, printable, poster/wall art).
- Output JSON only, minified. Validate all constraints before output.

OUTPUT (minified JSON only):
{"title":"...","intro":"...","love":"...","alt_seo":"...","tags":"tag1, tag2, ... (13 total)"}"""

USER_INSTRUCTIONS = """You will receive exactly one attached image.
Analyze the visual content and return ONLY the minified JSON with: title, intro, love, alt_seo, tags. No extra text."""

# --- Utils ---

def b64_data_url(path: str) -> str:
    mime = "image/png"
    if path.lower().endswith((".jpg", ".jpeg")): mime = "image/jpeg"
    if path.lower().endswith(".webp"): mime = "image/webp"
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime};base64,{data}"

def parse_json_maybe(s: str) -> Dict[str, Any]:
    s = s.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.startswith("json"):
            s = s[4:].strip()
    return json.loads(s)

def validate_fields(payload: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errors = []
    title = payload.get("title","")
    intro = payload.get("intro","").strip()
    love  = payload.get("love","").strip()
    alt   = payload.get("alt_seo","")
    tags_str = payload.get("tags","")

    # Title 130–140
    if not (130 <= len(title) <= 140):
        errors.append(f"title length must be 130–140, got {len(title)}")

    # intro / love non vides
    if not intro:
        errors.append("intro is empty")
    if not love:
        errors.append("love is empty")

    # alt 400–500, 1 paragraphe
    if not (400 <= len(alt) <= 500):
        errors.append(f"alt_seo length must be 400–500, got {len(alt)}")
    if "\n" in alt or "\r" in alt:
        errors.append("alt_seo must be one paragraph (no line breaks)")

    # Tags
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

def build_description(intro: str, love: str) -> str:
    return DESCRIPTION_TMPL.format(intro=intro.strip(), love=love.strip())

def request_once(client: OpenAI, image_data_url: str, corrections: List[str] | None = None) -> str:
    user_content = []
    if corrections:
        user_content.append({
            "type": "text",
            "text": "Previous output violated constraints:\n- " + "\n- ".join(corrections) + "\nReturn corrected JSON now."
        })
    else:
        user_content.append({"type": "text", "text": USER_INSTRUCTIONS})

    user_content.append({
        "type": "image_url",
        "image_url": {"url": image_data_url, "detail": DETAIL}
    })

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content}
        ]
    )
    return resp.choices[0].message.content

# --- Main ---

def main():
    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: set OPENAI_API_KEY", file=sys.stderr); sys.exit(1)
    if not os.path.exists(IMAGE_PATH):
        print(f"ERROR: image not found: {IMAGE_PATH}", file=sys.stderr); sys.exit(1)

    client = OpenAI()
    data_url = b64_data_url(IMAGE_PATH)

    corrections = None
    last_json = None
    for attempt in range(MAX_RETRIES + 1):
        raw = request_once(client, data_url, corrections)
        try:
            compact = parse_json_maybe(raw)
        except Exception:
            corrections = ["output must be a single valid minified JSON object, nothing else."]
            if attempt == MAX_RETRIES:
                print("Last output (not JSON):\n", raw, file=sys.stderr)
                sys.exit(2)
            continue

        ok, errs = validate_fields(compact)
        if ok:
            # On assemble la description finale côté code
            final_description = build_description(compact["intro"], compact["love"])
            final_payload = {
                "title": compact["title"],
                "alt_seo": compact["alt_seo"],
                "description": final_description,
                "tags": compact["tags"]
            }
            with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
                json.dump(final_payload, f, ensure_ascii=False, separators=(",", ":"))
            print(json.dumps(final_payload, ensure_ascii=False, separators=(",", ":")))
            print(f"\n✅ Saved to {OUTPUT_JSON}")
            return
        else:
            corrections = errs
            last_json = compact
            if attempt == MAX_RETRIES:
                print("ERROR: Output failed validation.", file=sys.stderr)
                print("Violations:", *errs, sep="\n- ")
                print("\nLast JSON received:\n", json.dumps(last_json, ensure_ascii=False, indent=2), file=sys.stderr)
                sys.exit(3)

if __name__ == "__main__":
    main()
