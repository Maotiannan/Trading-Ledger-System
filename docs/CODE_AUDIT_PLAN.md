# 代码库审查计划 / Code Audit Plan

> 生成日期：2026-06-05
> 审查范围：全库只读扫描（591 个受版本控制文件，src/lib 34k 行 + 40 个 Prisma 模型 + Next.js 16 / React 19 工作台）
> 性质：**未做任何代码修改**，仅罗列发现项与建议，供后续排期。
> 优先级：P0 = 安全/数据正确性，必须尽快；P1 = 重要工程/可扩展性；P2 = 优化与可维护性；P3 = 清理类。

> 修复状态（2026-06-05，v1.0.171）：A1/A3/A4/A5、B1/B2/B3/B4、C1 第一阶段、C2、D1/D2 已落地并通过本地 CI、构建和 Docker 验证；C3/C4/D3/D4/D5/D6 属较大范围治理，保留为后续专项，避免在一次安全修复中引入大面积行为变化。

整体结论：项目工程化程度高（服务分层、审计目录、错误码目录、129 个测试文件、CI 门禁、备份手册、变更清单都很完善）。下面的问题不是“坏代码”，而是**随数据量与部署形态增长会显现的隐患**，以及若干一致性/清理项。

---

## A. 安全性 (Security)

### A1 [P0] 生产环境 `SESSION_SECRET` 占位符默认值会绕过安全校验
- 位置：`docker-compose.yml:9`、`.env.example:6`、`src/lib/session.ts:20-29`
- 现象：`session.ts` 要求生产环境 `SESSION_SECRET` 必须 ≥32 字符，否则抛错。但 `docker-compose.yml` 给的回退值 `replace-with-a-long-random-secret` 长度为 **33 字符**，刚好通过校验。若运维忘记设置真实密钥，生产会以一个**公开仓库里写死的密钥**签发会话 token，攻击者可伪造任意用户会话。
- 建议：回退值改成明显非法的短串（如空串或 `CHANGEME`），让生产启动时直接 fail-fast；或在启动脚本中显式拒绝已知占位符值。

### A2 [P1] 内存级限流在多实例/重启场景失效，且键无淘汰存在内存泄漏
- 位置：`src/lib/rate-limit.ts:47`（`rateLimitStore = new Map`）、`:91`
- 现象：限流计数存于进程内 `Map`。①水平扩容或多 worker 时各进程独立计数，登录爆破限流形同虚设；②某个 IP/用户的 key 只有再次命中时才会清理过期时间戳，**从不访问的 key 永久驻留**，长期运行内存只增不减。
- 建议：若长期单实例，至少加后台定期清扫空 key；若可能多实例，迁移到共享存储（Redis/数据库计数）。

### A3 [P1] `x-forwarded-for` 完全信任，限流/审计 IP 可被伪造
- 位置：`src/lib/rate-limit.ts:49-55`、`src/lib/excel-token-service.ts:112-116`
- 现象：直接取 `x-forwarded-for` 第一段作为客户端 IP。当前部署在 Caddy 反代后通常安全，但一旦应用端口被直连或反代未强制重写该头，攻击者可通过伪造头**为每次请求生成不同限流 key 绕过限流**，并污染 `ExcelApiToken.lastUsedIp` 审计字段。
- 建议：仅信任受控反代注入的头；在 Caddyfile 显式 `header_up` 重写并文档化“app 不可直接暴露”。

### A4 [P2] 默认管理员弱口令 `12345678`
- 位置：`src/lib/auth.ts:48`、`src/app/api/init/route.ts:22`、`.env.example:18`
- 现象：未配置时默认管理员密码为 `12345678`。`ENABLE_INIT_ROUTE` 默认关闭已降低风险，但 `createDefaultAdmin()` 路径仍可能用到默认值。
- 建议：首次登录强制改密；或默认生成随机密码并打印到日志一次。

### A5 [P3] `next-auth` 为未使用依赖
- 位置：`package.json`（`next-auth: ^5.0.0-beta.30`），全库 `src` 无任何引用（已 grep 确认），项目自实现 HMAC 会话（`session.ts`）。
- 建议：移除该依赖，减少 bundle 体积与供应链攻击面。同时它是 beta 版，留着易误导后人。

---

## B. 功能性 / 正确性 (Correctness)

### B1 [P1] 金额计算大量使用 `Number()` 浮点累加，存在累计精度误差
- 位置：`src/lib/matching.ts:247-253`（`calculateOrderBalance`）、`src/lib/dashboard-summary-service.ts:158-176`、以及各 service 中 `Number(x.usd)` 求和
- 现象：数据库用 `Decimal(18,2)` 存储（正确），但服务层把 Decimal 转成 JS `number` 后做加减。多笔收据累加时浮点误差会累积（如 0.1+0.2 问题），余额/未付总额可能出现 0.01 级偏差。`findSubsetSum` 已用“乘 100 取整”规避，但余额计算没有。
- 建议：金额求和统一走 `Prisma.Decimal` 或整数分；至少在最终对比/落库处做 `toFixed(2)` 归一（部分地方已做，未统一）。

### B2 [P2] Dashboard “客户欠款”以显示文案为聚合 key，可能错并不同客户
- 位置：`src/lib/dashboard-summary-service.ts:180-196`
- 现象：`customerKey = customerLabel = formatOrderNameDisplay(customerName || customerMark || orderNo)`。两个不同客户若显示文案相同，欠款会被合并到一条。
- 建议：聚合 key 用稳定的 `customerId`（无客户时再退化到 orderNo），label 仅用于展示。

### B3 [P2] 待审批计数为“拉全量再过滤”，语义正确但易随增长变慢/不一致
- 位置：`src/lib/dashboard-summary-service.ts:152-156, 233-238`
- 现象：`pendingDeletion` 通过 `listDeletionRequests / listReceiptEditRequests / ...` 拉取四类完整列表再在内存 `filter(status===PENDING).length`。
- 建议：改为各自的 `count({ where: { status: PENDING } })`，更快也避免列表分页后计数失真。

### B4 [P2] 上传文件类型校验依赖扩展名+魔数白名单，`.txt` 直接放行
- 位置：`src/lib/upload.ts:154-156`
- 现象：`.txt` 的魔数校验直接 `return true`，任意二进制改名 `.txt` 都能存入。结合 `upload-image` GET 以 `text/plain` 返回，XSS 风险有限（非 HTML 渲染），但属校验盲区。
- 建议：对 `.txt` 增加“可解析为 UTF-8 文本/无 NUL 字节”等基本检查，或评估是否真的需要允许 `.txt`。

---

## C. 可扩展性 / 性能 (Scalability & Performance)

### C1 [P1] 订单匹配在热路径上做全表扫描 + 内存相似度计算
- 位置：`src/lib/matching.ts:118-138`（`findOrCreateOrder`）、`:169-193`（`findMatchingOrder`）
- 现象：当别名直查未命中时，`db.order.findMany()` **加载全部订单**到内存逐条算相似度。收据录入（`receipt-service.ts:144`）、明细录入（`detail-service.ts:157`）都会走到，随订单累积，单次录入耗时与内存随 O(订单总数) 线性增长。
- 建议：先用 token 倒排/前缀索引或数据库侧 `WHERE` 收窄候选集，再在小集合上算相似度；或给相似度匹配设上限并分页。

### C2 [P1] Dashboard 加载全部可见发票及其嵌套订单/收据后在内存聚合
- 位置：`src/lib/dashboard-summary-service.ts:83-109, 158-209`
- 现象：`db.invoice.findMany` 无 `take`，带出每张发票的全部订单、每个订单的全部收据，然后 JS 里 reduce 求未付总额/欠款榜。首页打开即扫全量业务数据，长期会成为最慢页面。
- 建议：未付总额改用数据库聚合（`aggregate`/`groupBy` 或在 Order 上维护物化 `orderBalance` 直接 `sum`）；欠款榜限定 top-N 并下推到 SQL。

### C3 [P2] 大量 `findMany` 缺少 `take`/分页（97 处 vs 仅 8 处带 take）
- 位置：`src/lib`（全局），代表：`matching.ts:266` `getAvailableReceipts`、`customer-scope.ts` 系列（`findScopeCollisions` / `findDuplicateCustomersInScope` / `findPhoneConflictCustomersInScope` 均“拉某 owner 全部客户再 JS 过滤”）、`invoice-service.ts` 多处 `order.findMany`。
- 现象：电话号用 `/` 分隔需 JS 比对，确实难纯 SQL，但全表/全 owner 扫描随数据增长退化。
- 建议：建立“按数据量分级”的策略——可下推的下推 SQL（带索引列），无法下推的设硬上限并在文档/日志中标注被截断的数量（符合变更清单 §8 的“no silent caps”精神）。

### C4 [P2] `upload-image` GET 每次取图都做 4 次可见性查询 + 读盘
- 位置：`src/app/api/upload-image/route.ts:59-99`
- 现象：每张图片请求并发查 receipt/detail/swift/agentFile 四表确认归属。列表页多图时放大为大量 DB 往返。
- 建议：可在 URL 中带资源类型提示，命中单表；或对已鉴权用户的图片加短期签名缓存，减少重复鉴权查询。

---

## D. 工程性 / 可维护性 (Engineering & Maintainability)

### D1 [P1] 运行时/Node 版本三处不一致
- 位置：CI `node-version: 20`（`.github/workflows/ci.yml`）、Dockerfile `node:22-alpine`、启动脚本 `bun .next/standalone/server.js`（`package.json` `start`）vs 容器内 `node server.js`（Dockerfile CMD）。
- 现象：测试在 Node20、构建/运行在 Node22、本地 start 用 Bun、容器用 Node。运行时差异可能导致“CI 绿、线上挂”或 Bun/Node 行为分叉。
- 建议：统一 CI 与 Dockerfile 的 Node 主版本；明确生产到底是 Bun 还是 Node 运行并统一脚本。

### D2 [P2] `eval('require')` 加载原生模块 `@resvg/resvg-js`
- 位置：`src/lib/detail-export-image.ts:166`
- 现象：用 `eval('require')` 绕开打包器以在 standalone 运行时加载原生模块。能 work 但脆弱、绕过静态分析，升级 Next 时易踩坑。
- 建议：改用 Next 的 `serverExternalPackages`（next.config）声明外部原生包，去掉 `eval`。

### D3 [P2] `tsconfig` 关闭 `noImplicitAny`，弱化类型保障
- 位置：`tsconfig.json`（`"noImplicitAny": false`，`strict: true` 同时存在，前者覆盖后者部分效果）
- 现象：隐式 any 被放行，削弱了 strict 的价值（不过全库 `as any/: any` 仅 1 处，说明实际写得很克制）。
- 建议：评估开启 `noImplicitAny`，借当前“几乎无 any”的良好状态收口。

### D4 [P2] 超大文件，编排与逻辑边界可进一步下沉
- 位置：`src/lib/invoice-service.ts`（1570 行，14 个导出函数）、组件 `receipt-canvas.tsx` 666、`receipt-manager.tsx` 655、`customer-manager.tsx` 582、`order-tracker-manager.tsx` 551 等。
- 现象：变更清单要求“page/manager 仅做编排”，但部分 manager 组件已偏大；invoice-service 单文件聚合了导入/创建/改派/改单/转余额等多域逻辑。
- 建议：invoice-service 按子域（import / mutation / rematch / transfer）拆分；大 manager 抽出更多 hook/子组件。属技术债清理，非紧急。

### D5 [P3] 生产源码内 54 处 `console.*`
- 位置：`src/`（非测试）54 处，如 `upload-image/route.ts`、`auth.ts:69,98`。
- 现象：无结构化日志，敏感操作（密码迁移、admin 创建）直接 `console.log`，且无统一日志级别/脱敏。
- 建议：引入轻量 logger（级别、JSON、可关闭），密码迁移类日志去标识化。

### D6 [P3] 鉴权为逐路由 `withAuth` 包裹，无中间件兜底
- 位置：各 `route.ts`（已确认仅 `api/locale` 合理地无鉴权）。
- 现象：当前所有需鉴权路由都正确包了 `withAuth/withRole`，但缺少 `middleware.ts` 这类“默认拒绝”的兜底，新增路由若漏包即裸奔。
- 建议：加一个 middleware 做默认鉴权 + 显式 allowlist（login/init/health/locale），把“安全默认”从约定变成机制。

---

## 建议执行顺序（Roadmap）

1. **第一批（P0/安全速修）**：A1（密钥占位符 fail-fast）、A5（删 next-auth）、A4（弱口令策略）。改动小、风险低、收益高。
2. **第二批（P1/防患于未然）**：C2 + B3（Dashboard 聚合下推 SQL）、C1（订单匹配收窄候选）、A2/A3（限流健壮性）、D1（运行时版本统一）、B1（金额精度统一）。
3. **第三批（P2 优化与清理）**：C3/C4、B2、B4、D2/D3/D4。
4. **第四批（P3 收尾）**：D5（日志）、D6（中间件兜底）。

> 注：以上每项落地时请遵循 `CHANGE_CHECKLIST.md`（测试、README/todolist、版本号、备份范围、CI、本地重建）。涉及金额计算（B1）、匹配逻辑（C1）、鉴权（A1/D6）的改动属业务/安全核心，必须补 service 级与 isolated API 回归测试。
