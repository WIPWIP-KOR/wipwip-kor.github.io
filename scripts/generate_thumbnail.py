#!/usr/bin/env python3
"""Generate a blog post thumbnail with the Gemini image API and wire it into the post's front matter.

Usage: python3 scripts/generate_thumbnail.py content/posts/<slug>.md
Requires GEMINI_API_KEY in the environment.
"""
import base64
import json
import os
import re
import sys
import urllib.request

MODEL = "gemini-2.5-flash-image"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
IMAGES_DIR = "static/images/posts"


def read_front_matter(text):
    match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        raise ValueError("front matter not found")
    return match.group(1)


def get_field(front_matter, key):
    match = re.search(rf'^{key}:\s*"?([^"\n]+)"?\s*$', front_matter, re.MULTILINE)
    return match.group(1).strip() if match else None


def build_prompt(title, description):
    return (
        "Create a clean, modern flat-illustration thumbnail image for a Korean finance/legal "
        "information blog post. 1200x630, 16:9-ish landscape composition. "
        "No text, no letters, no numbers in the image. "
        f"Topic: {title}. Context: {description}. "
        "Style: minimal flat design, soft color palette, simple geometric shapes and icons "
        "related to the topic (e.g. documents, buildings, coins, calendar), plenty of "
        "whitespace, professional and trustworthy tone, no photorealism."
    )


def generate_image(prompt, api_key):
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{API_URL}?key={api_key}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.load(resp)

    parts = payload["candidates"][0]["content"]["parts"]
    for part in parts:
        inline = part.get("inlineData")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    raise RuntimeError(f"no image data in response: {json.dumps(payload)[:500]}")


def insert_thumbnail_field(text, front_matter, thumbnail_path):
    if get_field(front_matter, "thumbnail"):
        return re.sub(
            r'^thumbnail:\s*"?[^"\n]+"?\s*$',
            f'thumbnail: "{thumbnail_path}"',
            text,
            count=1,
            flags=re.MULTILINE,
        )
    return text.replace(
        "---\n\n", f'thumbnail: "{thumbnail_path}"\n---\n\n', 1
    ) if "---\n\n" in text else re.sub(
        r"^---\n", f'---\nthumbnail: "{thumbnail_path}"\n', text, count=1
    )


def main():
    if len(sys.argv) != 2:
        print("usage: generate_thumbnail.py <path-to-post.md>", file=sys.stderr)
        sys.exit(1)

    post_path = sys.argv[1]
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY is not set", file=sys.stderr)
        sys.exit(1)

    with open(post_path, encoding="utf-8") as f:
        text = f.read()

    front_matter = read_front_matter(text)
    title = get_field(front_matter, "title") or ""
    description = get_field(front_matter, "description") or ""

    slug = os.path.splitext(os.path.basename(post_path))[0]
    prompt = build_prompt(title, description)
    print(f"Generating thumbnail for: {title}")
    image_bytes = generate_image(prompt, api_key)

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
