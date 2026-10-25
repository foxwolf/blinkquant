#!/usr/bin/env python3
"""Incremental A-share daily kline: Tencent/Sina short window → merge parquet → incremental.ndjson.
No scanli/HF. Resume via incremental-state.json.
"""
from __future__ import annotations

import os

import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

OUT = Path(os.environ.get("KLINE_ETL_DIR", Path(__file__).resolve().parent))
PARQUET = OUT / "parquet"
STATE = OUT / "incremental-state.json"
NDJSON = OUT / "incremental.ndjson"
CODES_FILE = OUT / "stock_codes.json"
NEON_MAX = OUT / "neon-max-dates.json"
UPDATED_CODES = OUT / "incremental-updated-codes.json"

def _window():
    from datetime import date, timedelta
    until = date.today()
    since = until - timedelta(days=45)
    return since.isoformat(), until.isoformat(), 50
SINCE, UNTIL, COUNT = _window()
WORKERS = 8
lock = Lock()


PARQUET.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

def log(msg: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {
        "done": {},
        "failed": {},
        "bars_new": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "source_max_date": None,
    }


def save_state(st: dict) -> None:
    st["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False))
    tmp.replace(STATE)


def _http_get(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            "Referer": "https://finance.qq.com/",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_rows_tencent(code: str) -> list:
    tx = code.replace(".", "")
    param = f"{tx},day,{SINCE},{UNTIL},{COUNT},qfq"
    urls = [
        f"https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?param={param}",
        f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={param}",
    ]
    last_err = None
    for url in urls:
        try:
            raw = _http_get(url)
            if not raw:
                continue
            j = json.loads(raw)
            data = j.get("data") or {}
            if not data:
                continue
            block = next(iter(data.values()))
            if not isinstance(block, dict):
                continue
            rows = block.get("qfqday") or block.get("day") or []
            if rows:
                return rows
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    return []


def fetch_rows_sina(code: str) -> list:
    tx = code.replace(".", "")
    url = (
        "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"CN_MarketData.getKLineData?symbol={tx}&scale=240&ma=no&datalen={COUNT}"
    )
    raw = _http_get(url)
    if not raw or raw.strip() in ("null", "[]"):
        return []
    arr = json.loads(raw)
    out = []
    for o in arr:
        vol_lots = float(o["volume"]) / 100.0
        out.append([o["day"], o["open"], o["close"], o["high"], o["low"], str(vol_lots)])
    return out


def fetch_rows(code: str) -> list:
    try:
        rows = fetch_rows_tencent(code)
        if rows:
            return rows
    except Exception:
        pass
    return fetch_rows_sina(code)


def probe_source_max() -> str:
    rows = fetch_rows_tencent("sh.600519") or fetch_rows_sina("sh.600519")
    if not rows:
        raise RuntimeError("probe source_max failed")
    return max(r[0] for r in rows if r and r[0])


def rows_to_records(code: str, name: str, rows: list, after_date: str | None) -> tuple[list, list]:
    is_st = 1 if ("ST" in (name or "").upper()) else 0
    records = []
    daily = []
    for r in rows:
        if len(r) < 6:
            continue
        try:
            d = r[0]
            if after_date and d <= after_date:
                continue
            o, c, h, l = float(r[1]), float(r[2]), float(r[3]), float(r[4])
            v = float(r[5] or 0)
        except (TypeError, ValueError):
            continue
        amount = v * c * 100.0
        records.append(
            {
                "date": pd.Timestamp(d).to_pydatetime(),
                "code": code,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": v,
                "amount": amount,
                "turn": 0.0,
                "pctChg": 0.0,
                "peTTM": 0.0,
                "pbMRQ": 0.0,
                "isST": is_st,
                "adjustFactor": 1.0,
                "net_amount": 0.0,
                "main_net": 0.0,
                "super_net": 0.0,
                "large_net": 0.0,
                "medium_net": 0.0,
                "small_net": 0.0,
                "total_shares": 0.0,
                "float_shares": 0.0,
                "total_mv": 0.0,
                "float_mv": 0.0,
                "forecast_yoy": 0.0,
                "is_forecast_good": 0,
                "is_forecast_bad": 0,
            }
        )
        daily.append(
            {
                "code": code,
                "trade_date": d,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": v,
                "amount": amount,
                "is_st": is_st,
            }
        )
    return records, daily


def merge_parquet(code: str, new_records: list) -> int:
    path = PARQUET / f"{code}.parquet"
    new_df = pd.DataFrame(new_records)
    new_df["date"] = pd.to_datetime(new_df["date"])
    if path.exists() and path.stat().st_size > 100:
        old = pq.read_table(path).to_pandas()
        old["date"] = pd.to_datetime(old["date"])
        # drop overlapping dates from old
        new_dates = set(new_df["date"].dt.normalize())
        old = old[~old["date"].dt.normalize().isin(new_dates)]
        # align columns
        cols = list(dict.fromkeys(list(old.columns) + list(new_df.columns)))
        for c in cols:
            if c not in old.columns:
                old[c] = 0.0 if c != "code" else code
            if c not in new_df.columns:
                new_df[c] = 0.0 if c != "code" else code
        df = pd.concat([old[cols], new_df[cols]], ignore_index=True)
        df = df.sort_values("date").drop_duplicates(subset=["date"], keep="last")
    else:
        df = new_df.sort_values("date").drop_duplicates(subset=["date"], keep="last")
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), path, compression="zstd")
    return path.stat().st_size


def process(code: str, name: str, neon_max: str | None, source_max: str) -> dict:
    if neon_max and neon_max >= source_max:
        return {"code": code, "status": "skip", "bars_new": 0, "neon_max": neon_max}
    try:
        rows = fetch_rows(code)
        if not rows:
            return {"code": code, "status": "empty", "bars_new": 0}
        local_source_max = max(r[0] for r in rows if r and r[0])
        records, daily = rows_to_records(code, name, rows, neon_max)
        if not daily:
            return {
                "code": code,
                "status": "up_to_date",
                "bars_new": 0,
                "neon_max": neon_max,
                "src_max": local_source_max,
            }
        byte_len = merge_parquet(code, records)
        return {
            "code": code,
            "status": "ok",
            "bars_new": len(daily),
            "daily": daily,
            "byte_len": byte_len,
            "neon_max": neon_max,
            "src_max": local_source_max,
        }
    except Exception as e:
        return {"code": code, "status": "error", "bars_new": 0, "error": f"{type(e).__name__}: {e}"}


def main():
    resume = "--resume" in sys.argv
    codes = json.loads(CODES_FILE.read_text())
    neon_map = json.loads(NEON_MAX.read_text()) if NEON_MAX.exists() else {}
    st = load_state() if resume else {
        "done": {},
        "failed": {},
        "bars_new": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "source_max_date": None,
    }
    if not resume and NDJSON.exists():
        NDJSON.unlink()

    source_max = st.get("source_max_date") or probe_source_max()
    st["source_max_date"] = source_max
    log(f"source_max_date={source_max}")

    name_map = {i["code"]: i.get("name") or "" for i in codes}
    # prefer codes that have neon history or parquet
    all_codes = sorted(set(list(neon_map.keys()) + [i["code"] for i in codes if (PARQUET / f"{i['code']}.parquet").exists()]))
    todo = []
    for code in all_codes:
        if code in st["done"] and st["done"][code].get("status") in ("ok", "skip", "up_to_date", "empty"):
            continue
        nm = neon_map.get(code)
        if nm and nm >= source_max:
            st["done"][code] = {"status": "skip", "bars_new": 0, "neon_max": nm}
            continue
        todo.append(code)

    log(f"incremental todo={len(todo)} already_done={len(st['done'])} neon_codes={len(neon_map)}")
    save_state(st)

    ok = empty = err = skip_like = 0
    bars_new = int(st.get("bars_new") or 0)
    updated = []
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=WORKERS) as ex, NDJSON.open("a", encoding="utf-8") as out:
        futs = {ex.submit(process, c, name_map.get(c, ""), neon_map.get(c), source_max): c for c in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            res = fut.result()
            code = res["code"]
            with lock:
                status = res["status"]
                if status == "ok":
                    ok += 1
                    bars_new += res["bars_new"]
                    for row in res["daily"]:
                        out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                    updated.append(code)
                    st["done"][code] = {
                        "status": "ok",
                        "bars_new": res["bars_new"],
                        "byte_len": res.get("byte_len"),
                        "neon_max": res.get("neon_max"),
                        "src_max": res.get("src_max"),
                        "at": datetime.now(timezone.utc).isoformat(),
                    }
                    st.get("failed", {}).pop(code, None)
                elif status in ("skip", "up_to_date"):
                    skip_like += 1
                    st["done"][code] = {
                        "status": status,
                        "bars_new": 0,
                        "neon_max": res.get("neon_max"),
                        "src_max": res.get("src_max"),
                    }
                elif status == "empty":
                    empty += 1
                    st["done"][code] = {"status": "empty", "bars_new": 0}
                else:
                    err += 1
                    st.setdefault("failed", {})[code] = {
                        "error": res.get("error"),
                        "at": datetime.now(timezone.utc).isoformat(),
                    }
                st["bars_new"] = bars_new
                if i % 80 == 0 or i == len(todo):
                    save_state(st)
                    UPDATED_CODES.write_text(json.dumps(updated, ensure_ascii=False))
                    rate = i / max(time.time() - t0, 1)
                    log(
                        f"fetch {i}/{len(todo)} ok={ok} empty={empty} err={err} "
                        f"skipish={skip_like} bars_new={bars_new} {rate:.2f}/s last={code}"
                    )

    save_state(st)
    UPDATED_CODES.write_text(json.dumps(updated, ensure_ascii=False))
    # also include previously done ok codes for upload resume
    all_updated = [c for c, v in st["done"].items() if v.get("status") == "ok" and v.get("bars_new", 0) > 0]
    UPDATED_CODES.write_text(json.dumps(all_updated, ensure_ascii=False))
    log(
        f"fetch done ok={ok} empty={empty} err={err} bars_new={bars_new} "
        f"failed={len(st.get('failed', {}))} source_max={source_max}"
    )
    print(json.dumps({
        "source_max_date": source_max,
        "ok": ok,
        "empty": empty,
        "err": err,
        "bars_new": bars_new,
        "updated_codes": len(all_updated),
        "failed": list(st.get("failed", {}).keys())[:50],
        "failed_count": len(st.get("failed", {})),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
