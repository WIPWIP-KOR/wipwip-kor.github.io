#!/usr/bin/env python3
"""Generate a blog post thumbnail with the Gemini API (Imagen), overlay the
post title on top with Pillow (AI models render Korean text unreliably, so
the title is composited afterwards instead of being part of the generated
image), and wire the resulting file into the post's front matter.

Usage: python3 scripts/generate_thumbnail.py content/posts/<slug>.md
Requires GOOGLE_API_KEY in the environment.
Requires Pillow, google-genai, and a Korean-capable font
(e.g. `apt install fonts-nanum`).
"""
import io
import os
import re
import sys

from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont

IMAGE_MODEL = "imagen-4.0-generate-001"
IMAGES_DIR = "static/images/posts"
CANVAS_SIZE = (1200, 630)
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
]


def read_front_matter(text):
    match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        raise ValueError("front matter not found")
    return match.group(1)


def get_field(front_matter, key):
    match = re.search(rf'^{key}:\s*"?([^"\n]+)"?\s*$', front_matter, re.MULTILINE)
    return match.group(1).strip() if match else None


def get_list_field(front_matter, key):
    match = re.search(rf'^{key}:\s*\[(.*?)\]\s*$', front_matter, re.MULTILINE)
    if not match:
        return []
    return [item.strip().strip('"') for item in match.group(1).split(",") if item.strip()]


def main_topic(title):
    # Drop a trailing parenthetical qualifier, e.g. "... (2026년 지원금 360만원)",
    # so the image prompt focuses on the core subject rather than the whole headline.
    return re.sub(r"\s*\([^)]*\)\s*$", "", title).strip()


def build_prompt(title, description, tags):
    topic = main_topic(title)
    tag_hint = ", ".join(tags[:4]) if tags else ""
    return (
        "Clean modern flat-illustration background for a Korean finance/legal "
        "information blog post, 16:9 landscape composition. No text, no letters, "
        "no numbers, no watermarks, leave the lower third relatively simple and "
        "uncluttered since a title will be overlaid there. "
        f"Core subject to depict: {topic}. Related concepts: {tag_hint}. "
        f"Context: {description}. "
        "Style: minimal flat design, soft muted color palette, simple geometric "
        "shapes and icons directly representing the core subject (e.g. relevant "
        "documents, office/government buildings, coins, calendars, people at "
        "work), plenty of whitespace, professional and trustworthy tone, no "
        "photorealism."
    )


def generate_image(prompt, api_key):
    client = genai.Client(api_key=api_key)
    result = client.models.generate_images(
        model=IMAGE_MODEL,
        prompt=prompt,
        config=types.GenerateImagesConfig(number_of_images=1),
    )
    if not result.generated_images:
        raise RuntimeError("Gemini API returned no images")
    return result.generated_images[0].image.image_bytes


def find_font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise RuntimeError(
        "no Korean font found; install one, e.g. `apt-get install fonts-nanum`"
    )


def wrap_text(draw, text, font, max_width):
    words = text.split(" ")
    lines, cur = [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        left, _, right, _ = draw.textbbox((0, 0), trial, font=font)
        if right - left <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def compose_thumbnail(image_bytes, title):
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Center-crop to the canvas aspect ratio, then resize.
    target_ratio = CANVAS_SIZE[0] / CANVAS_SIZE[1]
    w, h = img.size
    if w / h > target_ratio:
        new_w = int(h * target_ratio)
        x0 = (w - new_w) // 2
        img = img.crop((x0, 0, x0 + new_w, h))
    else:
        new_h = int(w / target_ratio)
        y0 = (h - new_h) // 2
        img = img.crop((0, y0, w, y0 + new_h))
    img = img.resize(CANVAS_SIZE, Image.LANCZOS).convert("RGBA")

    # Dark gradient band along the bottom so white title text stays legible.
    overlay = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    band_top = int(CANVAS_SIZE[1] * 0.45)
    for y in range(band_top, CANVAS_SIZE[1]):
        alpha = int(190 * (y - band_top) / (CANVAS_SIZE[1] - band_top))
        draw.line([(0, y), (CANVAS_SIZE[0], y)], fill=(0, 0, 0, alpha))
    img = Image.alpha_composite(img, overlay)

    draw = ImageDraw.Draw(img)
    font_path = find_font()
    max_text_width = CANVAS_SIZE[0] - 120
    font_size = 64
    font = ImageFont.truetype(font_path, font_size)
    lines = wrap_text(draw, title, font, max_text_width)
    while len(lines) > 3 and font_size > 32:
        font_size -= 4
        font = ImageFont.truetype(font_path, font_size)
        lines = wrap_text(draw, title, font, max_text_width)

    line_height = int(font_size * 1.35)
    total_height = line_height * len(lines)
    y = CANVAS_SIZE[1] - 48 - total_height
    for line in lines:
        left, _, right, _ = draw.textbbox((0, 0), line, font=font)
        x = (CANVAS_SIZE[0] - (right - left)) // 2
        draw.text((x + 2, y + 2), line, font=font, fill=(0, 0, 0, 160))
        draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))
        y += line_height

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def insert_thumbnail_field(text, front_matter, thumbnail_path):
    if get_field(front_matter, "thumbnail"):
        return re.sub(
            r'^thumbnail:\s*"?[^"\n]+"?\s*$',
            f'thumbnail: "{thumbnail_path}"',
            text,
            count=1,
            flags=re.MULTILINE,
        )
    return re.sub(r"^---\n", f'---\nthumbnail: "{thumbnail_path}"\n', text, count=1)


def main():
    if len(sys.argv) != 2:
        print("usage: generate_thumbnail.py <path-to-post.md>", file=sys.stderr)
        sys.exit(1)

    post_path = sys.argv[1]
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("GOOGLE_API_KEY must be set", file=sys.stderr)
        sys.exit(1)

    with open(post_path, encoding="utf-8") as f:
        text = f.read()

    front_matter = read_front_matter(text)
    title = get_field(front_matter, "title") or ""
    description = get_field(front_matter, "description") or ""
    tags = get_list_field(front_matter, "tags")

    slug = os.path.splitext(os.path.basename(post_path))[0]
    prompt = build_prompt(title, description, tags)
    print(f"Generating thumbnail for: {title}")
    raw_image = generate_image(prompt, api_key)
    image_bytes = compose_thumbnail(raw_image, title)

    os.makedirs(IMAGES_DIR, exist_ok=True)
    image_path = os.path.join(IMAGES_DIR, f"{slug}.png")
    with open(image_path, "wb") as f:
        f.write(image_bytes)

    thumbnail_url = f"/images/posts/{slug}.png"
    updated_text = insert_thumbnail_field(text, front_matter, thumbnail_url)
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(updated_text)

    print(f"Saved {image_path}, front matter updated with thumbnail: {thumbnail_url}")


if __name__ == "__main__":
    main()
