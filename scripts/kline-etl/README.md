# Kline ETL (foxwolf fork)

GitHub Actions runner fetches Tencent/Sina daily bars, then upserts into **flywall local Postgres** over SSH.

- Does **not** write to Neon.
- Durable store: flywall `blinkquant.kline_daily`.
- Required Actions secrets: `FLYWALL_SSH_HOST`, `FLYWALL_SSH_PASSWORD`.
