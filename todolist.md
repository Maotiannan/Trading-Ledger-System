# Trading-Ledger-System TODO List

> **收汇管理系统** 后续开发 & 优化计划
> 当前版本：**v1.0.1**
> 最后更新：2026-02-24

## P0（紧急 · 1 周内必须完成）

### 安全加固（最高优先级）
- [x] **密码明文存储修复**：User.password 使用 `bcrypt` 加密 ✅ 2026-02-24
  - 使用 bcrypt（12 rounds）替换不安全的 SHA-256
  - 支持旧密码自动迁移（登录时自动升级）
- [ ] **文件上传安全重构**：
  - 改用私有目录（`/uploads/` 而非 `public/`）
  - 添加文件类型、大小、路径白名单限制
  - 使用 `sharp` 压缩 + 病毒扫描（可选）
- [ ] **数据库生产化**：SQLite → PostgreSQL（Neon / Supabase / Railway 均可）

### 核心修复
- [ ] 切换 Prisma + PostgreSQL 并更新 `docker-compose.yml` 和 `Caddyfile`

## P1（2 周内完成）

- [ ] **升级 next-auth** 到 v5（App Router 原生支持更好）
- [ ] **封装权限中间件**：`withAuth` + `withRole`（统一所有 API Route 鉴权）
- [ ] **模糊匹配优化**：使用 `Order.tokens` 字段 + Levenshtein / token 相似度（当前仅 `includes` 容易误匹配）
- [ ] **AI 调用增强**：VLM 接口增加重试、超时、费用日志、失败 fallback

## P2（后续迭代）

### 测试 & 质量
- [ ] 添加单元测试（Jest + React Testing Library）
- [ ] E2E 测试（Playwright）

### 功能增强
- [ ] **报表导出**：Excel / PDF（使用 `exceljs` 或 `pdf-lib`）
- [ ] **多语言支持**：启用 `next-intl`（中英双语）
- [ ] **高级搜索 & 过滤**：全局搜索 + 高级筛选（日期、金额区间、状态）
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
