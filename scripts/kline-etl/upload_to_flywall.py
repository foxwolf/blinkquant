#!/usr/bin/env python3
"""Upsert incremental.ndjson into flywall Postgres over SSH using remote psql COPY.
Env: FLYWALL_SSH_HOST, FLYWALL_SSH_PASSWORD, optional FLYWALL_SSH_USER, FLYWALL_PG_DB, KLINE_ETL_DIR.
Does NOT write to Neon.
"""
from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

OUT = Path(os.environ.get("KLINE_ETL_DIR", Path(__file__).resolve().parent))
NDJSON = OUT / "incremental.ndjson"
HOST = os.environ["FLYWALL_SSH_HOST"]
USER = os.environ.get("FLYWALL_SSH_USER") or "root"
PASSWORD = os.environ.get("FLYWALL_SSH_PASSWORD", "")
PG_DB = os.environ.get("FLYWALL_PG_DB") or "blinkquant"


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    if not NDJSON.exists():
        log(f"missing {NDJSON}")
        return 1
    if not PASSWORD:
        log("FLYWALL_SSH_PASSWORD missing")
        return 1

    buf = io.StringIO()
    w = csv.writer(buf)
    n = 0
    with NDJSON.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            w.writerow([
                r["code"], r["trade_date"], r["open"], r["high"], r["low"], r["close"],
                r.get("volume", 0), r.get("amount", 0), int(r.get("is_st") or 0),
            ])
            n += 1
    log(f"rows={n}")
    if n == 0:
        return 0

    sql = f"""
CREATE TEMP TABLE kline_daily_stage (
  code text, trade_date date, open float8, high float8, low float8, close float8,
  volume float8, amount float8, is_st int
);
\\copy kline_daily_stage FROM '/tmp/kline_inc.csv' WITH (FORMAT csv)
INSERT INTO kline_daily AS t (code, trade_date, open, high, low, close, volume, amount, is_st)
SELECT code, trade_date, open, high, low, close, volume, amount, is_st FROM kline_daily_stage
ON CONFLICT (code, trade_date) DO UPDATE SET
  open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close,
  volume=EXCLUDED.volume, amount=EXCLUDED.amount, is_st=EXCLUDED.is_st;
SELECT count(*) AS staged FROM kline_daily_stage;
"""
    with tempfile.TemporaryDirectory() as td:
        csv_path = Path(td) / "kline_inc.csv"
        sql_path = Path(td) / "upsert.sql"
        csv_path.write_text(buf.getvalue())
        sql_path.write_text(sql)
        for local, remote in [(csv_path, "/tmp/kline_inc.csv"), (sql_path, "/tmp/kline_upsert.sql")]:
            r = subprocess.run([
                "sshpass", "-p", PASSWORD, "scp",
                "-o", "StrictHostKeyChecking=no",
                "-o", "PreferredAuthentications=password",
                "-o", "PubkeyAuthentication=no",
                str(local), f"{USER}@{HOST}:{remote}",
            ], capture_output=True)
            if r.returncode != 0:
                log((r.stderr or r.stdout).decode())
                return r.returncode
        r = subprocess.run([
            "sshpass", "-p", PASSWORD, "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "PreferredAuthentications=password",
            "-o", "PubkeyAuthentication=no",
            f"{USER}@{HOST}",
            f"sudo -u postgres psql -v ON_ERROR_STOP=1 -d {PG_DB} -f /tmp/kline_upsert.sql"
            " && rm -f /tmp/kline_inc.csv /tmp/kline_upsert.sql",
        ], capture_output=True)
        log((r.stdout or b"").decode() + (r.stderr or b"").decode())
        return r.returncode


if __name__ == "__main__":
    sys.exit(main())
