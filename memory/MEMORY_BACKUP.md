# scanligithub 助手记忆备份

导出时间：2026-11-10（Asia/Shanghai）  
助手：scanligithub（Grok Bot）  
用途：整理本助手关于 BlinkQuant / foxwolfdev 软分叉的约定与工作记录，防止会话压缩或助手重建后丢失上下文。  
仓库落点：[foxwolf/blinkquant](https://github.com/foxwolf/blinkquant) 的 `memory/`（本文件）。  
原则：**不写入密码、令牌、数据库连接串或其他密钥**；账户名与公开 URL 可保留。

## 用户与工作方式

- 用户称呼：sciedi；聊天用中文。
- 本助手主要用于 GitHub 仓库分析与 foxwolfdev 软分叉运维；报告偏好详细中文结构化说明，并带 GitHub Markdown 链接。
- 用户自称对股票与行情数据是初学者；解释时避免假设已有量化背景。
- 本机机器名：`hw`（与云电脑文件系统隔离，需显式连接才可访问）。
- 云电脑（box）：Debian 13，约 8 核 / 15G 内存 / 128G 磁盘；foxwolfdev 源码、日线种子与部署在此完成。

## 账户与公开入口（无密钥）

- GitHub：`foxwolf`（对相关仓库有管理权限）；上游分析对象常为公开仓 [scanligithub/blinkquant](https://github.com/scanligithub/blinkquant)。
- Hugging Face：用户名 `foxwolf-ym`；原前端曾在 https://foxwolf-ym-bq-front.static.hf.space 。
- Gmail：`foxwolf.discuss@gmail.com`；部分站点不接受 Gmail 地址中的点号时，使用等价地址 `foxwolfdiscuss@gmail.com`（邮件仍进同一收件箱）。
- 站点：
  - https://foxwolfdev.de5.net/ （Cloudflare Pages 项目 `bq-cluster-front`；同时有 https://bq-cluster-front.pages.dev/ ）
  - DNSHE 将 `foxwolfdev.de5.net` 顶点 CNAME 到 `bq-cluster-front.pages.dev`
  - flywall Tunnel 入口（本机 Node + 本机 PG）：https://bq.fly2fly.eu.org/ 、https://foxwolfdev.fly2fly.eu.org/
- 演示账号存在且登录页不再展示口令；口令与 Neon `DATABASE_URL`、邀请码明文、HF/LLM 令牌均不在本文件。

## 架构现状（截至 2026-11-10 本助手所知）

### 双栈分工

| 栈 | 入口 | 数据 | 职责 |
|---|---|---|---|
| foxwolfdev（本助手侧） | CF Pages + Worker + 域名 de5.net | Neon 项目 `blinkquant-cf`（id `green-cloud-67523511`） | 站点、用户/策略/任务等业务表；**运行时不得调用 scanli / HF 节点** |
| flywall（本机） | Cloudflare Tunnel → 本机 `127.0.0.1:3000` + 本机 PostgreSQL | 本机 `kline_daily` / `kline_blobs` | **全 A 日线热源与工作日增量** |

- 软分叉约束：全部行情与选股/回测计算须在 foxwolfdev 栈（Neon + 云电脑）或已移交的 flywall 本机栈完成，**零运行时交互 scanli/HF 节点**。
- B1 切流（把 `foxwolfdev.de5.net` DNS 改到 flywall Tunnel、站点改读本机 PG）曾讨论后搁置；生产品牌站仍为 **CF Pages + Neon**。在 flywall 明确回报「DNS 已生效 / 站点可用」之前，不要按旧的 B1 方案去停相关任务。
- 因 Vercel 手机验证受阻，前端改为 Cloudflare Pages + DNSHE，不再以 Vercel 为优先部署。

### Neon

- 项目：`blinkquant-cf`（`green-cloud-67523511`），区域 `aws-ap-southeast-1`，分支曾用 `br-dark-violet-ao32d63o`；免费档逻辑容量约 1024MB（月初重置不等于存储自动清空）。
- 2026-10-29：项目触达容量上限，部分 `kline_blobs` 写入失败。
- 2026-10-30：用户批准后，将 `kline_daily` 冷备到 GitHub Release，再 **TRUNCATE** `kline_daily` 与 `kline_blobs`（未动 users 等小表，未改 Pages）。库体积约 **1002MB → 14MB**。控制台 `logical_size` 可能短暂滞后，以库内实际大小为准。
- 冷备：[kline-daily-archive-20261030](https://github.com/foxwolf/blinkquant/releases/tag/kline-daily-archive-20261030)（约 4,130,242 行 / 5577 只代码 / 2005-01-04～2026-10-29，22 个年份 Parquet，约 86MiB，另有 MANIFEST/README）。这是 **Neon 窄表日线归档**，不能替代 stockA 宽表，也不能当在线库热读。
- 业务数据（users、strategies、tasks、artifacts、invite 等）仍在 Neon；站点 Pages 仍读 Neon。

### 全 A 日线增量

- 原例程 **foxwolfdev 全A日线增量**（文件夹 `foxwolfdev-a`）：工作日约北京时间 17:00（可前后 15 分钟）腾讯 → Neon；最后一次成功约 2026-10-29。**已暂停**（职责移交 flywall，且 Neon 当时已满）。
- 移交后：**唯一增量路径**是 flywall 本机 PG（材料在云电脑 `/workspace/bq-actions-pack`，含 `kline-etl-flywall.yml` 与 `fetch_incremental.py`）。仓库内对应 [foxwolf/blinkquant](https://github.com/foxwolf/blinkquant) 的 Actions `kline-etl-flywall.yml`。
- 本助手最后对齐（2026-10-30 当晚）：flywall 用新浪补 10-30 缺口，upsert +2074；当时本机 `kline_daily=4,136,224`，当日 distinct=5570，仍缺 4 只（新浪无 bar）：`sh.605258` `sh.688121` `sz.002827` `sz.301139`。之后日更由 flywall 继续，本文件不追踪其后续条数。
- 腾讯源在个别交易日可能晚于新浪或缺深市/创业板；急救补洞优先新浪，不适合当晚靠 stockA/通达信。

## 仓库与数据落点

| 对象 | 说明 |
|---|---|
| [scanligithub/blinkquant](https://github.com/scanligithub/blinkquant) | 上游公开代码仓（约 7.5MB git / 完整 clone 约 16MB，无 Git LFS） |
| [foxwolf/blinkquant](https://github.com/foxwolf/blinkquant) | 用户 fork；冷备 Release、flywall ETL Actions、本记忆备份所在仓 |
| [scanligithub/stockA](https://github.com/scanligithub/stockA) | 采集/发布工程，不是把全 A 塞进 git；主产物在 Release 标签 [`archive`](https://github.com/scanligithub/stockA/releases/tag/archive)（约 919MiB / 126 文件） |
| HF 私有库 `scanli/stocka-data` | BlinkQuant 节点用的年份 Parquet 权威源（约 0.9GiB，无 token 会 401）；与 Release 结构同类，日常以 HF Daily Update 为更新 |
| foxwolfdev 源码（云电脑） | `/workspace/bq-blinkquant-cf`、`/workspace/bq-bq-deploy`、`/workspace/bq-kline-seed`、`/workspace/bq-actions-pack` |
| Neon 冷备导出（云电脑） | `/workspace/bq-kline-archive/neon-kline-daily-20261030/` |

### 上游数据文件结构（stockA / stocka-data）

```
stock_list.parquet
sector_list.parquet
index_list.parquet
stock_kline_{YYYY}.parquet
stock_money_flow_{YYYY}.parquet
sector_kline_{YYYY}.parquet
sector_constituents_{YYYY}.parquet
index_kline_{YYYY}.parquet
all_stocks_f10_raw.parquet
all_stocks_mainbus_raw.parquet
event_earnings_forecast.parquet
corporate_actions/…（若有）
```

Release `archive` 约略拆分：stock_kline ~568MiB，money_flow ~231，sector_kline ~65，F10/mainbus 等其余。运行时 3 个 HF Space 节点按 `code.hash() % 3` 分片进内存（文档约 2–3GB/节点），与落盘约 1GB 不是一回事。

## 软分叉功能演进要点（2026-10-21～10-22）

- 前端部署在 Cloudflare Pages `bq-cluster-front`，绑定 `foxwolfdev.de5.net`。
- 早期 Worker 曾把 K 线/板块代理到 `scanli-blinkquant-node*.hf.space`；随后改为 **Neon 优先**（`kline_blobs` / `kline_daily`），并做到运行时切断 scanli/HF。
- 自选、策略、任务、成果页补齐 SSR 壳与 `_next/static`；mutations 一度 501，后逐步接线。
- 邀请码校验走 `/api/auth/meta` 的 `requireInvite`（勿再 stub 掉该字段）。
- `/admin` 的用户与大模型配置 API 接到 Neon。
- 登录页不再展示演示口令。
- 选股：本地简单公式可走 Neon `kline_daily` SQL（如 CLOSE / MA）；复杂公式与回测曾有 stub。有一版曾把选股任务代理到 scanli，**与后来的「零运行时 scanli」约束冲突，重建时以零运行时约束为准**。
- 全量日线种子（2026-10-22）：腾讯 → 云电脑 → Neon，约 5577 只 / ~410 万根；该次种子未走 scanli。

## 评估结论备忘（尚未执行拷贝）

2026-11-02：用户通过「公司工作环境」询问把 **scanli 数据拷到公司 node2**（内网 `10.168.1.9`，公网花生壳 `chinasky.xicp.net` SSH 22 / HTTP 28080）。用户明确：**先只评估，不要开始传输**。

结论摘要：

- 「scanli 数据」指 HF `scanli/stocka-data`（及可核快照 stockA Release `archive`），约 **0.9GiB**，不是 flywall 本机 PG，也不是 Neon 冷备窄表。
- node2 磁盘：`/` 约剩 53G，`/home` 120G 很空；`/mnt/1` 已满，`/mnt/2`/`/mnt/3` 已 90% 以上。**建议落 `/home/<user>/scanli/{repos,data/stocka-data}`，不要用将近满的 `/mnt/*`。**
- 传输：优先在 node2 用 HF 令牌下载数据集；次选 `gh release download archive -R scanligithub/stockA`。代码用 `git clone`，不需要 Git LFS。有现成缓存机再用 rsync，并排除 `.env` 与密钥。
- 不要把密钥拷进目录树；foxwolfdev 运行时不要接回这份副本；与 flywall 热源不等价。用户成果（Node1 SQLite / blinkquant-results）是否拷贝需另行确认。

## 相关判断（已答复、无需再当作待办）

- Neon K 线可以像 stockA 一样放到 GitHub Release **做归档**，但不能当在线库替代 PG；要腾 Neon 空间必须删表（已做）。
- Gitsi 当时仅兼容 HF Hub 的模型/数据集，Spaces / Inference 不可用，**不能**替代 Neon 或 HF Spaces。
- stockA 的「Daily Update to Hugging Face」没有自带 cron，需外部 dispatch 或手动。

## 本助手例程

| 名称 | 文件夹 | 状态 | 说明 |
|------|--------|------|------|
| foxwolfdev 全A日线增量 | `foxwolfdev-a` | **已暂停** | 原工作日约 17:00 腾讯→Neon；已移交 flywall，勿在未确认前恢复 |

## 恢复提示

1. 聊天中文；foxwolfdev **零运行时 scanli/HF**。
2. 品牌站仍是 CF Pages + Neon；K 线热数据与工作日增量在 flywall 本机 PG。
3. 不要把已归档的 K 线再灌回 Neon 撑满免费档；需要历史日线用 Release 或 flywall 库。
4. 例程 `foxwolfdev-a` 保持暂停，除非用户明确改回「写 Neon」。
5. 密钥在 Vault / 云电脑受控文件（如 `/workspace/.bq-neon-database-url`），不要提交进 git。
6. 公司 node2 的 scanli 拷贝在用户再次点头并确认范围前不要启动。

## 明确未写入本文件的内容

密码、邀请码明文、`DATABASE_URL`、`HF_TOKEN`、`AUTH_SECRET`、LLM 密钥、SSH 密码等。
