# 收汇管理系统 (Foreign Exchange Receipt Management System)

一个专业的外汇收款管理系统，用于追踪和管理国际汇款收据、账单和SWIFT水单。

## 技术栈

- **前端**: Next.js 16 + React + TypeScript + Tailwind CSS + shadcn/ui
- **后端**: Next.js API Routes + Prisma ORM
- **数据库**: MariaDB(MySQL) + Prisma Migrate
- **状态管理**: Zustand
- **AI能力**: VLM图像识别（收据OCR）

---

## 系统概述

本系统用于管理外贸企业的外汇收款流程，从收据上传、AI识别、匹配订单、到银行转账确认的全流程管理。

---

## 六大模块详解

### 1. 账单管理 (Invoice Management)

**功能描述：**
管理发票和订单信息，是系统的核心数据入口。

**主要功能：**
- 创建账单（INV NO），添加订单（ORDER）
- 编辑、删除订单
- 查看订单余额（ORDER BALANCE）
- 合并重复订单（相同订单号自动合并金额）
- 转移多付余额到其他订单
- 刷新匹配（重新匹配所有订单和收据）

**数据结构：**
```
Invoice (账单)
├── invNo: 账单号 (如 L25MH090125)
├── invAmount: 总金额（所有订单金额之和）
├── invBalance: 未收金额（总金额 - 已收金额）
└── orders[]: 订单列表

Order (订单)
├── orderNo: 客户单号 (如 AB-01)
├── amount: 金额 (AMOUNT)
└── orderBalance: 未收金额 (amount - 已收金额)
```

**特殊账单：**
- **Un_Associated**: 系统自动创建的"未关联"账单，用于存放从收据/付款明细自动创建但尚未匹配到正式账单的订单
- Un_Associated 下的订单：金额显示为 "-"，未收金额显示为负数（表示多付/预收）

**关联逻辑：**
- 创建账单时，检查系统中是否已存在相同订单号，存在则合并金额
- 创建账单时，自动从 Un_Associated 中匹配并迁移相关订单的收据
- 支持定金记录自动合并到正式账单

---

### 2. 收据管理 (Receipt Management)

**功能描述：**
管理收到的汇款收据，支持AI图像识别自动提取信息。

**主要功能：**
- 上传收据图片
- AI自动识别收据信息（VLM OCR）
- 手动编辑识别结果
- 标记已签收（Bank_Transfer → RECEIVED）
- 申请删除（需管理员审批）
- 查看收据原图

**数据结构：**
```
Receipt (收据)
├── receiptNo: 收据号
├── date: 日期
├── usd: 付款金额 (USD)
├── invNo: 账单号 (AI识别)
├── orderNo: 客户单号 (AI识别)
├── payer: 付款人
├── status: 状态
├── isDeposit: 是否为定金
├── orderId: 关联的订单ID
└── imageUrl: 图片路径
```

**状态流转：**
```
SR_Received (已收到收据)
    ↓ (匹配到付款明细)
Waiting_SWIFT (等待SWIFT)
    ↓ (上传SWIFT水单)
Bank_Transfer (银行转账中)
    ↓ (管理员签收)
RECEIVED (已签收归档)
```

**关联逻辑：**
- 创建收据时，自动匹配到现有订单（ORDER名称包含或等于收据的orderNo）
- 如果没有匹配的订单，自动在 Un_Associated 账单下创建新订单
- 收据的金额会累加到对应订单的已收金额，影响 ORDER BALANCE

---

### 3. 付款明细管理 (Detail Management)

**功能描述：**
管理银行付款明细清单，用于批量匹配收据。

**主要功能：**
- 上传付款明细图片
- AI识别明细项目（订单号、金额）
- 自动匹配到收据（金额相等且订单号匹配）
- 编辑明细项目
- 标记异常状态

**数据结构：**
```
Detail (付款明细)
├── date: 日期
├── status: 状态
├── totalAmount: 总金额
├── imageUrl: 图片路径
└── items[]: 明细项目

DetailItem (明细项目)
├── mark: 唛头
├── orderNo: 单号
├── amount: 金额
└── receiptId: 关联的收据ID
```

**匹配逻辑：**
1. 遍历每个 DetailItem
2. 查找状态为 SR_Received 的收据
3. 匹配条件：订单号匹配（包含关系）且金额相等
4. 匹配成功后，收据状态变更为 Waiting_SWIFT

**状态流转：**
```
Waiting_SWIFT (等待SWIFT)
    ↓ (上传SWIFT水单)
Bank_Transfer (银行转账中)
    ↓ (签收)
RECEIVED (已完成)
```

---

### 4. SWIFT水单管理 (SWIFT Management)

**功能描述：**
管理银行SWIFT汇款水单，确认最终转账信息。

**主要功能：**
- 上传SWIFT水单图片
- AI识别SWIFT信息（汇款人、收款人、金额等）
- 关联到付款明细
- 金额差异验证（容差±5，警告±50）
- 标记异常状态

**数据结构：**
```
Swift (SWIFT水单)
├── detailId: 关联的付款明细ID
├── amount: 汇款金额
├── date: 汇款日期
├── senderName: 汇款人姓名
├── senderAddress: 汇款人地址
├── receiverName: 收款人姓名
├── receiverAccount: 收款人账号
├── imageUrl: 图片路径
├── hasError: 是否有错误
└── errorMessage: 错误信息
```

**金额验证：**
- 差异 ≤ 5: 正常通过
- 差异 > 5 且 ≤ 50: 标红警告，允许通过
- 差异 > 50: 不允许通过

**关联逻辑：**
- 一张SWIFT对应一张付款明细（一对一）
- 上传SWIFT后，关联的付款明细及其收据状态变更为 Bank_Transfer

---

### 5. 删除审批管理 (Deletion Approval)

**功能描述：**
管理数据删除申请，确保数据安全。

**主要功能：**
- 用户申请删除收据/付款明细/SWIFT
- 管理员审批/拒绝删除申请
- 查看删除历史

**数据结构：**
```
DeletionRequest (删除申请)
├── targetType: 目标类型 (RECEIPT/DETAIL/SWIFT)
├── targetId: 目标ID
├── reason: 删除原因
├── status: 状态 (PENDING/APPROVED/REJECTED)
├── requestedBy: 申请人ID
└── approvedBy: 审批人ID
```

**流程：**
1. 普通用户申请删除
2. 管理员审批（同意/拒绝）
3. 同意后执行删除操作

---

### 6. 用户管理 (User Management)

**功能描述：**
管理系统用户，区分权限角色。

**主要功能：**
- 创建用户
- 编辑用户信息
- 设置用户角色（ADMIN/SALES/USER）

**数据结构：**
```
User (用户)
├── email: 邮箱
├── password: 密码
├── name: 姓名
└── role: 角色 (ADMIN/SALES/USER)
```

**权限说明：**
- **ADMIN (管理员)**: 
  - 创建/编辑/删除账单和订单
  - 签收归档
  - 审批删除申请
  - 管理用户

- **USER (普通用户)**: 
  - 查看所有数据
  - 上传收据和付款明细
  - 申请删除

- **SALES (销售代表)**:
  - 可创建账单和普通用户账户
  - 可执行签收操作（同管理员）
  - 不可审批删除申请、不可修改系统配置

---

## 模块关联关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           账单管理 (Invoice)                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Invoice (账单)                                               │    │
│  │    ├── Order 1 (订单) → orderBalance = amount - 已收金额      │    │
│  │    ├── Order 2 (订单)                                         │    │
│  │    └── Order N (订单)                                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ 收据关联到订单
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│                           收据管理 (Receipt)                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Receipt (收据)                                               │    │
│  │    ├── orderNo → 匹配 Order.orderNo                          │    │
│  │    ├── usd (金额) → 影响 Order.orderBalance                  │    │
│  │    └── status: SR_Received → Waiting_SWIFT → Bank_Transfer   │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ 付款明细匹配收据
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       付款明细管理 (Detail)                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Detail (付款明细)                                            │    │
│  │    └── DetailItem (明细项目)                                   │    │
│  │          ├── orderNo + amount → 匹配 Receipt                 │    │
│  │          └── 匹配成功 → Receipt.status = Waiting_SWIFT        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ SWIFT关联付款明细
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        SWIFT水单管理 (Swift)                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Swift (SWIFT水单)                                            │    │
│  │    └── detailId → 关联 Detail                                 │    │
│  │    └── 上传后 → Detail.status = Bank_Transfer                 │    │
│  │    └── 上传后 → 相关 Receipt.status = Bank_Transfer           │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 核心业务流程

### 流程1: 正常收款流程

```
1. 管理员创建账单和订单
   ↓
2. 收到客户汇款收据
   - 上传收据图片
   - AI识别收据信息
   - 自动匹配到订单（或创建到Un_Associated）
   ↓
3. 收到银行付款明细
   - 上传付款明细
   - AI识别明细项目
   - 自动匹配收据
   - 收据状态 → Waiting_SWIFT
   ↓
4. 收到SWIFT水单
   - 上传SWIFT水单
   - AI识别SWIFT信息
   - 关联付款明细
   - 状态 → Bank_Transfer
   ↓
5. 管理员签收归档
   - 确认收款无误
   - 状态 → RECEIVED
```

### 流程2: 多付余额转移

```
1. 订单收到超额付款
   - orderBalance 为负数（多付）
   ↓
2. 点击转移按钮
   - 输入目标订单号
   - 输入转移金额
   ↓
3. 系统处理
   - 创建转移记录
   - 目标订单未收金额减少
   - 源订单多付金额减少
```

### 流程3: 订单合并

```
1. 创建账单时输入已存在的订单号
   ↓
2. 系统检测重复
   - 查找现有订单（不区分大小写）
   ↓
3. 自动合并
   - 金额累加到现有订单
   - 显示合并提示
```

---

## 数据库模型关系

```prisma
User ─┬─< Invoice >──< Order >──< Receipt >
      │                   │
      │                   └──< BalanceTransfer >
      │
      ├─< Receipt >──< DetailItem >
      │
      ├─< Detail >──< DetailItem >──< Receipt >
      │     └──< Swift >
      │
      └─< DeletionRequest >
```

---

## API 接口

### 系统测试接口 `/api/system/*`
- `GET /api/system/health` - 服务健康检查（含 DB 连通性，需登录）
- `GET /api/system/routes` - 全量 API 模块与 action 清单（管理员）
- `GET /api/system/config-template` - 配置占位模板与当前是否已设置（管理员）

### 账单接口 `/api/invoice`
- `GET` - 获取账单列表
- `GET?action=import-template` - 下载账单批量导入模板（Excel）
- `POST` - 创建账单
- `POST(multipart action=import-excel)` - 批量导入账单（Excel）
- `PUT` - 更新订单/添加订单/删除订单/转移余额/刷新匹配
- `DELETE` - 删除账单

### 客户接口 `/api/customer`
- `GET` - 获取客户列表
- `GET?action=import-template` - 下载客户批量导入模板（Excel）
- `POST(action=create|update|delete)` - 客户管理
- `POST(multipart action=import-excel)` - 批量导入客户（Excel）

### 收据接口 `/api/receipt`
- `GET` - 获取收据列表
- `POST` - 上传收据/确认识别/标记签收
- `POST(action=direct-create)` - 直接创建收据（跳过AI）

### 付款明细接口 `/api/detail`
- `GET` - 获取明细列表
- `POST` - 上传明细/确认识别
- `POST(action=direct-create)` - 直接创建付款明细（跳过AI）

### SWIFT接口 `/api/swift`
- `GET` - 获取SWIFT列表
- `POST` - 上传SWIFT/确认识别
- `POST(action=direct-create)` - 直接创建SWIFT（跳过AI）

### 用户与认证接口 `/api/auth`
- `POST(action=login|logout|me)` - 登录/登出/获取当前用户
- `POST(action=list|create|delete|reset-password)` - 用户管理（管理员/销售，受角色范围约束）
- `POST(action=update-role)` - 修改用户角色（仅管理员）
- `POST(action=change-password)` - 当前用户修改密码

### 设置接口 `/api/settings`
- `GET` - 获取可编辑系统配置（含权限）
- `POST(action=test-ocr)` - 测试 OCR 配置连通性（管理员）
- `POST(action=update-config)` - 修改系统配置（管理员）
- `POST(action=purge-business-data)` - 清空业务数据并保留用户（管理员）

### 删除审批接口 `/api/deletion`
- `GET` - 获取删除申请列表
- `POST` - 申请删除/审批删除

---

## 快速开始

```bash
# 安装依赖
bun install

# 配置环境变量（参考 .env.example）
# 初始化数据库结构（开发）
bun run db:migrate

# 生成 Prisma Client
bun run db:generate

# 启动开发服务器
bun run dev
```

访问 http://localhost:3000 查看应用。

### Docker 部署（NAS MariaDB + App + Caddy）

```bash
# 1) 准备环境变量
cp .env.example .env

# 2) 修改 .env 中的密钥（至少修改 SESSION_SECRET / DATABASE_URL）

# 3) 一键构建并启动
docker compose up -d --build

# 4) 查看状态
docker compose ps
docker compose logs -f app
```

服务默认通过 Caddy 暴露在 `80/443` 端口。

### 必要环境变量

```bash
# 生产环境必须设置（至少32位）
SESSION_SECRET=replace-with-a-long-random-secret

# 本地初始化管理员（默认关闭）
ENABLE_INIT_ROUTE=false
INIT_ADMIN_TOKEN=replace-init-token
INIT_ADMIN_EMAIL=admin@example.com
INIT_ADMIN_PASSWORD=12345678

# OCR 稳定性与费用日志
OCR_DISABLED=false
OCR_API_BASE_URL=https://api.openai.com/v1
OCR_API_KEY=replace-with-your-ocr-api-key
OCR_MODEL=gpt-4o-mini
OCR_MAX_RETRIES=3
OCR_TIMEOUT_MS=60000
OCR_RETRY_BASE_DELAY_MS=1200
OCR_INPUT_COST_PER_1K=0
OCR_OUTPUT_COST_PER_1K=0
```

> 说明：`/api/init` 默认禁用；启用后如未配置 `INIT_ADMIN_PASSWORD`，默认管理员密码为 `12345678`。

### 上传与敏感数据规范

- 上传目录保持公开访问（`/upload/images`），不改为私有目录。
- 服务端统一校验上传文件：仅允许 `JPG/PNG/WEBP/HEIC`，最大 `10MB`，并对文件名做安全清洗。
- 严禁将敏感数据提交到仓库：`.env`、上传原图、运行时日志、本地数据库文件均已在 `.gitignore` 排除。
- 请基于 `.env.example` 创建本地 `.env`，不要提交真实密钥。

### 数据存储位置说明（当前默认）

- 业务数据（用户、账单、收据、明细、SWIFT 等）存储在 `DATABASE_URL` 指向的 MariaDB/MySQL。  
  如果 `DATABASE_URL` 指向 NAS（例如 `192.168.1.3:3306`），则这些数据落在 NAS。
- 上传图片默认存储在 Docker volume `upload_data`（映射容器内 `/app/upload`）。  
  在当前 `docker-compose.yml` 下，该 volume 为本机 Docker 托管，不在 NAS 数据库里。

### OCR 性能优化（2026-02）

- 收据/明细/SWIFT 的“确认创建”统一使用识别接口返回的服务器图片路径，不再提交 base64 预览图，减少保存请求体积。
- OCR 入参在服务端增加图片边长上限压缩（最长边 1600），降低视觉模型推理延迟。
- 前端 `MARK` 客户查询增加防抖与同值去重（含短时缓存），减少重复接口请求。

### 关键修复（2026-03-02）

- 修复 `ORDER BALANCE` 计算口径：已签收(`RECEIVED`)收据也计入已收金额，避免签收后余额回弹。
- 修复删除审批中的数据一致性：删除收据后会重算关联 `Detail.totalAmount`，并回算关联订单余额。
- SWIFT 创建新增重复保护：同一 `detailId` 重复创建返回明确业务错误，不再返回通用 500。
- 系统探针接口最小暴露：`/api/system/health` 需登录，`/api/system/routes` 与 `/api/system/config-template` 仅管理员可访问。
- 修正系统路由目录(`/api/system/routes`)中的 action-method 描述，和真实实现保持一致（`receipt/detail update` 为 `POST`，补充 `direct-create` 等 action）。

### 数据库迁移说明（MariaDB / MySQL）

- 当前 Prisma 数据源为 MySQL（兼容 MariaDB，`prisma/schema.prisma`）。
- 迁移文件见 `prisma/migrations/*_mysql*`。
- 开发环境使用：`bun run db:migrate`。
- 生产环境发布使用：`bun run db:deploy`。

### 测试

```bash
# 运行单元测试（Jest + RTL）
npm test

# 监听模式
npm run test:watch

# 运行 E2E 测试（Playwright）
npm run test:e2e

# API 冒烟测试（登录 + 核心业务接口 + 导出）
./scripts/smoke-api.sh
```

### 报表导出

- 接口：`GET /api/report?format=excel|pdf`
- 页面入口：仪表盘右上角“导出 Excel / 导出 PDF”按钮
- 导出内容：Summary（统计）、Invoices、Receipts（Excel）；Summary + Recent Receipts（PDF）

### 多语言（next-intl）

- 已接入 `next-intl`，支持 `中文 / English` 双语切换。
- 页面入口：侧栏语言切换按钮（会写入 `NEXT_LOCALE` cookie）。
- 已国际化模块：登录页、侧栏、仪表盘、账单/收据/明细/SWIFT/删除审批/用户/客户/设置等主页面核心文案。
- 前端新增 i18n 工作区：
  - `src/i18n/workspace/translator.ts`：统一 `tx(zh, en)` 文案选择器接口。
  - `src/i18n/workspace/api-error-map.ts`：统一 API 错误文案中英映射，避免后端仍返回中文时英文界面出现中英文混杂。
- 新增巡检脚本：`npm run i18n:audit`
  - 用于扫描 `src` 下硬编码中文，便于持续治理新增文案。

### 权限与操作规则

- 普通账户可查看“账单管理”页面，但不能创建/修改账单（后端会返回 `403`）。
- 收据/付款明细/SWIFT 管理均支持两种创建方式：
  - 上传图片 + AI识别
  - 直接创建（手工录入，跳过AI）
- 配置修改统一通过“设置”页面进行，不再依赖手动改代码。

### 高级搜索与过滤

- 收据管理：支持 `搜索词 + 状态 + 日期区间 + 金额区间`。
- 付款明细：支持 `搜索词 + 状态 + 日期区间 + 总金额区间`。
- SWIFT 管理：支持 `搜索词 + 异常状态 + 日期区间 + 金额区间`。
- API 查询参数：
  - `/api/receipt`: `search,status,dateFrom,dateTo,minUsd,maxUsd`
  - `/api/detail`: `search,status,dateFrom,dateTo,minAmount,maxAmount`
  - `/api/swift`: `search,hasError,dateFrom,dateTo,minAmount,maxAmount`

---

## 开发说明

### 目录结构
```
src/
├── app/
│   ├── page.tsx          # 主页面（所有模块）
│   └── api/              # API路由
│       ├── invoice/      # 账单接口
│       ├── customer/     # 客户接口
│       ├── receipt/      # 收据接口
│       ├── detail/       # 付款明细接口
│       ├── swift/        # SWIFT接口
│       ├── deletion/     # 删除审批接口
│       └── auth/         # 认证接口
├── components/ui/        # shadcn/ui 组件
├── lib/
│   ├── db.ts            # Prisma 客户端
│   ├── store.ts         # Zustand 状态管理
│   └── matching.ts      # 匹配逻辑
├── i18n/workspace/      # 多语言工作区（页面文案选择 + API 错误映射）
└── prisma/
    └── schema.prisma    # 数据库模型
```

### 关键算法

1. **订单匹配算法**: 订单号不区分大小写，支持双向包含匹配
2. **收据匹配算法**: 订单号匹配 + 金额相等
3. **余额计算**: `OrderBalance = Amount - Sum(Receipt.USD)`

---

## 更新日志

### v1.0.5 (2026-02-28)
- 🗄️ 数据库切换为 NAS MariaDB（应用从 Mac 直连 NAS DB）
- 🧹 新增管理员清库能力：保留用户、清空业务数据（`POST /api/settings action=purge-business-data`）
- 📥 账单管理新增 Excel 模板下载 + 批量导入（严格行级校验，不跳过业务逻辑）
- 📥 客户管理新增 Excel 模板下载 + 批量导入（严格行级校验 + 权限规则继承）

### v1.0.6 (2026-03-02)
- 🧮 修复 `ORDER BALANCE` 计算口径：`RECEIVED` 收据也计入已收金额
- 🔁 修复删除审批一致性：删除收据后重算 `Detail.totalAmount` 并回算订单余额
- 🚫 SWIFT 重复创建保护：同一 `detailId` 重复创建返回业务错误（400）
- 🔐 收紧系统探针权限：`/api/system/health` 需登录，`/api/system/routes` 与 `/api/system/config-template` 仅管理员可访问
- 🧪 新增自动化测试：`matching` 余额口径测试、`api-catalog` 方法一致性测试

### v1.0.7 (2026-03-02)
- 🌐 扩展主页面多语言覆盖：账单/收据/明细/SWIFT/删除审批/用户/客户/设置模块补齐中英文案切换。
- 🧱 新增 i18n 工作区封装：统一页面 `tx(zh, en)` 接口与 API 错误翻译映射。
- 🔎 新增 i18n 巡检脚本：`npm run i18n:audit`，用于持续发现硬编码中文并跟踪治理。

### v1.0.8 (2026-03-02)
- 🔐 修复销售账户收据创建冲突规则：`receiptNo` 去重仅限制同一创建者，避免跨账户误拦截。
- 🖼️ 修复付款明细确认后收据图片缺失：明细关联已有收据时自动回填图片路径（仅在原收据无图时）。
- 💱 调整 SWIFT 金额超限处理：仅标记 SWIFT 为 `ERROR`，不再把关联 `DETAIL/RECEIPT` 强制改为 `ERROR`。
- 🔁 支持覆盖错误 SWIFT：同一明细存在错误 SWIFT 时允许删除旧错误记录后重建。
- 🗑️ 放宽错误 SWIFT 删除权限：错误记录允许创建者直接删除（正常记录仍走管理员或审批流程）。
- 👁️ SWIFT 管理新增“查看图片”入口，支持直接预览上传的 SWIFT 图片。
- 🧾 统一前端删除异常提示：订单删除失败优先展示后端业务错误，不再统一误报“网络错误”。

### v1.0.4 (2026-02-27)
- 🔐 权限模型升级：普通用户仅可访问/修改自己创建的 Receipt、Detail、SWIFT 与删除申请目标资源
- 🧾 Receipt/Detail/SWIFT 接口增加统一输入校验（非法 JSON、空明细、非法金额会返回 400）
- 🧮 付款明细确认链路改为事务执行，避免“明细创建成功但状态更新失败”的数据不一致
- 🛡️ 上传安全增强：增加图片 magic number 校验，防止伪造 MIME 类型上传
- 🍪 会话 Cookie 安全增强：`SameSite=Strict`
- 🔒 登录防枚举增强：用户不存在时执行固定 bcrypt 校验，降低时序差异
- 🚫 收据金额校验收紧：拒绝 `<= 0` 金额
- 🔎 搜索风控增强：Receipt/Detail/SWIFT 搜索词长度限制（默认 100）
- 🧱 订单并发防重：新增 `Order(invoiceId, orderNo)` 唯一约束 + `P2002` 冲突兜底
- 📚 新增审计日志能力：关键业务动作记录到 `AuditLog`（失败自动降级到日志输出）

### v1.0.3 (2026-02-26)
- 🛡️ 新增 `withAuth` + `withRole` 鉴权封装并接入核心 API 路由
- 🔎 匹配算法升级：`Order.tokens + Levenshtein + token 相似度` 评分选优，替换纯 `includes`
- 🤖 OCR 调用增强：统一超时、指数退避重试、usage 费用日志、失败自动 fallback
- 📊 新增报表导出（Excel/PDF）接口与前端下载入口
- 🌐 启用 next-intl 中英双语（登录/侧栏/仪表盘）
- 🔍 新增高级搜索与过滤（收据/明细/SWIFT）

### v1.0.2 (2026-02-26)
- 🔐 会话鉴权改造：从 `x-user-id` 头改为服务端签名 Cookie（HttpOnly）
- 🔐 前端移除 `localStorage userId` 透传逻辑
- 🔐 `/api/init` 改为默认禁用，启用时需初始化令牌 + 环境变量
- 📁 上传安全增强：统一上传封装，增加文件类型/大小/文件名安全校验
- 🧱 仓库安全增强：新增 `.env.example`，完善敏感数据忽略规则

### v1.0.1 (2026-02-24)
- 🔐 **安全加固**：密码存储从不安全的 SHA-256 升级为 bcrypt（12 rounds）
- 支持旧密码自动迁移（登录时自动升级到 bcrypt）

### v1.0.0
- 完成六大核心模块
- AI图像识别集成
- 自动订单匹配与合并
- 多付余额转移功能

---

## 🚀 管理员必读 · 后续开发计划

项目核心功能（v1.0.0）已全部完成，可直接用于生产环境。

**接下来要做什么、优先级、具体任务**，请查看项目根目录的 **[todolist.md](./todolist.md)**。

所有安全修复、功能增强、测试计划都在那里统一维护。  
建议每周查看并更新 todolist.md，保持开发节奏透明。
