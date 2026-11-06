#!/usr/bin/env python3
"""Draw a blog post thumbnail locally with Pillow and wire it into the post's
front matter.

2026-11-06 — 이 스크립트는 원래 Gemini(gemini-3.1-flash-image)로 배경 그림을
만들고 그 위에 제목만 Pillow로 올렸다. 두 가지 이유로 배경까지 직접 그리게
바꿨다.

1. 외부 API 키가 필요 없다. GOOGLE_API_KEY 없이도 동작하므로 로컬에서도,
   포크에서도 돌아간다.
2. 파일이 가볍다. 생성 이미지는 장당 600~700KB였고 44장이 30MB였다. 평면
   색과 글자만 쓰면 PNG가 수십 KB로 떨어진다. 측정 기록 사이트에 장식
   사진으로 페이지 무게를 더할 이유가 없었다.

한글 제목을 Pillow로 그리는 부분은 원래 구조를 그대로 뒀다. 이미지 생성
모델은 한글을 제대로 렌더하지 못해서 처음부터 글자는 Pillow 몫이었다.

Usage: python3 scripts/generate_thumbnail.py content/posts/<slug>.md
Requires Pillow and a Korean-capable font (e.g. `apt install fonts-nanum`).
Font paths can be overridden with THUMB_FONT_BOLD / THUMB_FONT.
"""
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

IMAGES_DIR = "static/images/posts"
CANVAS_SIZE = (1200, 630)
MARGIN = 80
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
]
FONT_CANDIDATES_REGULAR = [
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]

# 배경은 카테고리별로 고른다. 글이 늘어도 같은 그림이 반복되는 인상을 줄이려고
# 두 색을 세로로 섞는다. 색 이름이 아니라 (위, 아래) RGB다.
PALETTES = {
    "실험 기록": ((22, 28, 40), (38, 50, 74)),
    "_default": ((26, 26, 30), (48, 48, 56)),
}
ACCENT = (108, 163, 255)


def read_front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, flags=re.DOTALL)
    return m.group(1) if m else ""


def get_field(front_matter, key):
    m = re.search(rf'^{key}:\s*"?(.*?)"?\s*$', front_matter, flags=re.MULTILINE)
    return m.group(1).strip() if m else ""


def get_list_field(front_matter, key):
    m = re.search(rf"^{key}:\s*\[(.*?)\]\s*$", front_matter, flags=re.MULTILINE)
    if not m:
        return []
    return [p.strip().strip('"').strip("'") for p in m.group(1).split(",") if p.strip()]


def find_font(candidates, env_key=None):
    # 환경에 따라 폰트 경로가 다르다. THUMB_FONT_BOLD / THUMB_FONT 로 직접 줄 수 있다.
    if env_key:
        override = os.environ.get(env_key)
        if override and os.path.exists(override):
            return override
    for path in candidates:
        if os.path.exists(path):
            return path
    raise RuntimeError(
        "no Korean font found; install one, e.g. `apt-get install fonts-nanum`"
    )


def wrap_text(draw, text, font, max_width):
    """공백 단위로 줄을 나눈다. 한국어는 단어가 길어 한 어절이 폭을 넘을 수
    있으므로, 그런 어절은 글자 단위로 다시 쪼갠다."""
    lines, cur = [], ""
    for word in text.split(" "):
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not cur:
            if draw.textlength(trial, font=font) > max_width and not cur:
                # 한 어절이 통째로 넘친다. 글자 단위로 끊는다.
                piece = ""
                for ch in word:
                    if draw.textlength(piece + ch, font=font) > max_width and piece:
                        lines.append(piece)
                        piece = ch
                    else:
                        piece += ch
                cur = piece
                continue
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def background(size, palette):
    """세로 그라데이션. 평면 색이라 PNG가 아주 작게 압축된다."""
    top, bottom = palette
    w, h = size
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize(size, Image.BILINEAR)


def compose_thumbnail(title, category, site):
    img = background(CANVAS_SIZE, PALETTES.get(category, PALETTES["_default"]))
    draw = ImageDraw.Draw(img)
    w, h = CANVAS_SIZE
    max_width = w - MARGIN * 2

    bold = find_font(FONT_CANDIDATES, "THUMB_FONT_BOLD")
    regular = find_font(FONT_CANDIDATES_REGULAR, "THUMB_FONT")

    # 왼쪽 악센트 바. 제목 블록의 시작을 표시한다.
    draw.rectangle([(MARGIN, MARGIN), (MARGIN + 8, MARGIN + 56)], fill=ACCENT)

    # 상단 라벨: 카테고리
    label_font = ImageFont.truetype(regular, 30)
    if category:
        draw.text((MARGIN + 28, MARGIN + 12), category, font=label_font, fill=ACCENT)

    # 제목: 폭에 맞을 때까지 크기를 줄인다. 4줄을 넘기지 않는다.
    for size in range(76, 39, -4):
        font = ImageFont.truetype(bold, size)
        lines = wrap_text(draw, title, font, max_width)
        if len(lines) <= 4:
            break
    line_h = round(size * 1.38)
    block_h = line_h * len(lines)
    y = (h - block_h) // 2 + 24
    for line in lines:
        draw.text((MARGIN, y), line, font=font, fill=(245, 247, 250))
        y += line_h

    # 하단: 사이트 이름
    foot_font = ImageFont.truetype(regular, 28)
    draw.text((MARGIN, h - MARGIN - 20), site, font=foot_font, fill=(150, 160, 178))

    return img


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
    with open(post_path, encoding="utf-8") as f:
        text = f.read()

    front_matter = read_front_matter(text)
    title = get_field(front_matter, "title") or ""
    if not title:
        print(f"no title in {post_path}", file=sys.stderr)
        sys.exit(1)
    categories = get_list_field(front_matter, "categories")
    category = categories[0] if categories else ""
    site = os.environ.get("SITE_NAME", "WIPWIP 연구소")

    slug = os.path.splitext(os.path.basename(post_path))[0]
    print(f"Drawing thumbnail for: {title}")

    img = compose_thumbnail(title, category, site)
    os.makedirs(IMAGES_DIR, exist_ok=True)
    out_path = os.path.join(IMAGES_DIR, f"{slug}.png")
    img.save(out_path, format="PNG", optimize=True)

    thumbnail_path = f"/images/posts/{slug}.png"
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(insert_thumbnail_field(text, front_matter, thumbnail_path))

    print(f"Wrote {out_path} ({os.path.getsize(out_path) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
