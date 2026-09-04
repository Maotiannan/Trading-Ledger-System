# 数据文件与外部接口说明

本文件给维护人员和外部系统接入方使用。普通用户只需要阅读 `README.md`。

## 外部查询接口

### Excel ML 单值查询

Excel 查询使用 `设置 -> Excel ML 令牌` 生成的账号 token。token 只显示一次，后端只保存哈希；权限沿用生成 token 的账号。

```bash
GET /api/excel/ml?orderNo=GANDO-10&field=2
Authorization: Bearer <Excel ML token>
```

默认返回纯文本，适合 Excel 自定义函数读取；加 `format=json` 会返回匹配方式、字段名、客户 ID 等诊断信息。

字段编号：

| 编号 | 字段 |
|---|---|
| 1 | ORDER NAME |
| 2 | COMPANY NAME，空时回退网页客户管理的 NAME |
| 3 | MARK |
| 4 | CUSTOMER NAME |
| 5 | COMPANY NAME |
| 6 | PHONE |
| 7 | CITY |
| 8 | CONSIGNEE |
| 9 | COMPANY ADDRESS |
| 10 | CREDIT |
| 11 | CUSTOMER ID |

### Excel ML 批量查询

```bash
POST /api/excel/ml/batch
Authorization: Bearer <Excel ML token>
Content-Type: application/json
```

### 按 ORDER NO 批量查询客户资料

```bash
POST /api/sync/customers/by-orders
Authorization: Bearer <Excel ML token>
Content-Type: application/json

{
  "orderNos": ["GANDO-10", "SUPERDT2-09"]
}
```

成功项包含 `matchedBy / matchedOrderNo / invNo / customer`。`customer` 包含 `id / mark / orderName / orderNames / name / displayName / phone / city / consignee / companyName / companyAddress / credit`。失败项只影响当前 `ORDER NO`，不会导致整批失败。

### 客户增量同步

```bash
GET /api/sync/customers?since=<cursor>
```

返回新增/修改客户、删除标记、停用标记占位、下一次同步游标。外部系统保存 `nextCursor` 并在下一次请求原样传回。

### ORDER NO -> CONSIGNEE 写入

```bash
POST /api/customers/order-consignee/write
Content-Type: application/json

{
  "orderNo": "AB-12",
  "consignee": "..."
}
```

同一 `ORDER NO` 同一 `CONSIGNEE` 重复写入必须幂等成功。兼容路径：`/customers/order-consignee/write`。

## MU Contract PI -> Orders 同步

该集成只把 MU Contract 中已经绑定 `ORDER NO` 的 PI 元数据同步到 MULEDGER 的独立 `Orders` 页面。它不会写入财务订单、发票、收据、付款明细、SWIFT、余额或媒体文件。

### 数据方向与身份

- 数据方向固定为 `MU Contract -> MULEDGER`，由 MULEDGER 主动拉取。
- MU Contract 隐藏 PI ID 是跨系统稳定身份；`ORDER NO` 是可修改的业务键。
- MULEDGER 已有人工作业单优先。命中时只挂接来源元数据，不覆盖创建人、权限范围、客户、状态、PI 状态、备注、系统备注或确认日期。
- 已挂接到人工 Orders 的 PI 后续事件不会覆盖客户快照、财务订单引用、状态、PI 状态、备注、系统备注或确认日期；同一隐藏 PI ID 的 `ORDER NO` 改名会同步更新该行的订单号和搜索索引。新订单号已被其他行占用时停止改名并记录冲突，不覆盖任何人工数据。
- 只有 MU Contract 正式 PI PDF 成功生成或重新生成后，金额才成为官方同步金额；草稿金额不会同步。
- 来源删除或解除 `ORDER NO` 只会停用来源关联，不会删除 MULEDGER 的 Orders 记录。

### MU Contract 只读源接口

两个接口都使用独立 Bearer token、`Cache-Control: no-store` 和 JSON Schema v1：

```http
GET /integrations/muledger/order-events?after=<cursor>&limit=<1..500>
GET /integrations/muledger/order-snapshot?after=<snapshot-cursor>&limit=<1..500>
Authorization: Bearer <MULEDGER_ORDER_SYNC_TOKEN>
```

事件接口按持久化十进制游标增量返回；快照接口用于首次或人工 Full Reconcile。共享结构契约位于 `docs/integrations/mu-contract-order-sync-v1.schema.json`，并与 MU Contract 仓库中的源文件保持逐字节一致。事件游标限定为 `0..9223372036854775807` 的最多 19 位十进制字符串；快照分页使用来源签发、最长 256 字符的不透明游标，MULEDGER 只原样回传，不解析或改写。来源版本限定为 `1..2147483647`，正式金额限定为最多 16 位整数加固定两位小数。

事件页先验证页结构和可安全持久化的 `cursor / eventId / source.piId / source.version` 身份，再验证业务载荷。身份安全但业务字段无效的 v1 事件会在单个事务中写入不含原始载荷的 `INVALID_SOURCE_DATA` 冲突、事件收据和已提交游标，并继续处理后续事件；身份或游标本身不安全时整页拒绝。快照接口仍使用完整严格校验，不采用该跳过策略。

### MULEDGER 控制接口

```http
POST /api/internal/integrations/mu-contract/pull
x-maintenance-token: <MAINTENANCE_JOB_TOKEN>

GET /api/integrations/mu-contract/status
POST /api/integrations/mu-contract/actions
```

后两个接口仅限 ADMIN。`actions` 只接受：

- `sync-now`
- `preview-reconcile`
- `apply-reconcile`，并且必须携带仍有效的 `previewId`

Full Reconcile 必须先预览再确认执行；预览 15 分钟后失效。Apply 在写入前重新读取完整分页快照，要求所有页面高水位一致、PI ID 全局唯一且稳定递增，并重新核对来源汇总和本地目标状态；快照分页游标始终使用来源返回值。任何变化都返回 `409` 并要求重新预览。通过后按设置批量事务提交，并以来源 PI ID 保存处理断点。首次 Full Reconcile 完成前，系统拒绝启用普通增量同步。

预览中的 ORDER NO 重复冲突只统计同时有效的来源 PI。来源为保留历史而返回的 inactive PI 不参与重复计数，因此“一个失效旧 PI + 一个有效替代 PI”属于正常接替而不是冲突；同一标准化 ORDER NO 同时存在两个或更多 active PI 时仍按冲突保护，不自动覆盖。

`Sync Now` 或 `apply-reconcile` 遇到有效租约竞争时返回可读的 `409`“未完成”结果，而不是成功响应；设置页保留现有 Full Reconcile 预览供稍后重试。所有成功、失败和对账状态写入都带当前 `leaseOwner` 条件，过期 worker 不能覆盖接管者。

Orders 的 `resolve-source-customer` 动作仅允许 ADMIN 处理 `UNMATCHED / CONFLICT` 的同步行，所选客户必须位于该管理员现有层级可见范围内。它在一个事务中更新 Orders 客户快照与 `needsCustomerFix`、来源匹配状态和人工编辑标记，关闭对应客户冲突，并写入 before/after 审计；普通人工行、已匹配同步行和非 ADMIN 均不能使用，财务表不会被修改。

### 配置与运行

源地址和源令牌只允许放在运行环境，不写入数据库、设置审计、接口响应或日志：

| 环境变量 | 用途 |
|---|---|
| `MU_CONTRACT_SYNC_BASE_URL` | MU Contract 内部源服务地址 |
| `MU_CONTRACT_SYNC_TOKEN` | 调用源接口的独立 Bearer token |
| `MAINTENANCE_JOB_TOKEN` | Docker 触发器调用 MULEDGER 内部 pull 接口 |

ADMIN 可在设置页持久化启用状态、轮询间隔 `10..3600` 秒和批量大小 `1..500`。Docker `mucontract-sync-trigger` 每 5 秒唤醒一次内部接口；后端根据持久化的下一次可运行时间决定是否真正拉取，避免把业务调度逻辑放进容器脚本。

生产环境已于 2026-07-19 完成首次 Full Reconcile 并启用 30 秒增量同步。上线时 53 条来源 PI 全部匹配，0 未匹配、0 冲突，提交游标为 106；完整备份、隔离恢复、迁移、对账和业务表不变证据见 `docs/backup/restore-drills/2026-07-19-muledger-nas-local-backup-rollout.md`。

### 持久化与冲突

以下五张表都位于 MySQL `trading_ledger`，由现有完整数据库 dump 自动覆盖：

| 表 | 用途 |
|---|---|
| `ExternalOrderSourceLink` | PI 稳定身份、当前 ORDER NO、正式金额及 Orders 挂接关系 |
| `IntegrationSyncState` | 已提交游标、租约、最近结果和首次 Full Reconcile 状态 |
| `IntegrationEventReceipt` | 事件幂等收据和载荷哈希 |
| `IntegrationSyncConflict` | 订单号、来源关联、客户匹配和币种冲突证据 |
| `IntegrationReconcilePreview` | 有效期内的 Full Reconcile 摘要、完整快照/目标状态指纹 |

单次事件处理、事件收据和游标提交在同一数据库事务内完成。120 秒可续租租约防止两个触发器并行应用同一批事件。冲突只记录并等待管理员处理，不自动覆盖人工数据。重命名转移时，被归档的未人工编辑同步行保留原 `orderNo` 和审计历史，但其唯一标准化业务键会改为由行 ID 派生的确定性归档键，确保旧 ORDER NO 后续可以创建新的可见行。

### 部署与回滚顺序

1. 先备份并部署 MU Contract 的增量迁移、只读 feed 和历史来源初始化，验证两个源接口。
2. 从最新且校验通过的 MULEDGER NAS 快照恢复到隔离 MariaDB，针对副本执行新迁移和恢复检查；不得直接拿生产库试迁移。
3. 备份正式 MULEDGER 后部署迁移和应用，配置源地址/令牌；同步保持关闭。
4. ADMIN 执行 Full Reconcile 预览并确认数量，再执行 apply；检查未匹配和冲突。
5. 完成首次 Full Reconcile 后才启用增量同步。

需要回滚应用时，先在设置中关闭同步并停止 `mucontract-sync-trigger`。不要删除五张集成表或已创建的 Orders 历史；旧应用版本回滚前必须确认其 Prisma schema 能忽略新增表和新增可空字段。该集成没有 NAS 文件和外部对象存储写入。

## 业务数据范围

系统数据分为两类：

| 类型 | 位置 | 备份要求 |
|---|---|---|
| 业务结构化数据 | MySQL `trading_ledger` | 必须备份完整业务库 |
| 上传或生成文件 | NAS 挂载目录 `${UPLOAD_HOST_DIR}` | 必须备份完整上传目录 |

NAS 完整快照、校验、保留和隔离恢复流程见 `docs/backup/muledger-local-backup.md`。当前快照根目录为 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger`，数据库与上传文件每次都创建完整快照并保留 30 天。

## MySQL 业务数据库

项目通过 `DATABASE_URL` 连接 MySQL。核心业务数据包括：

- 用户、角色、权限树
- 客户资料、客户多个 `ORDER_NAME`、多个 `CONSIGNEE`
- 发票、订单、订单余额
- 收据、付款明细、SWIFT 水单
- 余额转移及其唯一关联的系统生成收据；`BalanceTransfer.generatedReceiptId` 与对应 Receipt 都在完整数据库快照中
- 删除审批、修改审批
- 系统配置、配置审计、操作审计
- Excel ML token 哈希
- 上传资产台账 `UploadedAsset`
- 签名收据会话与收据编号计数器
- Payment Agent 资料与文件索引
- MU Contract Orders 来源关联、同步游标、事件幂等收据、冲突与对账预览
- 客户通知邮箱和语言偏好、邮件模板、待审核任务、冻结后的收件人/正文、发送尝试和 Resend webhook 事件

注意：MySQL 数据文件不在项目 Git 仓库，也不在 app 容器里。备份数据库时应备份 `trading_ledger` 业务库，而不是只备份项目代码。

余额转移必须通过 `BalanceTransfer.generatedReceiptId` 明确关联到唯一的 `TRANSFER-*` Receipt。该关系用于管理员撤销和收据改绑时的事务校验；历史迁移只回填源订单、目标订单、金额、创建者、文案和创建时间均一致且双方唯一的候选，无法唯一确认的历史记录不会自动猜测。撤销会同步重算源/目标订单余额并写审计，不会新增或移动 NAS 文件。

## NAS 上传文件目录

Docker 将宿主机 NAS 目录挂载到容器内：

```bash
${UPLOAD_HOST_DIR}:/app/upload
```

默认宿主机目录：

```bash
/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload
```

应用默认写入容器内：

```bash
/app/upload/images
```

网页和数据库里保存受保护访问路径：

```bash
/upload/images/...
```

文件读取统一走：

```bash
GET /api/upload-image?path=/upload/images/...
```

## NAS 目录结构

| 目录 | 来源 | 说明 |
|---|---|---|
| `/upload/images/receipts/direct` | Create Receipt Directly | 直接创建收据上传图片 |
| `/upload/images/receipts/ocr` | Upload Receipt | 收据 OCR 上传图片 |
| `/upload/images/details/ocr` | Upload Payment Detail | 付款明细 OCR 上传图片 |
| `/upload/images/swifts/ocr` | Upload SWIFT Record | SWIFT 图片或 PDF 附件 |
| `/upload/images/receipts/generated/YYYY/MM` | Generate Signed Receipt | 最终签名收据图片 |
| `/upload/images/receipts/generated/YYYY/MM/signatures` | Generate Signed Receipt | 收款方和付款方透明签名图片 |
| `/upload/images/agents/files` | Payment Agent Management | 付款代理公司附件 |
| `/upload/images/customers/files` | Customer Management | 客户公司文件附件 |
| `/upload/images/<file>` | 历史入口 | 兼容旧上传路径，不建议新功能继续使用 |

## 上传文件支持类型

普通业务图片上传支持 JPG、JPEG、PNG、WEBP、HEIC、HEIF。

SWIFT、Payment Agent 附件和客户公司文件额外支持 PDF、DOC、DOCX、XLS、XLSX、TXT。客户公司文件的自动识别优先支持图片、PDF 和 TXT；Office 文件先保存绑定，暂不自动识别。

系统会检查文件扩展名和文件内容是否匹配，避免伪装文件进入业务链路。

## 上传资产台账与清理规则

数据库表 `UploadedAsset` 记录上传文件生命周期：

| 状态 | 含义 |
|---|---|
| STAGED | 文件已写入 NAS，但还没有被业务记录确认使用 |
| ATTACHED | 文件已经绑定到业务记录 |
| DELETED | 过期暂存文件已被维护任务清理 |

默认清理规则：

- 暂存文件超过 `UPLOADED_ASSET_STAGED_TTL_HOURS`，默认 24 小时，会被清理。
- 未完成签名的 `SIGNING_PENDING` 收据会话超过 `SIGNING_PENDING_TTL_HOURS`，默认 72 小时，会被取消并删除占位收据。

维护任务由 Docker `maintenance` 服务定时调用：

```bash
POST /api/internal/maintenance/uploaded-assets
```

鉴权使用 `MAINTENANCE_JOB_TOKEN`。

## Docker 运行卷

项目使用两个 Docker named volumes 给 Caddy 保存运行状态：

| Docker volume | 用途 |
|---|---|
| `caddy_data` | Caddy 证书、TLS、站点运行数据 |
| `caddy_config` | Caddy 运行配置缓存 |

不要随意执行：

```bash
docker compose down -v
docker volume rm ...
```

这些命令可能删除 Caddy 运行卷；如果未来数据库改成 Docker volume，也可能删除数据库数据。

## 生产运行密钥

生产环境必须显式配置这些值，不能使用公开占位符：

| 环境变量 | 用途 |
|---|---|
| `SESSION_SECRET` | 签发登录会话 Cookie |
| `MAINTENANCE_JOB_TOKEN` | Docker `maintenance` 服务调用内部清理接口 |
| `MU_CONTRACT_SYNC_BASE_URL` | MU Contract 只读 Orders feed 地址，仅传入 app |
| `MU_CONTRACT_SYNC_TOKEN` | MU Contract Orders feed 独立令牌，仅传入 app |
| `RESEND_API_KEY` | Resend 服务端发送密钥，仅传入 app，不进入数据库或浏览器 |
| `RESEND_WEBHOOK_SECRET` | 验证 Resend 回执签名，仅传入 app |
| `TRUST_PROXY_HEADERS` | 是否信任 Caddy 重写后的代理 IP 头，Docker/Caddy 部署建议为 `true` |

如果缺少 `SESSION_SECRET` 或 `MAINTENANCE_JOB_TOKEN`，`docker compose` 会拒绝启动，避免系统用公开默认值悄悄运行。

## 客户邮件通知与 Resend

收据确认、Invoice 首次填写 Shipment Date、首次填写 Release Date 时，后端会在同一业务事务中生成或更新邮件任务。任务写入不等于发送：只有 ADMIN 可以在独立的 Email Management 页面预览并批准，SALES 只能维护其可见客户的邮箱和语言偏好。

持久化数据全部位于 `trading_ledger`：

| 表或字段 | 用途 |
| --- | --- |
| `Customer.notificationLanguage` | 客户邮件语言，默认 English，可选 Francais |
| `CustomerNotificationEmail` | 客户一个或多个通知邮箱及主邮箱 |
| `EmailTemplate` | 收款、出运、放单的英法模板版本 |
| `EmailNotification` | 业务事件、当前审核状态和不可变发送快照 |
| `EmailDelivery` | 每个实际收件操作及 Resend message ID |
| `EmailDeliveryAttempt` | 发送、重试、拒绝或不确定结果 |
| `EmailWebhookEvent` | 已验签并去重的服务商状态回执 |

Docker `email-delivery-trigger` 只持有内部维护令牌，按固定间隔调用应用内部发送器；Resend 密钥只存在于 app 环境。对外 webhook 为 `POST /api/webhooks/resend`。外发默认关闭，测试模式默认开启；测试模式会把已批准邮件重定向到一个内部测试地址。

配置、域名验证、配额、密钥轮换、状态追踪和回滚顺序见 [客户邮件通知运维手册](email-notification-operations.md)。数据库和媒体恢复证据见 [2026-09-02 邮件通知迁移与恢复演练](backup/restore-drills/2026-09-02-email-notifications-migration-drill.md)。该功能不新增 NAS 文件目录。

## 项目内置模板资源

这些文件跟随 Git 和 Docker 镜像发布，不是用户上传数据：

| 文件 | 用途 |
|---|---|
| `public/detail-export/payment-detail-logo.png` | Payment Detail Export Pic 的 MU Group logo |
| `public/detail-export/arial.ttf` | 导出图片 Arial 字体 |
| `public/detail-export/arial-bold.ttf` | 导出图片 Arial Bold 字体 |
| `public/logo.svg` | 项目静态 logo |
| `public/robots.txt` | 搜索引擎爬虫规则 |

业务图片应进入 NAS 上传目录，不要放入 `public/`。

## 临时下载与测试数据

请求时临时生成并直接下载给浏览器的文件不会长期落盘，例如 Dashboard 报表、批量导入模板、审计 CSV、Payment Detail Export Pic 下载图。

自动化测试不使用正式业务库：

- API isolated 测试使用 `trading_ledger_test`
- E2E isolated 测试使用 `trading_ledger_test`
- 测试上传目录使用 `/tmp` 下的临时目录
