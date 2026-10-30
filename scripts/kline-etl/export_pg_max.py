#!/usr/bin/env python3
"""Export per-code max(trade_date) from flywall Postgres over SSH → pg-max-dates.json.
Env: FLYWALL_SSH_HOST, FLYWALL_SSH_PASSWORD, optional FLYWALL_SSH_USER, FLYWALL_PG_DB, KLINE_ETL_DIR.
Does NOT touch Neon.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

OUT = Path(os.environ.get("KLINE_ETL_DIR", Path(__file__).resolve().parent))
HOST = os.environ.get("FLYWALL_SSH_HOST") or ""
USER = os.environ.get("FLYWALL_SSH_USER") or "root"
PASSWORD = os.environ.get("FLYWALL_SSH_PASSWORD") or ""
PG_DB = os.environ.get("FLYWALL_PG_DB") or "blinkquant"
OUT_FILE = OUT / "pg-max-dates.json"


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    if not HOST or not PASSWORD:
        log("FLYWALL_SSH_HOST / FLYWALL_SSH_PASSWORD required")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    # Single-quoted -c argument for remote bash; SQL uses double quotes only for identifiers if needed
    sql = "COPY (SELECT code, max(trade_date)::text FROM kline_daily GROUP BY code) TO STDOUT WITH (FORMAT csv)"
    remote_cmd = f"sudo -u postgres psql -d {PG_DB} -v ON_ERROR_STOP=1 -Atc '{sql}'"
    r = subprocess.run(
        [
            "sshpass", "-p", PASSWORD, "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "PreferredAuthentications=password",
            "-o", "PubkeyAuthentication=no",
            f"{USER}@{HOST}",
            remote_cmd,
        ],
        capture_output=True,
    )
    if r.returncode != 0:
        log((r.stderr or r.stdout).decode(errors="replace"))
        return r.returncode
    mapping: dict[str, str] = {}
    for line in (r.stdout or b"").decode().splitlines():
        line = line.strip()
        if not line or "," not in line:
            continue
        code, date = line.split(",", 1)
        code, date = code.strip(), date.strip()
        if code and date:
            mapping[code] = date
    OUT_FILE.write_text(json.dumps(mapping, ensure_ascii=False))
    log(f"wrote {OUT_FILE} codes={len(mapping)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
