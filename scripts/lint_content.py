#!/usr/bin/env python3
"""발행 전 마크다운 점검 — 이 저장소에서 반복해서 난 사고 세 가지를 소스 단계에서 잡는다.

빌드 후 public/을 grep하는 것보다 빠르고, 어느 줄인지 알려준다.

  1) 닫는 `**` 바로 앞이 문장부호  — CommonMark가 강조로 인정하지 않아 별표가 그대로 보인다.
     `)` 말고도 `%`, `"`(스마트 따옴표로 변환됨), `]`가 모두 해당한다.
     고치는 법: 조사를 강조 안으로 넣어 글자로 끝나게 한다. `**3.1%**다` → `**3.1%다**`
  2) 문단 바로 다음 줄의 `---`  — Goldmark가 <hr>가 아니라 setext h2로 읽어서
     앞 문단 전체가 거대한 제목이 되고 FAQPage에서도 빠진다. `---` 앞에 빈 줄을 둔다.
  3) 본문 표가 6열 이상  — 390px에서 가로로 넘친다. Hugo 0.123.7에는 표 렌더 훅이 없어
     스크롤 래퍼를 자동으로 씌울 수 없다 (0.134.0부터 지원).

사용법:
  python3 scripts/lint_content.py            # content/ 전체
  python3 scripts/lint_content.py 파일...    # 특정 파일만
종료코드 1이면 문제가 있다.
"""

import glob
import os
import re
import sys

# 닫는 ** 앞에 올 수 없는 문자. 스마트 따옴표는 Goldmark가 " ' 를 변환한 결과다.
PUNCT = '%)]}>"\'“”‘’」』'
BOLD_BAD = re.compile(r'\*\*([^*\n]{1,120}?[' + re.escape(PUNCT) + r'])\*\*(?=[가-힣])')


def front_matter_span(lines):
    """프런트매터 구간 [시작, 끝) 를 반환. 없으면 (0, 0)."""
    if not lines or lines[0].strip() != '---':
        return 0, 0
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            return 0, i + 1
    return 0, 0


def check(path):
    text = open(path, encoding='utf-8').read()
    lines = text.splitlines()
    _, body_start = front_matter_span(lines)
    problems = []

    in_code = False
    for n, line in enumerate(lines[body_start:], start=body_start + 1):
        if line.lstrip().startswith('```'):
            in_code = not in_code
            continue
        if in_code:
            continue

        for m in BOLD_BAD.finditer(line):
            problems.append((n, '닫는 ** 앞이 문장부호', m.group(0)[:50]))

        # setext h2: 문단 바로 다음 줄의 ---
        if line.strip() == '---' and n - 2 >= body_start:
            prev = lines[n - 2]
            if prev.strip() and not prev.lstrip().startswith(('#', '|', '-', '*', '>')):
                problems.append((n, 'setext h2 (--- 앞에 빈 줄 없음)', prev.strip()[:40]))

        # 표 열 수: 구분선 행으로 센다
        if re.match(r'^\s*\|?\s*:?-{2,}', line) and line.count('|') >= 2:
            cols = len([c for c in line.strip().strip('|').split('|') if c.strip()])
            if cols >= 6:
                problems.append((n, f'표 {cols}열 (5열 이하 권장)', line.strip()[:40]))

    return problems


def main():
    targets = sys.argv[1:] or sorted(
        glob.glob('content/**/*.md', recursive=True))
    total = 0
    for p in targets:
        if os.path.basename(p) == '_index.md':
            continue
        for n, kind, snippet in check(p):
            print(f'{p}:{n}  {kind}\n    {snippet}')
            total += 1
    if total:
        print(f'\n문제 {total}건. 위 설명(스크립트 상단 주석)대로 고친다.')
        return 1
    print(f'점검 {len(targets)}개 파일 — 문제 없음')
    return 0


if __name__ == '__main__':
    sys.exit(main())
