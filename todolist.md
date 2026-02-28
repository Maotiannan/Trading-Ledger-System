# Trading-Ledger-System TODO List

> **收汇管理系统** 后续开发 & 优化计划
> 当前版本：**v1.0.5**
> 最后更新：2026-02-28

## P0（紧急 · 1 周内必须完成）

### 安全加固（最高优先级）
- [x] **密码明文存储修复**：User.password 使用 `bcrypt` 加密 ✅ 2026-02-24
  - 使用 bcrypt（12 rounds）替换不安全的 SHA-256
  - 支持旧密码自动迁移（登录时自动升级）
- [x] **会话鉴权重构**：移除 `x-user-id` 伪造风险，改为服务端签名 Cookie ✅ 2026-02-26
  - 新增 `SESSION_SECRET` 会话签名校验
  - 前后端移除 `localStorage userId + x-user-id` 透传
  - `/api/init` 改为默认禁用，需显式开关 + 初始化令牌
- [x] **文件上传安全重构** ✅ 2026-02-26
  - 保持公开目录访问，但上传敏感文件禁止入 Git（完善 `.gitignore` + `.env.example`）
  - 已完成文件类型、大小、文件名白名单/清洗限制（统一上传封装）
  - 使用 `sharp` 压缩 + 病毒扫描（可选，后续按需接入）
- [x] **数据库生产化**：SQLite → PostgreSQL（Neon / Supabase / Railway 均可） ✅ 2026-02-26
  - Prisma 数据源已切换为 PostgreSQL
  - 已提交 PostgreSQL 初始迁移（`prisma/migrations`）

### 核心修复
- [x] 切换 Prisma + PostgreSQL 并更新 `docker-compose.yml` 和 `Caddyfile` ✅ 2026-02-26

### 代码审查整改（2026-02-27）
- [x] **前端 API 调用统一状态码校验**（`apiCall` 增加 `response.ok` 检查）✅ 2026-02-27
- [x] **Detail 确认接口输入校验**（空 items/非法金额直接拒绝）✅ 2026-02-27
- [x] **Detail 创建链路事务化**（创建明细 + 更新收据状态）✅ 2026-02-27
- [x] **资源所有权校验**（Receipt/Detail/SWIFT/Deletion 申请接入 owner 校验）✅ 2026-02-27
- [x] **Session Cookie 加固**（`SameSite` 调整为 `strict`）✅ 2026-02-27
- [x] **上传文件二进制签名校验**（magic number，防止 MIME 伪造）✅ 2026-02-27
- [x] **订单并发去重**（`Order(invoiceId, orderNo)` 唯一约束 + `P2002` 兜底）✅ 2026-02-27
- [x] **登录防用户枚举**（不存在用户也执行 dummy bcrypt compare）✅ 2026-02-27
- [x] **搜索参数长度限制**（Receipt/Detail/SWIFT）✅ 2026-02-27
- [x] **收据金额校验收紧**（金额必须 `> 0`）✅ 2026-02-27
- [ ] **请求体大小限制**（Next.js/Caddy 双层限制，防 DoS）

## P1（2 周内完成）

- [x] **升级 next-auth** 到 v5（App Router 原生支持更好） ✅ 2026-02-26
- [x] **封装权限中间件**：`withAuth` + `withRole`（统一所有 API Route 鉴权） ✅ 2026-02-26
- [x] **模糊匹配优化**：使用 `Order.tokens` 字段 + Levenshtein / token 相似度（当前仅 `includes` 容易误匹配） ✅ 2026-02-26
- [x] **AI 调用增强**：VLM 接口增加重试、超时、费用日志、失败 fallback ✅ 2026-02-26
- [x] **统一输入验证层**：新增 `src/lib/validators.ts`（Zod）✅ 2026-02-27
- [x] **审计接口抽象**：新增 `src/lib/audit.ts`（可插拔 sink）✅ 2026-02-27
- [x] **审计日志模型与迁移**：新增 `AuditLog` + migration 脚本 ✅ 2026-02-27
- [ ] **执行并验证数据库迁移**（开发/生产环境）

## P2（后续迭代）

### 测试 & 质量
- [x] 添加单元测试（Jest + React Testing Library） ✅ 2026-02-26
- [x] E2E 测试（Playwright） ✅ 2026-02-26

### 功能增强
- [x] **报表导出**：Excel / PDF（使用 `exceljs` 或 `pdf-lib`） ✅ 2026-02-26
- [x] **账单批量导入**：Excel模板下载 + 批量上传（严格行级校验，走完整业务逻辑） ✅ 2026-02-28
- [x] **客户批量导入**：Excel模板下载 + 批量上传（严格行级校验，继承权限约束） ✅ 2026-02-28
- [x] **业务数据清库能力**：保留用户，清空账单/收据/明细/SWIFT/客户等业务数据 ✅ 2026-02-28
- [x] **多语言支持**：启用 `next-intl`（中英双语） ✅ 2026-02-26
- [x] **高级搜索 & 过滤**：全局搜索 + 高级筛选（日期、金额区间、状态） ✅ 2026-02-26
- [ ] **通知系统**：收汇成功、删除审批提醒（WebSocket + Email）

### 运维 & 监控
- [ ] **Docker 完整生产配置**：docker-compose.yml（Postgres + Caddy + App + Redis 可选）
- [ ] **日志 & 监控**：Sentry / Prometheus + Grafana
- [ ] **备份策略**：自动数据库备份

### 其他
- [ ] 完善 Swagger / API 文档
- [ ] 移动端适配（PWA 或响应式优化）
- [ ] 性能优化（图片懒加载、大批量匹配缓存）

---

**使用说明**：
- 完成后把 `- [ ]` 改成 `- [x]` 并写上完成日期
- 每周更新一次此文件，同步到 `worklog.md`
- 新需求可直接在此文件新增条目

欢迎 PR / Issue 一起推进！
