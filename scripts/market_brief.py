#!/usr/bin/env python3
"""매일 보는 증시 브리핑 — 미국·한국 지수와 관심 종목

블로그에 발행하지 않는다. 사람이 읽고 판단하기 위한 개인용 리포트다.
(CLAUDE.md의 "날짜에 의존하는 글을 쓰지 않는다"는 발행 글에 대한 규칙이고,
 이 스크립트의 출력은 content/ 밖에 있어 Hugo 빌드에 들어가지 않는다.)

데이터: 네이버 금융 공개 API
  지수(국내)   polling.finance.naver.com/api/realtime/domestic/index/<코드>
  지수(해외)   api.stock.naver.com/index/<로이터코드>/basic
  종목(국내)   polling.finance.naver.com/api/realtime/domestic/stock/<6자리>
  종목(해외)   api.stock.naver.com/stock/<티커>.O|.N/basic
  환율         api.stock.naver.com/marketindex/exchange/FX_USDKRW
  일봉         api.stock.naver.com/chart/{domestic|foreign}/{index|item}/<코드>
  수급(지수)   m.stock.naver.com/api/index/<KOSPI|KOSDAQ>/trend?bizdate=YYYYMMDD
  수급(종목)   m.stock.naver.com/api/stock/<6자리>/trend?pageSize=60&page=1

관심 종목은 watchlist.yaml에서 읽는다. 없으면 지수와 환율만 낸다.

사용법:
  python3 scripts/market_brief.py              # 터미널 출력
  python3 scripts/market_brief.py --json       # JSON (다른 도구에 넘길 때)
  python3 scripts/market_brief.py --no-flow    # 수급 생략 (호출이 20여 번 줄어 빠르다)
"""

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

API = "https://api.stock.naver.com"
POLL = "https://polling.finance.naver.com/api/realtime/domestic"
MOBILE = "https://m.stock.naver.com/api"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
KST = timezone(timedelta(hours=9))

HERE = os.path.dirname(os.path.abspath(__file__))
WATCHLIST = os.path.join(HERE, "watchlist.yaml")

# 지수는 고정. 한국은 polling, 미국은 api 쪽을 쓴다.
INDICES_KR = [("KOSPI", "코스피"), ("KOSDAQ", "코스닥")]
INDICES_US = [(".INX", "S&P 500"), (".IXIC", "나스닥"), (".DJI", "다우")]


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": "https://m.stock.naver.com/",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as e:
        return {"__error__": str(e)[:120]}


def num(v):
    """'5,735.66' 같은 문자열도 숫자로."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None


def candles(kind, code):
    """일봉 목록을 최신순이 아닌 과거→현재 순서로 반환."""
    path = {
        "kr_index": f"chart/domestic/index/{code}",
        "kr_item": f"chart/domestic/item/{code}",
        "us_index": f"chart/foreign/index/{code}",
        "us_item": f"chart/foreign/item/{code}",
    }[kind]
    d = fetch(f"{API}/{path}?periodType=dayCandle")
    rows = d.get("priceInfos") or []
    return [c for c in rows if num(c.get("closePrice")) is not None]


def trend(rows, last_close):
    """이동평균과 52주(확보 가능한 범위) 고저 대비 위치."""
    closes = [num(c["closePrice"]) for c in rows]
    if last_close is not None:
        # 장중이면 마지막 봉과 현재가가 다를 수 있다. 현재가를 끝에 둔다.
        if not closes or abs(closes[-1] - last_close) > 1e-9:
            closes = closes + [last_close]
    out = {}
    for n in (5, 20, 60):
        if len(closes) >= n:
            ma = sum(closes[-n:]) / n
            out[f"ma{n}"] = ma
            out[f"vs_ma{n}"] = (closes[-1] / ma - 1) * 100
    highs = [num(c.get("highPrice")) for c in rows if num(c.get("highPrice"))]
    lows = [num(c.get("lowPrice")) for c in rows if num(c.get("lowPrice"))]
    if highs and lows:
        hi, lo = max(highs), min(lows)
        out["period_high"], out["period_low"] = hi, lo
        out["days"] = len(rows)
        if hi > lo:
            out["pos_in_range"] = (closes[-1] - lo) / (hi - lo) * 100
        out["from_high"] = (closes[-1] / hi - 1) * 100
    return out


def kr_index(code, label):
    d = fetch(f"{POLL}/index/{code}")
    if "__error__" in d or not d.get("datas"):
        return {"name": label, "error": d.get("__error__", "응답 없음")}
    x = d["datas"][0]
    close = num(x.get("closePriceRaw") or x.get("closePrice"))
    return {
        "name": label, "close": close,
        "change": num(x.get("compareToPreviousClosePriceRaw")),
        "pct": num(x.get("fluctuationsRatioRaw")),
        "status": x.get("marketStatus"),
        "trend": trend(candles("kr_index", code), close),
    }


def us_index(code, label):
    x = fetch(f"{API}/index/{code}/basic")
    if "__error__" in x or x.get("code") == "StockConflict":
        return {"name": label, "error": x.get("__error__", x.get("message", ""))}
    close = num(x.get("closePriceRaw") or x.get("closePrice"))
    return {
        "name": label, "close": close,
        "change": num(x.get("compareToPreviousClosePriceRaw")),
        "pct": num(x.get("fluctuationsRatioRaw")),
        "status": x.get("marketStatus"),
        "trend": trend(candles("us_index", code), close),
    }


def kr_stock(code, label=None):
    d = fetch(f"{POLL}/stock/{code}")
    if "__error__" in d or not d.get("datas"):
        return {"name": label or code, "error": d.get("__error__", "응답 없음")}
    x = d["datas"][0]
    close = num(x.get("closePriceRaw") or x.get("closePrice"))
    return {
        "name": label or x.get("stockName") or code, "code": code, "close": close,
        "change": num(x.get("compareToPreviousClosePriceRaw")),
        "pct": num(x.get("fluctuationsRatioRaw")),
        "status": x.get("marketStatus"), "unit": "원",
        "trend": trend(candles("kr_item", code), close),
    }


def us_stock(code, label=None):
    x = fetch(f"{API}/stock/{code}/basic")
    if "__error__" in x or x.get("code") == "StockConflict":
        return {"name": label or code, "error": x.get("__error__", x.get("message", ""))}
    close = num(x.get("closePriceRaw") or x.get("closePrice"))
    return {
        "name": label or x.get("stockName") or code, "code": code, "close": close,
        "change": num(x.get("compareToPreviousClosePriceRaw")),
        "pct": num(x.get("fluctuationsRatioRaw")),
        "status": x.get("marketStatus"), "unit": "$",
        "trend": trend(candles("us_item", code), close),
    }


# ---------------------------------------------------------------- 수급 (투자자별 순매수)

def trading_dates(limit=22):
    """코스피 일봉에서 실제 거래일만 뽑는다. 지수 수급은 날짜를 하나씩 찍어야 해서 필요하다."""
    return [c["localDate"] for c in candles("kr_index", "KOSPI")][-limit:]


def index_flow(code, label, dates):
    """지수 투자자별 순매수. 금액 단위는 억원이고, 하루치씩만 주므로 날짜별로 모은다.

    bizdate를 안 붙이면 '오늘'을 주는데 장이 안 열린 날은 전부 0이 돌아온다.
    그래서 0/0/0은 데이터가 아니라 '해당 없음'으로 보고 버린다.
    """
    def one(d):
        x = fetch(f"{MOBILE}/index/{code}/trend?bizdate={d}")
        if "__error__" in x:
            return None
        f, o, i = (num(x.get("foreignValue")), num(x.get("institutionalValue")),
                   num(x.get("personalValue")))
        if None in (f, o, i) or (f == 0 and o == 0 and i == 0):
            return None
        return {"date": d, "foreign": f, "organ": o, "individual": i}

    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = [r for r in ex.map(one, dates) if r]
    rows.sort(key=lambda r: r["date"])
    if not rows:
        return {"name": label, "error": "수급 응답 없음"}
    return {"name": label, "unit": "억원", "rows": rows,
            "sums": {n: _sum_flow(rows[-n:]) for n in (1, 5, 20) if len(rows) >= n}}


def stock_flow(code, label=None):
    """종목 투자자별 순매수. 네이버는 수량만 주므로 그날 종가를 곱해 금액을 추정한다.

    수량 합이 0이 되지 않는 건 기타법인(자사주 매입 등)이 빠져 있기 때문이다.
    추정 금액이므로 거래소 공시값과 소수점까지 맞지는 않는다.
    """
    d = fetch(f"{MOBILE}/stock/{code}/trend?pageSize=60&page=1")
    if isinstance(d, dict) or not d:
        return {"name": label or code, "error": "수급 응답 없음"}
    rows = []
    for r in reversed(d):
        close = num(r.get("closePrice"))
        if close is None:
            continue
        def amt(key):
            q = num(r.get(key))
            return (q * close / 1e8) if q is not None else 0.0   # 억원
        rows.append({"date": r.get("bizdate"),
                     "foreign": amt("foreignerPureBuyQuant"),
                     "organ": amt("organPureBuyQuant"),
                     "individual": amt("individualPureBuyQuant"),
                     "hold_ratio": r.get("foreignerHoldRatio")})
    if not rows:
        return {"name": label or code, "error": "수급 응답 없음"}
    return {"name": label or code, "code": code, "unit": "억원", "estimated": True,
            "hold_ratio": rows[-1]["hold_ratio"],
            "hold_ratio_60d_ago": rows[0]["hold_ratio"],
            "rows": rows,
            "sums": {n: _sum_flow(rows[-n:]) for n in (1, 5, 20, 60) if len(rows) >= n}}


def _sum_flow(rows):
    return {"from": rows[0]["date"], "to": rows[-1]["date"],
            "foreign": sum(r["foreign"] for r in rows),
            "organ": sum(r["organ"] for r in rows),
            "individual": sum(r["individual"] for r in rows)}


def flow_line(item):
    if item.get("error"):
        return f"  {item['name'][:14]:<14}  오류: {item['error'][:40]}"
    out = [f"  {item['name']}" + (f"  (외국인 보유 {item['hold_ratio']}"
           f" ← 60일 전 {item['hold_ratio_60d_ago']})" if item.get("hold_ratio") else "")]
    for n, s in sorted(item["sums"].items()):
        out.append(f"    {n:>2}일 {s['from'][4:]}~{s['to'][4:]}   "
                   f"외국인 {s['foreign']:>+10,.0f}   기관 {s['organ']:>+10,.0f}   "
                   f"개인 {s['individual']:>+10,.0f}")
    return "\n".join(out)


def fx():
    x = fetch(f"{API}/marketindex/exchange/FX_USDKRW")
    info = x.get("exchangeInfo", x) if isinstance(x, dict) else {}
    merged = {**info, **{k: v for k, v in x.items() if k != "exchangeInfo"}}
    return {
        "name": "원/달러", "close": num(merged.get("closePrice")),
        "change": num(merged.get("fluctuations")),
        "pct": num(merged.get("fluctuationsRatio")),
        "desc": merged.get("description", ""),
    }


def load_watchlist():
    """watchlist.yaml — PyYAML 없이도 돌도록 아주 단순한 파서를 쓴다.

    형식:
      kr:
        - 005930 삼성전자
      us:
        - AAPL.O 애플
    """
    if not os.path.exists(WATCHLIST):
        return {"kr": [], "us": []}
    out, section = {"kr": [], "us": []}, None
    for raw in open(WATCHLIST, encoding="utf-8"):
        line = raw.split("#")[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith((" ", "-", "\t")) and line.rstrip().endswith(":"):
            section = line.strip()[:-1].lower()
            continue
        if section in out and line.strip().startswith("-"):
            parts = line.strip()[1:].strip().split(None, 1)
            if parts:
                out[section].append((parts[0], parts[1] if len(parts) > 1 else None))
    return out


def arrow(pct):
    if pct is None:
        return " "
    return "▲" if pct > 0 else ("▼" if pct < 0 else "―")


def fmt(v, unit=""):
    if v is None:
        return "—"
    s = f"{v:,.2f}" if abs(v) < 10000 else f"{v:,.0f}"
    return s + unit


def line(item, width=14):
    if item.get("error"):
        return f"  {item['name'][:width]:<{width}}  오류: {item['error'][:40]}"
    t = item.get("trend", {})
    bits = [f"  {item['name'][:width]:<{width}}",
            f"{fmt(item['close']):>12}",
            f"{arrow(item.get('pct'))}{abs(item.get('pct') or 0):>5.2f}%"]
    if "vs_ma20" in t:
        bits.append(f"20일선 {t['vs_ma20']:+5.1f}%")
    if "pos_in_range" in t:
        bits.append(f"{t.get('days', 0)}일 범위 {t['pos_in_range']:4.0f}%")
    if "from_high" in t:
        bits.append(f"고점 {t['from_high']:+5.1f}%")
    return "  ".join(bits)


def main():
    as_json = "--json" in sys.argv
    no_flow = "--no-flow" in sys.argv
    now = datetime.now(KST)
    wl = load_watchlist()

    data = {
        "generated_at": now.isoformat(),
        "fx": fx(),
        "kr_indices": [kr_index(c, n) for c, n in INDICES_KR],
        "us_indices": [us_index(c, n) for c, n in INDICES_US],
        "kr_stocks": [kr_stock(c, n) for c, n in wl["kr"]],
        "us_stocks": [us_stock(c, n) for c, n in wl["us"]],
    }

    if not no_flow:
        dates = trading_dates()
        data["flows"] = {
            "indices": [index_flow(c, n, dates) for c, n in INDICES_KR],
            # 수급은 한국 시장만 공개돼 있다. 미국 종목은 네이버가 투자자별로 주지 않는다.
            "stocks": [stock_flow(c, n) for c, n in wl["kr"]],
        }

    if as_json:
        print(json.dumps(data, ensure_ascii=False, indent=1))
        return

    print(f"\n증시 브리핑  {now.strftime('%Y-%m-%d %H:%M')} KST")
    print("=" * 78)

    print("\n[ 미국 ]  (한국 기준 전일 마감)")
    for x in data["us_indices"]:
        print(line(x))

    print("\n[ 한국 ]")
    for x in data["kr_indices"]:
        print(line(x))

    f = data["fx"]
    print(f"\n[ 환율 ]\n  {'원/달러':<14}{fmt(f['close']):>12}  "
          f"{arrow(f.get('pct'))}{abs(f.get('pct') or 0):>5.2f}%   {f.get('desc','')}")

    if data["kr_stocks"]:
        print("\n[ 관심 종목 · 한국 ]")
        for x in data["kr_stocks"]:
            print(line(x))
    if data["us_stocks"]:
        print("\n[ 관심 종목 · 미국 ]")
        for x in data["us_stocks"]:
            print(line(x))
    if not data["kr_stocks"] and not data["us_stocks"]:
        print(f"\n  * 관심 종목이 없습니다. {WATCHLIST} 에 추가하세요.")

    flows = data.get("flows")
    if flows:
        print("\n[ 수급 · 투자자별 순매수 누적 (억원) ]")
        for x in flows["indices"]:
            print(flow_line(x))
        for x in flows["stocks"]:
            print(flow_line(x))
        print("  * 종목 수급은 네이버가 수량만 주므로 그날 종가를 곱한 추정 금액이다.")

    print("\n" + "-" * 78)
    print("  20일선   현재가가 20일 이동평균 대비 몇 % 위/아래인지 (추세)")
    print("  범위     최근 구간의 저가~고가 중 현재 위치 (0% 바닥, 100% 천장)")
    print("  고점     구간 최고가 대비 몇 % 내려와 있는지")
    print("\n  시세는 네이버 금융 공개 데이터이며 지연·오차가 있을 수 있습니다.")
    print("  투자 판단의 근거로 삼기 전에 증권사 HTS/MTS에서 재확인하세요.\n")


if __name__ == "__main__":
    main()
