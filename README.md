# 收汇管理系统 (Foreign Exchange Receipt Management System)

一个专业的外汇收款管理系统，用于追踪和管理国际汇款收据、账单和SWIFT水单。

## 技术栈

- **前端**: Next.js 16 + React + TypeScript + Tailwind CSS + shadcn/ui
- **后端**: Next.js API Routes + Prisma ORM
- **数据库**: PostgreSQL + Prisma Migrate
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
- 设置用户角色（ADMIN/USER）

**数据结构：**
```
User (用户)
├── email: 邮箱
├── password: 密码
├── name: 姓名
└── role: 角色 (ADMIN/USER)
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

### 账单接口 `/api/invoice`
- `GET` - 获取账单列表
- `POST` - 创建账单
- `PUT` - 更新订单/添加订单/删除订单/转移余额/刷新匹配
- `DELETE` - 删除账单

### 收据接口 `/api/receipt`
- `GET` - 获取收据列表
- `POST` - 上传收据/确认识别/标记签收

### 付款明细接口 `/api/detail`
- `GET` - 获取明细列表
- `POST` - 上传明细/确认识别

### SWIFT接口 `/api/swift`
- `GET` - 获取SWIFT列表
- `POST` - 上传SWIFT/确认识别

### 用户接口 `/api/user`
- `GET` - 获取用户列表
- `POST` - 创建用户
- `PUT` - 更新用户

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

### Docker 部署（Postgres + App + Caddy）

```bash
# 1) 准备环境变量
cp .env.example .env

# 2) 修改 .env 中的密钥（至少修改 SESSION_SECRET / POSTGRES_PASSWORD）

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
INIT_ADMIN_PASSWORD=replace-strong-password
```

> 安全说明：不再提供默认管理员弱口令；`/api/init` 默认禁用。

### 上传与敏感数据规范

- 上传目录保持公开访问（`/upload/images`），不改为私有目录。
- 服务端统一校验上传文件：仅允许 `JPG/PNG/WEBP/HEIC`，最大 `10MB`，并对文件名做安全清洗。
- 严禁将敏感数据提交到仓库：`.env`、上传原图、运行时日志、本地数据库文件均已在 `.gitignore` 排除。
- 请基于 `.env.example` 创建本地 `.env`，不要提交真实密钥。

### 数据库迁移说明（PostgreSQL）

- 当前 Prisma 数据源已切换为 PostgreSQL（`prisma/schema.prisma`）。
- 初始迁移文件已提交：`prisma/migrations/20260226193500_init_postgres/migration.sql`。
- 开发环境使用：`bun run db:migrate`。
- 生产环境发布使用：`bun run db:deploy`。

---

## 开发说明

### 目录结构
```
src/
├── app/
│   ├── page.tsx          # 主页面（所有模块）
│   └── api/              # API路由
│       ├── invoice/      # 账单接口
│       ├── receipt/      # 收据接口
│       ├── detail/       # 付款明细接口
│       ├── swift/        # SWIFT接口
│       ├── user/         # 用户接口
│       ├── deletion/     # 删除审批接口
│       └── auth/         # 认证接口
├── components/ui/        # shadcn/ui 组件
├── lib/
│   ├── db.ts            # Prisma 客户端
│   ├── store.ts         # Zustand 状态管理
│   └── matching.ts      # 匹配逻辑
└── prisma/
    └── schema.prisma    # 数据库模型
```

### 关键算法

1. **订单匹配算法**: 订单号不区分大小写，支持双向包含匹配
2. **收据匹配算法**: 订单号匹配 + 金额相等
3. **余额计算**: `OrderBalance = Amount - Sum(Receipt.USD)`

---

## 更新日志

### v1.0.3 (2026-02-26)
- 🐳 新增 `Dockerfile` + `docker-compose.yml`（Postgres + App + Caddy）
- 🌐 `Caddyfile` 更新为容器内反向代理 `app:3000`
- 🚀 应用容器启动时自动执行 `prisma migrate deploy`
- 🛡️ 新增 `withAuth` + `withRole` 鉴权封装并接入核心 API 路由

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
