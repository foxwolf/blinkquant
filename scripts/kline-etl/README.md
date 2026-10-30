# Kline ETL (foxwolf fork)

GitHub Actions runner fetches Tencent/Sina daily bars, then upserts into **flywall local Postgres** over SSH.

- Does **not** write to Neon.
- Durable store: flywall `blinkquant.kline_daily`.
- Baseline: `export_pg_max.py` reads per-code `max(trade_date)` from flywall over SSH → `pg-max-dates.json`.
- Universe: `stock_codes.json` (full A-share list).
- Required Actions secrets: `FLYWALL_SSH_HOST`, `FLYWALL_SSH_PASSWORD`.
- Optional: `FLYWALL_SSH_USER` (default `root`), `FLYWALL_PG_DB` (default `blinkquant`).
- Schedule: weekdays 08:30 UTC ≈ 16:30 Asia/Shanghai.
