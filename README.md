# 收汇管理系统 (Foreign Exchange Receipt Management System)

一个专业的外汇收款管理系统，用于追踪和管理国际汇款收据、账单和SWIFT水单。

## 技术栈

- **前端**: Next.js 16 + React + TypeScript + Tailwind CSS + shadcn/ui
- **后端**: Next.js API Routes + Prisma ORM
- **数据库**: MariaDB(MySQL) + Prisma Migrate
- **状态管理**: Zustand
- **AI能力**: VLM图像识别（收据OCR）

## 当前工程约束

- 构建现在会执行真实 TypeScript 校验，不再忽略类型错误
- `/api/report` 已按当前用户层级做数据可见范围导出
- `/api/upload-image` 已要求登录并校验当前用户是否有权访问对应业务图片
- `examples/websocket` 仅作历史示例，已排除出主工程类型检查
- Prisma 增加了 `20260309153500_schema_sync_for_fresh_deploy`，用于保证全新数据库部署与当前 schema 一致
- `20260309153500_schema_sync_for_fresh_deploy` 现已兼容已有历史库，重复字段/索引/外键会自动跳过，避免容器启动时迁移失败
- 前端 workspace 已完成第一阶段模块化：`src/app/page.tsx` 只保留鉴权初始化与视图路由，API client / import-result hooks / 各业务模块视图已拆到 `src/components/workspace/{api,hooks,chrome,modules}`
- 前端 workspace 已完成第二阶段路由拆分：`/dashboard`、`/invoices`、`/receipts`、`/details`、`/swifts`、`/deletions`、`/customers`、`/settings` 为独立 app route；根 `/` 仅负责登录入口或登录后跳转
- workspace 路由现已使用共享 `(workspace)` layout 承载侧栏与鉴权，模块切换时只替换右侧主内容区，避免整屏白屏后重新挂载
- 侧边栏已支持收缩为仅图标模式，并持久化到本地存储；刷新后会保留收缩状态
- 发票/客户导入结果弹窗已抽成通用组件与通用表格 hook，后续模块内拆分将继续沿用这条复用路径
- 自动化测试已升级为三层：Jest hook/module 单测、隔离 API case 集、隔离 Playwright 关键链路闭环；CI 已统一串联 `tsc + lint + unit coverage + api isolated + e2e isolated`
- `scripts/test-api-isolated.sh` 现仅负责隔离环境启动，具体 case 已拆到 `tests/api/isolated/cases/*.case.mjs`，便于后续按模块继续扩展
- 第一批 workspace hook 测试已覆盖 `invoice / customer / settings`，后续第二、第三批已继续扩到 `receipt / detail / swift / users`
- 当前 Jest 已扩展到 `27 suites / 172 tests`；coverage global threshold 已小步提升到 `branches 55 / functions 79 / lines 73 / statements 71`
- 第二批隔离 API case 已覆盖层级权限边界与删除审批链路，当前 case 已包括：鉴权/层级权限、客户导入与可见域、账单主链路、设置与报表、删除审批副作用回退
- 隔离 API case 已扩到 `8` 组，新增 `Receipt -> Detail -> Swift -> mark-received` 生命周期闭环，以及 SWIFT 金额容差 `±5 / ±6 / ±50 / ±51` 边界与错误 SWIFT 直接删除回归
- 为保证 GitHub Actions 的 `npm ci` 与本地依赖树一致，已通过 `npm overrides` 将 transitive `@swc/helpers` 固定到 `0.5.19`，避免 lockfile 在 Node20/npm10 环境下失配
- GitHub Actions workflow 已升级到 `actions/checkout@v5` 与 `actions/setup-node@v5`，Node 24 兼容告警已消除
- 删除审批链路已开始统一错误码与事务边界：`/api/deletion` 现通过 `deletion-service + ApiError(code/message/detail) + runInTransaction` 承接写操作，前端删除审批也已抽到独立 `use-deletion-actions`
- `settings / receipt / detail / swift` 现已继续迁到同一套 `service + ApiError(code/message/detail) + runInTransaction` 模式，路由层只保留请求解析、识别与响应封装
- `/api/invoice` 写接口现也已迁到 `invoice-service + ApiError(code/message/detail) + runInTransaction` 模式；路由层仅保留读取、模板下载与 Excel 解析
- `invoice-write` 现已补事务化持久化：先完成整批订单校验与客户解析，再在单一事务中落库 invoice/order/alias/receipt 迁移，避免中途坏行留下半写入数据
- `SWIFT_WARNING_TOLERANCE / SWIFT_REJECT_TOLERANCE` 已纳入 `/api/settings` 和设置页，金额容差不再硬编码在业务代码里
- `system-settings` 已修复“热缓存只记住首批 key 子集”的缺陷，后续不同 key 的设置读取会增量补齐缓存，不再错误回退到环境默认值
- 系统配置更新现写入审计日志：记录操作人、变更 key、前后值；敏感配置（如 `OCR_API_KEY`）会自动脱敏
- 审计与错误目录已开始统一常量化：新增 `audit-catalog.ts` 与 `apiErrorCodes`，`deletion/settings/receipt/detail/swift/invoice` 这批 service 已先接入统一动作/目标类型常量
- 前端 workspace 的 API 错误消费已开始从字符串文案切到 `code/detail/message` 统一解析：共享 API client 现支持 `WorkspaceApiError`、错误码翻译、detail 拼接与上传接口统一错误读取
- 设置页已新增独立“配置变更审计”工作区：支持单独查询最近配置修改记录，展示操作人、更新时间、更新键与前后值
- 设置页配置审计现已补齐“游标分页 + 导出历史”：主审计列表展示当前游标分页状态，CSV 导出会记录成独立审计历史，并支持在前端继续按筛选条件查看导出记录
- `/api/init` 已补齐根管理员初始化幂等与层级归一，避免并发初始化或历史脏数据导致根账号层级错误
- `/api/invoice` 已修复 grouped order 合并后继续对旧 orderId 重算余额导致的潜在 500

## 本地运行

1. 复制 `.env.example` 为 `.env`
2. 配置 `DATABASE_URL` 与 `SESSION_SECRET`
3. 如需 HTTPS，配置：
   - `CADDY_HOST`: 生产环境填真实域名
   - `CADDY_EMAIL`: 可选，留给 Caddy 申请证书时使用
4. 执行数据库迁移：

```bash
npx prisma migrate deploy
```

5. 启动开发环境：

```bash
npm run dev
```

## Docker / HTTPS

- `docker-compose.yml` 现在默认通过 Caddy 暴露 `80/443`
- `Caddyfile` 会基于 `CADDY_HOST` 自动启用 HTTPS
- 本地默认 `CADDY_HOST=localhost`
- 生产环境要获得浏览器小锁，请把 `CADDY_HOST` 设置为真实可访问域名
- 源站已兼容 Cloudflare 反代场景：普通直连 HTTP 仍会跳 HTTPS，但当上游代理已声明原始请求是 HTTPS（如 `Cf-Visitor` / `X-Forwarded-Proto`）时，Caddy 不会再次重定向，避免 `308 -> https://同地址` 自循环
- HTTP 入口已改为全 Host 兜底反代，避免线上遗漏 `CADDY_HOST` 时出现 `200 OK` 但空白页面（空 body）
- 如果线上仍然循环，请优先核查 Cloudflare SSL/TLS 模式，建议使用 `Full` 或 `Full (strict)`，不要使用 `Flexible`

## 自动化测试

- 单元测试：

```bash
npm test -- --runInBand
```

- 隔离 API 测试：

```bash
npm run test:api:isolated
```

- 隔离 E2E 测试（Playwright）：

```bash
npm run test:e2e:isolated
```

- CI 全量校验：

```bash
npm run test:ci
```

说明：
- 该脚本会启动一套独立的 MariaDB 测试容器
- 使用独立测试库 `trading_ledger_test`
- 运行结束后自动删除测试容器、测试卷、临时上传目录和 Cookie/日志文件
- 不会碰现有业务数据库
- 隔离 API 用例已按模块拆分到 `tests/api/isolated/cases/*.case.mjs`
- Playwright 闭环会复用 `/api/init` 初始化管理员，不依赖手工准备账号

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
- `POST(action=import-rows)` - 导入“问题行重试”数据（仅重试当前补录行）
- `PUT` - 更新订单/添加订单/删除订单/转移余额/刷新匹配
- `DELETE` - 删除账单

### 客户接口 `/api/customer`
- `GET` - 获取客户列表
- `GET?action=import-template` - 下载客户批量导入模板（Excel）
- `POST(action=create|update|delete)` - 客户管理
- `POST(multipart action=import-excel)` - 批量导入客户（Excel）
- `POST(action=import-rows)` - 导入“问题行重试”数据（仅重试当前补录行）

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
- `POST(action=purge-branch-data)` - 按账号分支清库（管理员密码确认 + 模块选择 + 依赖级联删除）

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

### 关键修复（2026-03-05）

- 账单批量导入新增“问题行编辑重试”闭环：首轮导入先写入可成功行，失败行通过弹窗编辑后调用 `POST /api/invoice (action=import-rows)` 继续导入。
- 客户批量导入新增“问题行编辑重试”闭环：冲突/校验失败行在弹窗内修正后调用 `POST /api/customer (action=import-rows)` 重试，且仅导入当前问题行。
- 设置页“分支业务清库”升级为管理员通用能力：可选任意目标账号与清理模块（账单/收据/明细/SWIFT/客户/全部），后端按依赖关系执行级联清理并保留系统配置与用户配置。

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

# 运行 E2E 测试（Playwright，本地开发）
npm run test:e2e

# 运行隔离 API 测试集（独立 MySQL + 模块化 case）
npm run test:api:isolated

# 运行隔离 E2E 闭环（独立 MySQL + Playwright）
npm run test:e2e:isolated

# 本地模拟 CI 全量校验
npm run test:ci
```

- 隔离 API 测试结构：
  - `scripts/test-api-isolated.sh`: 只负责起隔离环境、迁移数据库、启动应用
  - `scripts/run-api-isolated-tests.mjs`: 逐个加载并运行 case
  - `tests/api/isolated/helpers/context.mjs`: 登录、请求、断言、临时文件等公共能力
  - `tests/api/isolated/cases/*.case.mjs`: 按业务模块拆开的 API 回归 case
- 第一批 hook/module 测试覆盖：
  - `invoice`: `use-invoice-view-state`, `use-invoice-actions`
  - `customer`: `use-customer-forms`, `use-customer-actions`
  - `settings`: `use-settings-forms`, `use-settings-actions`
- 第二批 hook/module 测试覆盖：
  - `receipt`: `use-receipt-actions`
  - `detail`: `use-detail-actions`
  - `swift`: `use-swift-actions`
  - `users`: `use-user-actions`
- 当前隔离 API case 覆盖：
  - `00-auth-system`: 初始化、登录、会话、系统路由
  - `10-customer-import-and-scope`: 客户导入、重复校验、owner scope
  - `20-invoice-ledger-flow`: 账单/收据/明细/SWIFT 主链路
  - `30-settings-and-report`: 设置更新、OCR 配置检测、报表导出
  - `40-auth-hierarchy-boundaries`: 1/2/3/4 级账户权限边界、同级可见不可管、旁支不可管理
  - `50-deletion-approval-flow`: 收据/明细/SWIFT 删除申请、管理员审批、状态回退与自动对象级联清理
- 覆盖率门禁当前仍只对上述高价值 hook 生效，但阈值已开始第二轮上调；后续再逐步扩大到 `receipt/detail/swift/users`

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

### v1.0.27 (2026-03-06)
- 🚫 客户导入取消自动更新：批量导入命中同池已有客户时不再 upsert，凡是命中 `PHONE` 或 `MARK+NAME` 的行一律按失败返回。
- 🧾 重复提示增强：客户导入与手动新建/编辑命中重复时，会直接返回已有客户详情（`MARK / NAME / PHONE / BINDING / ID`），便于用户定位冲突记录。
- 🔒 新建客户路径补齐校验：`Customer create/update` 与批量导入统一使用同一套重复检测，不再出现“手动新建绕过部分逻辑”的情况。
- 🔎 搜索逻辑统一重构：账单、收据、付款明细、SWIFT、客户改为“权限/时间/金额过滤后，再做全字段文本搜索”，修复关键词命中不全的问题。
- 🪟 弹窗布局修复：账单/客户导入结果弹窗改为真正的浏览器四边留 `5px`；创建账单弹窗改为内容区滚动、底部按钮固定，长订单列表下仍可点击保存。
- 🧪 验证完成：API 已验证“重复即失败 + 重复详情 + 客户全字段搜索”；浏览器已验证“创建账单”在 20+ 行订单下底部按钮仍可见。

### v1.0.26 (2026-03-05)
- 📊 导入结果弹窗重构：账单/客户批量导入统一支持“显示全部行状态（含成功）”，不再只展示失败行。
- 🔁 重试闭环升级：默认“仅看最新失败”，支持切换“查看全部”；右下角改为“关闭 + 仅重试失败行”。
- 🧾 结果历史可追踪：每次重试都会保留历史并新增 `Result#N` 状态列，失败原因只保留“最新原因”。
- ✍️ 可编辑性收敛：仅“最新状态为 FAILED”的行可编辑并重试，成功行全量只读。
- 🧭 分页与窗口适配：两个导入结果弹窗改为近全屏尺寸（`100vw/100vh - 10px`），每页 50 行，支持大表格滚动浏览。
- 🔌 后端返回增强：`/api/invoice` 与 `/api/customer` 导入接口新增 `rowResults`（逐行状态与回填后字段），支撑前端全量结果展示。
- 🧪 API 回归通过：验证客户/账单导入均可同时返回 `SUCCESS/FAILED` 或 `CREATED/FAILED` 等混合行状态，并自动清理测试数据。

### v1.0.25 (2026-03-05)
- 🧠 账单空 `CUSTOMER_MARK` 自动识别规则收敛：按单个 `ORDER_NO` 最右侧 `-` 拆分提取 `ORDER_NAME`，大小写不敏感并自动合并多空格；缺少 `-` 时按问题行返回固定提示“应该含‘-’的ORDER格式”。
- 🧩 组合 ORDER 识别一致性增强：`A-01/B-02/...` 会逐子单提取并匹配 `ORDER_NAME`，仅当全部子单命中且归属于同一客户时才自动回填 MARK，否则进入问题行。
- 🧾 账单导入问题行弹窗可读性修复：弹窗改为超宽布局，表格列与输入框设置最小宽度并支持横向滚动，长内容不再被截断。
- 👀 Customer List 可读性优化：`CONSIGNEE` 与 `COMPANY_ADDRESS` 改为前 20 字展示，支持悬浮提示与点击弹窗查看全文。
- 🔁 客户重复导入统计修复补强：占位值（如 `-`）不再触发“空字段填充更新”，同一文件重复导入不再反复计入 `updatedCount`。
- 🧪 API 自动化回归：覆盖“客户重复导入不应重复更新”、“按最后 `-` 的 ORDER_NAME 自动识别 MARK”、“缺少 `-` 的 ORDER 格式错误提示”三类场景并通过。

### v1.0.22 (2026-03-05)
- 🧾 账单批量导入新增“问题行补录重试”闭环：后端返回 `issueRows`，前端弹窗可逐行编辑并调用 `POST /api/invoice (action=import-rows)` 仅重试当前问题行。
- 👥 客户批量导入新增“问题行补录重试”闭环：冲突/校验失败行在弹窗内修改后调用 `POST /api/customer (action=import-rows)` 重试，且仅导入当前问题行。
- 🧹 分支业务清库能力升级：`POST /api/settings (action=purge-branch-data)` 支持管理员对任意账号分支按模块清理（`invoice/receipt/detail/swift/customer/all`），并按依赖关系级联删除。
- ⚙️ 设置页清库面板升级：目标账号从“仅 ADMIN”扩展到“任意账号”，新增模块多选与管理员密码确认，保留系统配置与用户配置。

### v1.0.21 (2026-03-05)
- 📥 账单批量导入增强：`CUSTOMER_MARK` 允许留空，系统会按 `ORDER_NO` 的客组规则自动回查可见客户库/历史订单推断 MARK。
- 🧩 导入健壮性升级：未匹配行不再阻断整批；可匹配行先导入，返回“成功/失败”汇总与逐行失败原因。
- 🖥️ 导入提示优化：前端在导入成功时也会展示后端返回的失败明细，便于定位未匹配行。

### v1.0.20 (2026-03-05)
- 👁️ 客户管理可视化补齐：客户列表新增“绑定账户（Sales/Admin池）”列，创建/编辑/修复弹窗支持显式选择绑定账户。
- 📥 客户导入模板新增 `SALES_EMAIL` 列：管理员可按行指定绑定销售邮箱；未填写时使用页面默认绑定账户。
- 🔌 新增 `GET /api/customer?action=owner-options`：返回可绑定账户列表，前端用于绑定选择器与导入默认绑定下拉。
- 🧠 导入绑定策略增强：支持“页面默认 ownerId + Excel 行级 SALES_EMAIL”并行，行级配置优先；无效销售邮箱按行失败并继续后续导入。

### v1.0.19 (2026-03-05)
- 👤 客户归属模型升级：`Customer` 新增 `ownerId` 绑定（默认绑定当前创建者），用于隔离 customer 可见/可编辑范围；`ADMIN` 可查看全部，`SALES` 仅可查看并维护自己绑定池。
- 🧱 客户唯一性规则重构：`Customer.name` 取消唯一限制；改为同一绑定池内 `ORDER_NAME/PHONE/COMPANY_NAME` 不允许重复，不同绑定池允许重复。
- 📥 批量导入健壮性增强：客户 Excel 导入改为逐行容错处理，支持按同池唯一键自动“更新已存在客户”而非整批失败；返回新增/更新/失败统计与失败明细。
- 🛠️ 客户写接口稳定化：`create/update/customer-fixes` 统一接入同池冲突校验与 Prisma 错误映射，避免直接暴露底层数据库报错。
- 🧾 客户字段兼容升级：`name/companyName/companyAddress` 升级为 `TEXT`，降低长文本导入触发列长度报错风险。
- 🧪 新增 API 自动化用例：`scripts/test-customer-scope-api.sh` 覆盖 customer 同池去重、跨池可重复、导入 upsert 与 sales 可见性验证。

### v1.0.18 (2026-03-05)
- 👥 客户管理规则调整：`CONSIGNEE` 改为可空，`CREDIT` 支持 `0`（禁止负数）；修复批量导入/新建客户时 `consignee` 长度超限导致的 Prisma 列类型报错。
- 🧾 INV 字段增强：新增 `SHIP_DATE` 与 `RELEASE_DATE`（非必填，支持创建与 Excel 导入可空），账单管理展示由“创建时间”改为显示 SHIP/RELEASE。
- 🧩 组合 ORDER 能力：支持 `IB-31A/IB-32/IB-33B` 形式的组合订单，自动维护子订单别名匹配；收据/明细命中任一子订单时统一结算到组合订单。
- 🔁 历史兼容：新增组合订单回填脚本 `scripts/backfill-group-orders.mjs`，用于将历史同组订单收敛为组合订单并迁移关联关系。
- 📅 直接创建默认日期：收据/付款明细 direct-create 在未传日期时默认使用服务器当日日期。
- 🌐 i18n 继续补齐：修复客户管理 `CONSIGNEE` 占位提示与多处硬编码提示文案，增强 API 错误中译英映射。

### v1.0.17 (2026-03-03)
- 🧯 修复管理员删除用户 500：删除前自动重挂该用户创建的业务数据 `createdBy` 到当前操作者，再执行删除，避免外键约束 (`P2003`) 失败。
- ✅ 用户删除链路稳定化：覆盖 `Invoice/Order/Receipt/Detail/SWIFT/Customer/History/DeletionRequest/AuditLog` 的创建者重挂。

### v1.0.24 (2026-03-05)
- 🔁 客户导入“重复导入”统计修复：仅在字段实际变更时计入 `updatedCount`，无变化行改为 `无变更` 计数。
- ☎️ 客户手机号规则调整：同绑定池允许同手机号多客户并存，避免 `SDT/SDT2` 这类数据被误覆盖或误拦截。
- 🎯 客户导入匹配优化：优先 `MARK+NAME`，其次 `PHONE`（同 `ORDER_NAME` 或占位客户时允许回填），降低同手机号误更新。
- 🧩 账单自动识别增强：`CUSTOMER_MARK` 为空时，新增 `ORDER_NAME` 回退匹配；多命中时增加 `MARK 前缀` 进一步判定。
- 🧪 回归验证更新：`customer/import` 与 `invoice/date` API 场景已完成自动化验证并通过。

### v1.0.23 (2026-03-05)
- 🧾 客户导入匹配规则升级：按 `PHONE` 或 `MARK+NAME` 命中更新；若同一行命中多条客户则进入问题行，不再误更新。
- 🛡️ 客户导入更新策略收敛：仅覆盖目标客户的空值/占位值字段，已有有效字段不再被批量导入覆盖。
- 📌 导入结果回执增强：账单导入返回并展示 `importedOrderNos`；客户导入返回并展示 `createdRows/updatedRows`（`NAME/MARK/PHONE`）。
- 🗓️ 账单列表支持直接编辑并保存 `SHIP_DATE` / `RELEASE_DATE`（支持清空为 `null`）。
- 🚫 账单导入重复防护增强：同批次重复与库内已存在 `ORDER_NO` 均按问题行拦截，禁止隐式合并金额。
- 🧪 自动化回归补强：新增 API 自测覆盖导入匹配冲突、仅空字段覆盖、账单日期更新与重复导入拦截场景。

### v1.0.16 (2026-03-02)
- 🔐 账单“刷新匹配”权限收敛：`rematch-preview` / `rematch-apply` / `rematch` 仅在当前账号可见范围内执行，不再扫描或改动全库数据。
- 🧭 `updateOrder` 触发的自动 rematch 同步改为当前账号可见范围内执行，避免跨账号影响。

### v1.0.15 (2026-03-02)
- 🌐 i18n 修复：Customers 搜索框 placeholder 改为中英双语切换。
- 🗓️ i18n 修复：Receipts / Payment Details / SWIFT 的日期筛选输入补充语言属性与中英标题，英文模式下不再出现中文筛选提示。

### v1.0.14 (2026-03-02)
- 🧭 设置页布局调整：系统配置区块移动到设置页最底部。
- 🧹 新增“分支业务清库”能力（仅 `admin@example.com`）：输入密码后可选择任意 ADMIN 分支清空业务数据。
- 🔐 清库规则：仅删除该分支下业务数据（订单/收据/明细/SWIFT/客户/审批与审计等），保留系统配置和全部用户账号。

### v1.0.13 (2026-03-02)
- 🧭 rematch 冲突预览收敛：`customer-group` 冲突仅在“同客组存在未匹配收据(orderId=null)”时才提示，避免不同订单被误判为需要冲突处理。

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

### v1.0.9 (2026-03-02)
- 🚫 删除申请防重：同一目标（`targetType + targetId`）已有申请时禁止重复发起。
- 🧹 删除付款明细级联清理增强：审批删除 `DETAIL` 时自动删除该明细链路中“自动创建”的收据。
- 🗂️ 自动订单清理增强：上述自动收据删除后，若对应 `Un_Associated` 订单满足“`amount=0` 且无收据”，自动删除该订单。
- 🧮 余额一致性修复：`DETAIL` 删除流程内同步重算受影响订单 `orderBalance`，避免后续删除/展示异常。

### v1.0.10 (2026-03-02)
- 🔁 账单“刷新匹配”增强：新增空订单治理，自动删除 `amount=0 && orderBalance=0 && 无收据` 的订单。
- 📦 收据创建流程修复：普通上传确认时若未匹配到订单，会自动创建 `Un_Associated` 订单并关联收据。
- 👀 经理可见性修复：`SALES` 账户查询收据/明细/SWIFT 改为经理视角（不再仅限本人创建数据）。
- 🖼️ 新增上传图片读取 API：`GET /api/upload-image?path=...`，并统一前端图片预览走该接口，修复明细图片查看失败。
- 🧭 导航调整：左侧移除“用户管理”，改为并入“设置”页面内管理。

### v1.0.12 (2026-03-02)
- 🧩 用户管理创建增强：新增 `parentId` 上级账户选择接口与前端下拉，角色/层级规则与后端一致。
- 🔒 可见性越权修复：`receipt/detail/swift` 查询改为 `AND(可见性,搜索)`，避免搜索条件覆盖 owner/customer 归属过滤。
- 👁️ 账单可见性收口：`invoice` 的 `orderId`、`orderNo`、主列表与子级 `orders/receipts` 统一使用 owner + customer owner 并集可见。
- 🧱 客户写操作补权控：`customer update/delete` 新增归属校验，仅允许可见范围内客户被修改/删除。
- 🛠️ 用户管理修补：修复 `update-role` 缺失 `level` 字段导致的同级管理判定漏洞，并在前端展示 `level/parent`。

### v1.0.40 (2026-03-10)
- 🪝 收据模块远程动作拆分：新增 `use-receipt-actions.ts`，统一承接 OCR 识别、确认创建、直接创建、签收、删除申请等网络动作与提交状态。
- 📉 收据主模块大幅减重：`receipt-manager.tsx` 从 `397` 行压缩到 `257` 行，基本收敛为筛选、分页与组件拼装层。

### v1.0.39 (2026-03-10)
- 🪝 收据模块本地态与候选匹配拆分：新增 `use-receipt-customer-lookup.ts` 与 `use-receipt-forms.ts`，统一承接 OCR/直建的客户候选查询、表单状态、预览与打开关闭逻辑。
- 📉 收据主模块继续瘦身：`receipt-manager.tsx` 从 `529` 行压缩到 `397` 行，后续只剩远程动作可继续抽离。

### v1.0.38 (2026-03-10)
- 🧩 收据模块开始组件化：将收据列表、上传收据对话框、直接创建收据对话框、图片预览对话框抽为独立组件，并新增 `receipts/types.ts`。
- 📉 收据主模块首轮瘦身：`receipt-manager.tsx` 从 `797` 行压缩到 `529` 行，为后续抽本地 hook 和动作 hook 做准备。

### v1.0.48 (2026-03-10)
- 🧩 客户模块继续收口导入工作区：顶部工具区抽为 `customer-toolbar.tsx`，导入问题行列定义抽为 `use-customer-import-columns.tsx`，页面层不再直接维护大段列配置 JSX。
- 📉 客户主模块继续瘦身：`customer-manager.tsx` 从 `347` 行进一步压缩到 `236` 行，当前主要剩查询加载、格式化辅助和页面编排。

### v1.0.49 (2026-03-10)
- 🧩 用户管理模块完成首轮拆分：`user-manager.tsx` 拆出 `components/ + hooks/ + types.ts`，创建用户对话框、用户列表、本地表单态、远程动作不再堆在单文件内。
- 📉 用户主模块显著瘦身：`user-manager.tsx` 收敛到页面编排层，后续只保留数据加载、权限衍生与组件组装。

### v1.0.53 (2026-03-11)
- 🔒 CI 依赖树收口：新增 `package.json#overrides`，将 transitive `@swc/helpers` 固定到 `0.5.19`，修复 GitHub Actions 在 `Node 20 / npm 10` 下 `npm ci` 因 lockfile 失配失败的问题。
- 🧪 第二批 workspace 模块测试落地：新增 `use-receipt-actions`、`use-detail-actions`、`use-swift-actions`、`use-user-actions` 四组 hook 测试，补齐收据/明细/SWIFT/用户管理模块的基础动作回归。
- 🧭 测试矩阵继续扩展：当前本地 Jest 已扩到 `15 suites / 36 tests`，下一轮再决定是否把第二批 hooks 纳入 coverage 门禁。

### v1.0.54 (2026-03-11)
- 🔧 GitHub Actions CI 继续修复：将 `jest.config.ts` 改为 `jest.config.mjs`，去掉 runner 对 `ts-node` 的隐式依赖，修复云端 `jest --coverage` 解析配置失败的问题。
- 🧪 第三批 workspace 模块测试推进：为 `receipt/detail/swift/users` 四组 action hooks 补齐上传识别、确认创建、取消/异常分支、权限动作等真实交互测试，Jest 扩展到 `15 suites / 54 tests`。
- 📈 coverage threshold 第三轮小步上调：将 `receipt/detail/swift/users` 正式纳入 `collectCoverageFrom` 与 module threshold，同时把 global threshold 提升到 `branches 40 / functions 65 / lines 60 / statements 60`，继续保持渐进收紧而不是一次性全仓拉满。

### v1.0.59 (2026-03-11)
- 🧱 `invoice` 写接口继续统一：新增 `invoice-service` 承接导入、建单、删单、加单、改单、转余额、刷新匹配等写动作，`/api/invoice` 路由收敛为读取/模板下载/Excel 解析的薄路由。
- 📝 系统配置修改补齐审计日志：`updateSystemSettings` 现记录操作人、变更 key、前后值；敏感配置（如 `OCR_API_KEY`）自动脱敏为 `[masked]`。
- 🧪 新增 `invoice-service` 单测，覆盖建单失败结构化错误、导入自动推断/冲突、日期更新审计、加单合并、转余额审计等关键分支；Jest 扩展到 `23 suites / 112 tests`。
- 📈 coverage threshold 第七轮小步上调：global 提升到 `45 / 71 / 65 / 65`，并将 `invoice-service` 纳入首轮局部门禁，本地 `build + test:ci` 全绿。

### v1.0.60 (2026-03-11)
- 🔒 `invoice-write` 内部持久化继续事务化：整批订单先校验，再通过 `runInTransaction` 统一写入 invoice/order/orderAlias，并在提交后执行 grouped order consolidate、deposit receipt 补挂与余额重算。
- 🗂️ 审计/错误目录继续统一：新增 `src/lib/audit-catalog.ts` 与 `apiErrorCodes`，并把 `deletion/settings/receipt/detail/swift/invoice` 这批 service 的审计动作/目标类型切到统一常量目录。
- 🧪 新增 `invoice-write` 单测，覆盖“坏数据不进事务”和“正常保存走事务 + 提交后对账”边界；Jest 扩展到 `24 suites / 114 tests`。
- 📈 coverage threshold 第八轮小步上调：global 提升到 `46 / 72 / 66 / 66`，并把 `invoice-write` 纳入局部门禁（`50 / 80 / 72 / 70`），本地 `build + test:ci` 全绿。

### v1.0.61 (2026-03-11)
- 🧭 前端错误消费继续工程化：`src/components/workspace/api/client.ts` 现统一输出 `WorkspaceApiError`、`getApiErrorMessage/getApiErrorCode/getApiResponseErrorMessage`，`invoice/customer/settings/receipt/detail/swift/users/dashboard` 这批入口已不再直接依赖原始中文错误文案。
- 📜 设置页新增独立配置审计查询与展示：`/api/settings?view=audit` 返回配置变更分页结果，设置页新增审计卡片，展示操作人、时间、更新键与前后值。
- 🧪 新增 `client.test.ts` 与更多 `use-settings-actions` 分支测试，Jest 扩展到 `25 suites / 124 tests`。
- 📈 coverage threshold 第九轮小步上调：global 提升到 `47 / 73 / 67 / 66`，`use-settings-actions` 局部门禁同步提升到 `40 / 92 / 68 / 68`。

### v1.0.62 (2026-03-11)
- 🧱 剩余历史错误响应收口：`auth/customer/customer-fixes/report/upload-image/locale/init` 这批路由统一补齐 `code/message/detail`，不再返回裸字符串错误体。
- 🧩 前端错误消费继续收尾：登录页、账单导入、客户导入、用户管理补齐错误码优先消费，旧式 `result.error || ...` 路径清理完成。
- 🧪 隔离 API 回归新增错误码断言：已覆盖 `AUTH_REQUIRED / INVALID_CREDENTIALS / INVALID_ACTION / CUSTOMER_DUPLICATE / IMPORT_TEMPLATE_INVALID`。
- 🧪 Jest 扩展到 `25 suites / 128 tests`。
- 📈 coverage threshold 第十轮小步上调：global 提升到 `48 / 74 / 68 / 66`，`use-user-actions` 局部门禁同步提升到 `50 / 100 / 88 / 85`。

### v1.0.63 (2026-03-11)
- 🌐 服务端错误字典/i18n 继续下沉：新增 `src/lib/api-error-catalog.ts` 统一维护错误码与中文动态消息翻译，`api-error-response` 现在会基于 `NEXT_LOCALE / Accept-Language` 在服务端直接返回本地化错误；`invoice/receipt/detail/swift/deletion/init` 等剩余路由全部接入请求级本地化响应。
- 🧾 设置审计补齐筛选能力：`/api/settings?view=audit` 新增 `actor / key / dateFrom / dateTo` 过滤参数，设置页审计卡片新增操作者、配置键、时间范围筛选与重置；后端同时补了后置过滤，避免数据库过滤与游标分页之间的边界偏差。
- 🧠 前端错误消费收口为“保留服务端具体文案，错误码只做兜底”：`workspace api client` 不再把详细错误覆写成 `Invalid request` 这类通用文案，避免丢失 `OCR_DISABLED`、容差边界等关键细节。
- 🧪 针对性补测：新增 `api-error-catalog.test.ts`，扩展 `settings-service / use-settings-actions / use-customer-actions / invoice-service`，并修正 isolated API 用例对中英错误文案的脆弱断言；Jest 扩展到 `26 suites / 141 tests`。
- 📈 coverage threshold 第十一次小步上调：global 提升到 `50 / 75 / 69 / 67`，并优先提高 `use-customer-actions` 到 `40 / 65 / 50 / 50`、`invoice-service` 到 `39 / 38 / 47 / 44`；本地 `build + test:ci` 全绿。

### v1.0.68 (2026-03-11)
- 🧱 核心写接口全链路事务边界审计补完：新增 `auth-service / customer-service / customer-fix-service / init-service`，将 `/api/auth /api/customer /api/customer/fixes /api/init` 继续收敛为薄路由；`matching / receipt-service / detail-service / invoice-service(rematch)` 这批残余写路径补齐事务客户端透传，避免多步写入中途失败留下半状态。
- 🧾 审计目录继续收口：`audit-catalog` 扩展到 `USER / CUSTOMER` 目标类型与创建、更新、删除、导入、修复、密码操作等动作，核心 create/update/delete 链路都已经纳入审计事件。
- ✅ 回归补强：新增 `auth-service / customer-service / customer-fix-service / init-service` 单测，扩展 `invoice-service(rematch)` 覆盖，并新增 `customer-fix-flow` isolated API case；coverage threshold 第十六次提升到 `56/79/74/72`。

### v1.0.67 (2026-03-11)
- 🏷️ 本地运行版本已与仓库同步：`package.json#version` 提升到 `1.0.67`，设置页顶部继续作为强可见版本入口；本地 `docker compose up -d --build` 后容器内版本与仓库版本一致。
- 🌐 服务端成功摘要继续扩到读接口与模板下载：`/api/customer` 的 owner options / list / create / update 与 `/api/invoice` 的 list / order lookup / receipt lookup / import template 统一补齐本地化成功消息，`customer/invoice` 模板下载也开始返回 `X-Success-Message`。
- 📜 设置审计升级为“游标分页 + 导出历史”：`/api/settings?view=audit-export-history` 新增独立导出历史查询；每次配置审计 CSV 导出都会记录操作者、筛选条件、导出条数、服务端上限、是否截断与导出涉及的配置键；设置页新增导出历史表格、刷新/加载更多与游标摘要。
- 🧪 回归继续补到设置审计新能力与 hooks：新增 `settings-service` 的导出历史 service 测试、`use-settings-actions` 的导出历史/游标/导出后刷新测试，并补齐 `use-invoice-actions / use-customer-actions / api-success-catalog / settings-and-report isolated API case`。
- 📈 coverage threshold 第十五次小步上调：global 提升到 `55 / 79 / 73 / 71`，并优先提高 `use-invoice-actions` 到 `70 / 88 / 80 / 80`、`use-customer-actions` 到 `45 / 70 / 55 / 53`；同时将 `use-settings-actions` 的函数门禁从假性 `93` 收口到当前真实可持续的 `92`。

### v1.0.66 (2026-03-11)
- 🏷️ 页面版本号改为“设置页顶部强可见 + `package.json` 单一来源”：`Settings` 页面最上方新增当前版本号展示，继续通过 `src/lib/app-version.ts` 统一读取 `package.json#version`，避免版本信息只出现在页脚。
- 🌐 服务端成功消息继续扩到用户管理与查询/导出动作：`/api/auth` 的 `login / me / create / parent-options / list` 统一返回本地化 `message`；`/api/settings?view=audit` 的列表与 CSV 导出补齐成功摘要；`/api/report` 导出补齐统一成功头，前端报表下载开始消费服务端成功消息。
- 📄 设置审计导出前端补齐“导出摘要/超限提示”：CSV 导出后会根据服务端返回的 `X-Export-Summary / X-Export-Row-Count / X-Export-Limit-*` 展示“实际导出多少条、服务端上限多少、是否被截断”的摘要，不再只下载文件不反馈结果。
- 🧪 回归继续向 `invoice-service + use-settings-actions` 倾斜：新增 `updateInvoiceOrder / deleteInvoiceOrder` 分支测试、设置审计导出摘要测试、用户管理成功消息测试与 success catalog 动态摘要翻译测试；Jest 扩展到 `27 suites / 162 tests`。
- 📈 coverage threshold 第十四次小步上调：global 提升到 `54 / 78 / 72 / 70`，并优先提高 `invoice-service` 到 `45 / 50 / 52 / 50`、`use-settings-actions` 到 `45 / 93 / 70 / 70`。

### v1.0.65 (2026-03-11)
- 🏷️ 前端底部版本号正式落地：新增 `src/lib/app-version.ts` 作为单一版本来源，直接读取 `package.json#version`；登录页与 workspace 页面底部都会固定显示当前版本号，后续每次小版本更新只需同步 `package.json + README + todolist`。
- 🌐 服务端成功消息继续扩到批处理提示：`api-success-catalog` 新增 OCR 配置测试、客户导入摘要、重匹配摘要、余额转移、账单内加单/改单等成功文案；`invoice import` 与 `customer import` 这两条历史批量接口也开始按请求语言本地化成功消息，不再只翻译错误。
- 📄 设置审计继续升级为“服务端元信息 + 批量导出控制”：新增 `SETTINGS_AUDIT_MAX_PAGE_SIZE / SETTINGS_AUDIT_EXPORT_MAX_ROWS` 系统配置，`/api/settings?view=audit` 现在返回服务端 `meta`（`defaultPageSize / maxPageSize / maxExportRows / pageSizeOptions / cursorMode`），CSV 导出支持 `exportLimit` 并由服务端强制截断、回传导出上限头。
- 🧪 回归重点转到 `invoice-write + settings-service`：新增 `invoice-write` 对“同账单累加 / Un_Associated 吞并”分支测试，新增 `settings-service` 对“审计能力元信息 / 导出上限钳制”测试；Jest 扩展到 `27 suites / 157 tests`。
- 📈 coverage threshold 第十三次小步上调：global 提升到 `53 / 77 / 71 / 69`，并优先提高 `invoice-write` 到 `60 / 90 / 80 / 80`、`settings-service` 到 `45 / 60 / 55 / 55`；本地 `test:ci` 与 GitHub Actions 全绿。

### v1.0.64 (2026-03-11)
- 🌐 服务端成功消息开始统一字典化：新增 `src/lib/api-success-catalog.ts`、`src/lib/api-success-response.ts` 与 `src/lib/api-response-locale.ts`，`auth / init / settings / invoice / deletion / customer-fixes / receipt / detail / swift` 这批成功响应现在也会基于 `NEXT_LOCALE / Accept-Language` 直接返回本地化文案，不再只在前端兜底翻译。
- 🧹 历史成功消息规范化：`receipt-service` 与 `invoice-write` 中遗留的英文 `please modify guest information` 已改为统一中文语义 `请修复客户信息`，再由服务端字典按语言输出，避免中英混杂。
- 📄 设置审计增强为“筛选 + 分页大小 + 导出”：`/api/settings?view=audit` 新增 `limit` 自定义页大小，设置页审计卡片新增 `20 / 50 / 100` 分页大小选择与 `CSV` 导出；后端新增全量导出查询与本地化列头 CSV 输出。
- 🧪 补齐 success/audit 回归：新增 `api-success-catalog.test.ts`，扩展 `settings-service / use-settings-actions / use-invoice-actions / invoice-service / invoice-write` 测试覆盖导出、分页大小、成功消息与新增账单分支；Jest 扩展到 `27 suites / 152 tests`。
- 📈 coverage threshold 第十二次小步上调：global 提升到 `52 / 76 / 70 / 68`，并优先提高 `use-invoice-actions` 到 `60 / 80 / 65 / 65`、`invoice-service` 到 `42 / 40 / 49 / 46`；本地 `test:ci` 全绿。

### v1.0.58 (2026-03-11)
- 🧱 `settings / receipt / detail / swift` 写接口继续统一：新增 `settings-service / receipt-service / detail-service / swift-service`，路由层只保留请求解析、OCR 识别和响应封装。
- ⚙️ SWIFT 容差正式配置化：新增 `SWIFT_WARNING_TOLERANCE` 与 `SWIFT_REJECT_TOLERANCE`，后端从 `/api/settings` 读取，前端设置页同步可编辑。
- 🧠 修复系统配置缓存缺陷：`system-settings` 现在会按缺失 key 增量补齐热缓存，不再因为第一次只读到部分 key 就错误回退到默认值。
- 🧪 单测继续补齐：新增 `settings-service / receipt-service / detail-service / swift-service / system-settings` 测试，覆盖结构化错误、事务边界、状态回退、配置生效与缓存补齐。
- 🔁 隔离 API 回归扩展：`settings-and-report` 与 `swift-tolerance-boundaries` 已验证“通过 `/api/settings` 修改 SWIFT 容差后，后续 `/api/swift` 请求立即按新阈值生效”。
- 📈 coverage threshold 第六轮小步上调：global 提升到 `44 / 70 / 64 / 64`，本地 `test:ci` 全绿。

### v1.0.57 (2026-03-11)
- 🟢 GitHub Actions Node 24 兼容收口：CI workflow 升级到 `actions/checkout@v5` 与 `actions/setup-node@v5`，后续不再触发 Node 20 action 退役告警。
- 🧱 删除审批服务层落地：新增 `src/lib/deletion-service.ts`、`src/lib/api-error.ts`、`src/lib/transaction.ts`，先在 `/api/deletion` 上统一 `code/message/detail` 错误结构，并把审批写路径收口到事务服务层。
- 🪝 删除审批前端模块化：`DeletionManager` 抽出 `use-deletion-actions`，清理历史巨石 import，补齐删除审批模块的 hook 级自动化测试。
- 🧪 删除审批单测补齐：新增 `deletion-service.test.ts` 与 `use-deletion-actions.test.tsx`，覆盖申请校验、审批/拒绝、事务内状态回退、结构化错误码与前端 reload 行为。
- 📈 coverage threshold 第五轮小步上调：将 deletion hook + deletion service 纳入门禁，global 提升到 `43 / 69 / 63 / 63`；本地 `test:ci` 全绿。

### v1.0.56 (2026-03-11)
- 🧪 新增业务链路集成测试：补齐 `60-receipt-detail-swift-lifecycle`，覆盖 `Receipt -> Detail -> Swift -> mark-received` 主链路、管理员拒绝删除、签收后禁止删除等状态迁移与审批边界。
- 🎯 新增 SWIFT 金额容差边界回归：补齐 `70-swift-tolerance-boundaries`，验证 `±5 / ±6 / ±50 / ±51` 四个关键边界、错误 SWIFT 的持久化与创建者直删路径。
- 🧮 单测补齐金额容差规则：`matching.test.ts` 新增 `validateAmountTolerance` 的正常/警告/拒绝分支，保证服务端提示文案与容差判定在边界值上稳定。
- 📈 coverage threshold 第四轮小步上调：global 提升到 `42 / 68 / 62 / 62`，并同步收紧 `use-invoice-actions / use-customer-actions / use-settings-actions` 的局部门禁。
- ✅ GitHub Actions `22934138981` 已最终通过，并为后续 action 版本升级提供了基线对照。

### v1.0.55 (2026-03-11)
- 🧯 修复 GitHub Actions 隔离 E2E 锁冲突：`test:api:isolated` 与 `test:e2e:isolated` 改为分别使用 `.next-api-isolated` / `.next-e2e-isolated`，避免两个 `next dev` 阶段共用 `.next/dev/lock` 导致 CI 在 `app not ready` 处失败。
- 🧹 清理错误产物来源：此前 `NEXT_DIST_DIR` 误用绝对路径，Next 会把输出落到仓库内的 `Users/...` 目录并自动污染 `tsconfig.json`；现已统一改为相对 `distDir`，并在 `.gitignore`/`tsconfig.json` 中显式声明测试专用输出目录，避免再次生成脏目录。
- ✅ 本地完整验证通过：`npx tsc --noEmit`、`npm run test:api:isolated`、`npm run test:e2e:isolated`、`npm run test:ci` 全部通过。

### v1.0.52 (2026-03-11)
- 🛡️ 第二批隔离 API case 落地：新增 `40-auth-hierarchy-boundaries` 与 `50-deletion-approval-flow`，补齐层级权限边界、同级可见不可管、旁支不可管理、删除审批与状态回退链路验证。
- 🪝 hook 分支测试继续补强：为 `use-invoice-actions`、`use-customer-actions`、`use-settings-actions` 增加成功/失败/重试分支测试，覆盖率显著提升。
- 📈 coverage threshold 小步上调：在保持“只对高价值 hook 启用门禁”的前提下，提升 global 与 `invoice/customer/settings` hook 阈值，避免一次性全仓拉满。

### v1.0.51 (2026-03-10)
- 🧪 自动化测试工程化收口：隔离 API 测试从单脚本重构为“环境引导 + 模块化 case 文件”，新增 `tests/api/isolated/helpers/context.mjs` 与四组 case（鉴权/客户/账单链路/设置导出）。
- 🪝 第一批 workspace hook/module 测试落地：为 `invoice / customer / settings` 的关键 hooks 补齐 Jest + RTL 测试，并在 `jest.config.ts` 增加针对这些 hook 的覆盖率门禁。
- 🎭 新增稳定 Playwright 闭环：补充登录导航、客户->账单创建、设置页渲染三条隔离 E2E，用例通过 `/api/init` 自举管理员，不依赖手工准备环境。
- 🧱 CI 门禁上线：新增 `.github/workflows/ci.yml` 与 `npm run test:ci`，统一串联 `tsc + lint + unit coverage + isolated api + isolated e2e`。
- 🔧 真实缺陷修复：`/api/init` 补齐根管理员幂等初始化与层级归一；`/api/invoice` 修复 grouped order 合并后继续使用旧 `orderId` 结算可能触发的 500。

### v1.0.50 (2026-03-10)
- 🪝 账单模块继续收口页面壳状态：新增 `use-invoice-view-state.ts`，统一承接搜索词、展开状态、导入文件 input ref 与列表加载逻辑。
- 📉 账单主模块继续减重：`invoice-manager.tsx` 从 `329` 行进一步压缩到 `304` 行，页面层继续逼近纯编排。
- 🧭 收尾策略固化：`deletions / dashboard` 当前文件体量较小，暂列为低优先级，不做为了拆分而拆分；后续优先继续复用现有 shared/import-result 架构。

### v1.0.47 (2026-03-10)
- 🪝 账单模块继续抽远程动作与页面壳：新增 `use-invoice-actions.ts`，并将顶部工具区、搜索卡片拆为独立组件，进一步收口创建/更新/删除/加单与模板下载逻辑。
- 📉 账单主模块继续瘦身：`invoice-manager.tsx` 从 `533` 行进一步压缩到 `329` 行，页面层更接近纯编排。

### v1.0.46 (2026-03-10)
- 🧩 设置模块完成首轮完整拆分：密码卡片、分支清库卡片、系统配置卡片抽为独立组件，并新增 `use-settings-forms.ts`、`use-settings-actions.ts` 收口状态与操作。
- 📉 设置主模块大幅瘦身：`settings-manager.tsx` 从 `479` 行压缩到 `139` 行，页面层现在主要保留消息提示、用户管理挂载与组件编排。

### v1.0.45 (2026-03-10)
- 🧩 SWIFT 模块完成首轮完整拆分：列表、上传弹窗、直接创建弹窗、图片预览弹窗抽为独立组件，并新增 `use-swift-forms.ts`、`use-swift-actions.ts` 收口状态与网络动作。
- 📉 SWIFT 主模块大幅瘦身：`swift-manager.tsx` 从 `541` 行压缩到 `202` 行，页面层现在主要保留筛选、查询与组件编排。

### v1.0.44 (2026-03-10)
- 🪝 客户模块继续收口本地状态与网络动作：新增 `use-customer-forms.ts` 与 `use-customer-actions.ts`，统一承接创建/编辑、修复、批量导入、问题行重试与长文本预览状态。
- 📉 客户主模块继续瘦身：`customer-manager.tsx` 从 `558` 行进一步压缩到 `347` 行，页面层现在主要保留查询、导入列定义与组件编排。

### v1.0.43 (2026-03-10)
- 🧩 客户模块开始组件化：客户列表、待修复队列、创建/编辑客户弹窗、修复客户弹窗、长文本预览弹窗抽为独立组件，主模块保留数据加载、导入结果状态机与动作编排。
- 📉 客户主模块首轮瘦身：`customer-manager.tsx` 从 `721` 行压缩到 `558` 行，为后续抽本地 hook 与动作 hook 做准备。

### v1.0.42 (2026-03-10)
- 🪝 详情模块继续收口本地状态与网络动作：新增 `use-detail-forms.ts` 与 `use-detail-actions.ts`，统一承接上传识别、确认创建、直接创建、删除申请、图片预览与表单重置逻辑。
- 📉 详情主模块继续瘦身：`detail-manager.tsx` 从 `328` 行进一步压缩到 `203` 行，页面层现在基本只剩筛选、查询与组件编排。

### v1.0.41 (2026-03-10)
- 🧩 详情模块开始组件化：列表、上传付款明细、直接创建付款明细、图片预览四块 UI 抽为独立组件，主模块仅保留状态与业务动作编排。
- 📉 详情主模块首轮瘦身：`detail-manager.tsx` 从 `549` 行压缩到 `328` 行，为后续抽本地 hook 和远程动作 hook 做准备。

### v1.0.37 (2026-03-10)
- 🪝 账单模块继续抽远程动作：新增 `use-invoice-tools.ts`，统一承接转移余额、冲突匹配、订单付款记录、账单日期编辑等网络动作与相关状态。
- 📉 账单主模块大幅减重：`invoice-manager.tsx` 从 `711` 行压缩到 `533` 行，页面层进一步接近纯编排。

### v1.0.36 (2026-03-10)
- 🪝 账单模块表单态继续拆分：新增 `use-invoice-order-forms.ts`，统一承接创建账单、编辑订单、行内加单的本地状态、候选回填与表单重置。
- 📉 账单主模块继续瘦身：`invoice-manager.tsx` 从 `901` 行进一步压缩到 `711` 行，页面层基本收敛为查询、动作编排与组件拼装。

### v1.0.35 (2026-03-10)
- 🪝 账单模块继续收敛副作用逻辑：新增 `use-invoice-import.tsx` 与 `use-invoice-customer-lookup.ts`，分别承接导入结果状态机与客户候选查询防抖。
- 📉 账单主模块再次减重：`invoice-manager.tsx` 从 `1112` 行压缩到 `901` 行，主组件进一步收敛为页面编排层。

### v1.0.34 (2026-03-10)
- 🧩 账单列表区继续拆分：将发票卡片列表、订单表格、行内加单表单抽到独立组件 `invoice-list.tsx`，主模块仅保留状态与业务动作编排。
- 📉 账单主模块再次瘦身：`invoice-manager.tsx` 从 `1339` 行进一步压缩到 `1112` 行，继续为后续抽本地 hook 做准备。

### v1.0.33 (2026-03-09)
- 🧩 继续推进前端模块内拆分：将 `invoice-manager` 的创建账单、编辑订单、转移多付、订单付款记录、冲突匹配五个重型对话框抽为独立组件文件。
- 🧱 账单模块类型收口：新增 `invoices/types.ts` 统一承接草稿订单、编辑订单、转移余额、冲突预览等结构，减少状态定义散落在主组件内。
- 📉 账单主模块继续瘦身：`invoice-manager.tsx` 从 `1608` 行压缩到 `1339` 行，后续拆表格区与 hook 的成本进一步降低。

### v1.0.11 (2026-03-02)
- 🧱 权限模型升级起步：新增用户层级字段 `level + parentId`，并完成历史数据回填（含 root admin 归位）。
- 🔐 用户管理规则收敛：同级不可管理、仅可管理下级；创建账号默认挂到当前创建者，可按规则指定上级。
- 👁️ 资源可见性改造：收据/明细/SWIFT/账单查询改为“创建者及其下级”可见，并叠加客户归属可见。
- 🔁 rematch 升级为“预览冲突组 + 用户选择 keep/merge 后执行”，不再盲目直接合并。
- 🧮 匹配规则升级：`findMatchingReceipt` 改为“同客组严格匹配 + 金额容差(可配置，默认5)”。
- ⚙️ 新增系统配置项 `DETAIL_RECEIPT_MATCH_TOLERANCE`（`/api/settings` 可维护）。
- 📌 发票列表排序升级：`DEPOSIT_POOL` 优先于 `Un_Associated` 置顶显示。
- 💰 金额存储升级：核心金额字段迁移为 Prisma `Decimal`，并完成接口侧数值兼容处理。

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

## 🧱 前端模块拆分规则与预留接口

后续继续拆前端时，统一按下面这套边界执行，避免重新长回巨石文件。

### 1. 页面层只做编排，不做细节实现
- `src/app/(workspace)/**/page.tsx` 只负责路由入口、权限门禁、layout 挂载。
- `*-manager.tsx` 只负责数据加载、权限衍生、hook 组合、组件拼装。
- 页面层不要再写大段表格列定义、导入状态机、表单重置逻辑、网络请求分支。

### 2. 每个业务模块固定目录结构
- `components/`：列表、工具栏、卡片、对话框、预览器等纯视图块。
- `hooks/`：
  - `use-*-forms` 负责本地表单态、展开态、预览态、默认值回填。
  - `use-*-actions` 负责远程请求、提交态、成功/失败后的刷新联动。
  - `use-*-import` / `use-*-columns` 负责导入结果状态机、问题行列配置与重试编排。
- `types.ts`：收口本模块公共类型，避免匿名对象散落在页面和组件之间。

### 3. 共享能力必须留在 workspace 公共层
- 导入结果弹窗、分页筛选、API client、UI 文案、多语言工具统一放在 `src/components/workspace/{api,hooks,components,chrome,shared}`。
- 同类模块如果出现第二次复制，必须回抽到 shared，而不是在模块目录里再复制一份。

### 4. 后续新增功能的预留点
- 工具栏新增动作：优先加到 `components/*-toolbar.tsx`，不要把按钮直接塞回 manager。
- 导入问题行新增列：优先扩展 `use-*-import-columns.tsx` 或对应 import hook。
- 新增弹窗：先落 `components/`，再由 manager 负责挂载，不要在 manager 里直接写完整弹窗 JSX。
- 新增网络动作：统一补到 `use-*-actions.ts`，避免页面层堆叠 `fetch/apiCall`。
- 新增格式化/搜索辅助：优先放模块内 helper/hook；若跨模块复用，再回抽 shared。

### 5. 当前拆分进度与剩余目标
- 已完成首轮模块化：`invoices / receipts / details / swifts / customers / settings / users`。
- 低优先级轻量模块：`deletions / dashboard` 目前体量可控，暂不强拆。
- 后续继续清理方向：
  - 账单模块剩余少量格式化与展开态辅助可继续下沉。
  - 客户模块剩余少量格式化辅助可继续收口为 helper/hook。
  - 若后续新增复杂工作区，先复用现有 import-result 架构，再决定是否抽新的 shared 组件。
  - `deletions / dashboard` 后续仅在体量或职责明显膨胀时再拆，避免为模块化而引入额外维护成本。

### 6. 版本号规则
- 前端版本号以 `package.json#version` 为单一来源。
- 设置页顶部必须展示当前版本号；页脚版本号可以保留，但不能作为唯一可见入口。
- 每次小版本更新必须同步更新：
  - `package.json#version`
  - `README.md` 版本记录
  - `todolist.md` 当前版本与里程碑摘要
- 不要再维护多个分散版本号来源，避免网页显示、文档与 CI 产物版本不一致。
