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

## 业务数据范围

系统数据分为两类：

| 类型 | 位置 | 备份要求 |
|---|---|---|
| 业务结构化数据 | MySQL `trading_ledger` | 必须备份完整业务库 |
| 上传或生成文件 | NAS 挂载目录 `${UPLOAD_HOST_DIR}` | 必须备份完整上传目录 |

腾讯云 COS 自动备份脚本和权限配置见 `docs/backup/muledger-cos-backup.md`。

## MySQL 业务数据库

项目通过 `DATABASE_URL` 连接 MySQL。核心业务数据包括：

- 用户、角色、权限树
- 客户资料、客户多个 `ORDER_NAME`、多个 `CONSIGNEE`
- 发票、订单、订单余额
- 收据、付款明细、SWIFT 水单
- 删除审批、修改审批
- 系统配置、配置审计、操作审计
- Excel ML token 哈希
- 上传资产台账 `UploadedAsset`
- 签名收据会话与收据编号计数器
- Payment Agent 资料与文件索引

注意：MySQL 数据文件不在项目 Git 仓库，也不在 app 容器里。备份数据库时应备份 `trading_ledger` 业务库，而不是只备份项目代码。

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
| `TRUST_PROXY_HEADERS` | 是否信任 Caddy 重写后的代理 IP 头，Docker/Caddy 部署建议为 `true` |

如果缺少 `SESSION_SECRET` 或 `MAINTENANCE_JOB_TOKEN`，`docker compose` 会拒绝启动，避免系统用公开默认值悄悄运行。

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
