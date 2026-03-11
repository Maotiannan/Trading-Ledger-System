# Trading-Ledger-System TODO List

> 收汇管理系统后续开发与运维清单  
> 当前版本：v1.0.62  
> 最后更新：2026-03-11

## P0（本周必须完成）

### 数据一致性与安全
- [x] 修复 `ORDER BALANCE` 口径（`RECEIVED` 也计入已收）✅ 2026-03-02
- [x] 修复删除收据后 `Detail.totalAmount` 未同步重算问题 ✅ 2026-03-02
- [x] 修复 SWIFT 重复创建返回 500 的问题（改为明确业务错误）✅ 2026-03-02
- [x] 系统探针接口最小权限化（health 登录可见，routes/config-template 仅管理员）✅ 2026-03-02
- [x] 修复 SWIFT 超限金额副作用（仅标记 SWIFT 错误，不再联动 DETAIL/RECEIPT 为 ERROR）✅ 2026-03-02
- [x] 支持错误 SWIFT 记录由创建者直接删除（无需管理员审批）✅ 2026-03-02
- [x] 删除申请防重复提交（同 targetType + targetId 仅允许存在一条申请）✅ 2026-03-02
- [x] 审批删除 DETAIL 时级联清理自动创建收据与空自动订单 ✅ 2026-03-02
- [x] 刷新匹配增加空订单清理（amount=0, orderBalance=0, 无收据）✅ 2026-03-02
- [x] 修复收据上传确认未匹配订单时自动创建 Un_Associated ORDER ✅ 2026-03-02
- [x] 修复 SALES 数据可见范围（收据/明细/SWIFT 经理可见）✅ 2026-03-02
- [x] 修复图片预览链路（统一通过 /api/upload-image 读取上传图片）✅ 2026-03-02
- [x] 引入层级权限字段（`level + parentId`）并完成历史回填 ✅ 2026-03-02
- [x] 用户管理改为仅可管理下级（同级可见不可管）✅ 2026-03-02
- [x] `findMatchingReceipt` 改为同客组严格匹配 + 容差配置化 ✅ 2026-03-02
- [x] `rematch` 支持冲突预览与 keep/merge 选择执行 ✅ 2026-03-02
- [x] 金额字段升级为 Decimal 并完成核心接口兼容 ✅ 2026-03-02
- [x] 用户管理创建流程支持上级账户选择（parentId）并按层级规则过滤 ✅ 2026-03-02
- [x] 修复 receipt/detail/swift 搜索条件覆盖可见性导致的越权读取风险 ✅ 2026-03-02
- [x] 补齐 invoice/customer 可见性并集校验（owner + customer owner） ✅ 2026-03-02
- [x] 收敛 rematch 冲突预览：同客组仅在存在未匹配收据时提示冲突 ✅ 2026-03-02
- [x] 设置页系统配置区块置底 ✅ 2026-03-02
- [x] 新增主管理员分支清库（密码确认 + 选择ADMIN分支，保留系统配置/用户）✅ 2026-03-02
- [x] 修复 customers 搜索框与 receipt/detail/swift 日期筛选的英文残留中文问题 ✅ 2026-03-02
- [x] rematch（预览/执行）按账号可见范围隔离，不再操作全库 ✅ 2026-03-02
- [x] 修复管理员删除用户 500：删除前自动重挂 createdBy 归属，避免外键冲突 ✅ 2026-03-03
- [x] 客户管理支持 `consignee` 可空、`credit=0`，并修复 consignee 长度超限导入失败 ✅ 2026-03-05
- [x] 账单新增 `SHIP_DATE` / `RELEASE_DATE`（创建+导入+列表展示） ✅ 2026-03-05
- [x] 组合 ORDER（如 `IB-31A/IB-32/IB-33B`）支持子订单匹配统一结算 ✅ 2026-03-05
- [x] 收据/付款明细 direct-create 默认日期改为服务器当日 ✅ 2026-03-05
- [x] i18n 补齐：客户占位文案、客户修复提示与 API 错误中译英映射增强 ✅ 2026-03-05
- [x] 客户归属隔离：新增 `ownerId` 绑定，`ADMIN` 全量可见，`SALES` 仅可见并维护自身绑定客户池 ✅ 2026-03-05
- [x] 客户唯一性规则调整：取消 `name` 全局唯一，改为同池 `ORDER_NAME/PHONE/COMPANY_NAME` 去重，跨池允许重复 ✅ 2026-03-05
- [x] 客户批量导入升级：逐行容错 + 同池自动 upsert（新增/更新/失败统计）✅ 2026-03-05
- [x] 客户管理 UI 补齐绑定账户字段（列表展示 + 创建/编辑/修复可选）✅ 2026-03-05
- [x] 客户模板新增 `SALES_EMAIL` 并支持行级绑定导入（无效邮箱按行失败不中断）✅ 2026-03-05
- [x] 账单导入支持 `CUSTOMER_MARK` 留空自动匹配（按 ORDER 客组 -> 客户库/历史订单）✅ 2026-03-05
- [x] 账单导入改为部分成功策略：可匹配行先导入，未匹配行逐条提示不中断 ✅ 2026-03-05
- [x] 账单导入问题行弹窗补录：支持编辑问题行并仅重试当前问题行（`POST /api/invoice action=import-rows`）✅ 2026-03-05
- [x] 客户导入问题行弹窗补录：冲突/错误行可编辑后重试，仅重试当前问题行（`POST /api/customer action=import-rows`）✅ 2026-03-05
- [x] 分支业务清库升级：管理员可选择任意账号 + 模块（账单/收据/明细/SWIFT/客户/全部）并按依赖级联删除 ✅ 2026-03-05
- [x] 客户导入命中规则调整：`PHONE` 或 `MARK+NAME` 命中更新；命中多条自动进入问题行 ✅ 2026-03-05
- [x] 客户导入更新收敛：仅覆盖空值/占位值字段，不覆盖已有有效字段 ✅ 2026-03-05
- [x] 账单列表支持直接编辑并保存 `SHIP_DATE/RELEASE_DATE`（支持置空）✅ 2026-03-05
- [x] 账单导入重复防护：同批次或库内重复 `ORDER_NO` 均按问题行拦截，不再隐式合并 ✅ 2026-03-05
- [x] 导入回执增强：账单返回 `importedOrderNos`，客户返回 `createdRows/updatedRows` 摘要 ✅ 2026-03-05
- [x] 导入问题行弹窗文本适配：长错误原因自动换行完整显示 ✅ 2026-03-05
- [x] 客户导入重复统计修复：仅实际变更计入“更新”，无变更行单独计数 ✅ 2026-03-05
- [x] 客户手机号规则放宽：同绑定池允许手机号重复，避免同手机号不同客户被拦截 ✅ 2026-03-05
- [x] 客户导入匹配策略优化：优先 `MARK+NAME`，其次 `PHONE(+同ORDER_NAME/占位)`，降低误更新 ✅ 2026-03-05
- [x] 账单空 MARK 识别增强：新增 `ORDER_NAME` 回退 + `MARK前缀` 二次判定 ✅ 2026-03-05
- [x] 账单空 MARK 识别规则收敛：按最右侧 `-` 提取 `ORDER_NAME` 匹配；缺少 `-` 返回“应该含‘-’的ORDER格式” ✅ 2026-03-05
- [x] 账单导入问题行弹窗宽度修复：列宽/输入宽度自适应，超宽表格横向滚动完整显示 ✅ 2026-03-05
- [x] Customer List 长文本展示优化：`CONSIGNEE/COMPANY_ADDRESS` 前 20 字 + 悬浮/点击查看全文 ✅ 2026-03-05
- [x] 客户导入重复更新修复补强：占位值（如 `-`）不再触发导入更新，重复导入不再反复计入 `updatedCount` ✅ 2026-03-05
- [ ] 增加请求体大小限制（Next.js + Caddy 双层，防 DoS）
- [ ] 对高风险写接口增加速率限制（登录、上传、删除审批）

### 自动化回归
- [x] 新增 `matching` 单测（余额计算关键口径）✅ 2026-03-02
- [x] 新增 `api-catalog` 一致性测试 ✅ 2026-03-02
- [x] 更新 API 冒烟脚本（补未登录鉴权检查）✅ 2026-03-02
- [x] 新增 `i18n:audit` 巡检脚本（扫描硬编码中文）✅ 2026-03-02
- [x] 新增 `customer` 归属/去重 API 自动化脚本（`scripts/test-customer-scope-api.sh`）✅ 2026-03-05
- [x] 导入与日期回归已完成（使用临时 API 脚本执行，脚本不入库）✅ 2026-03-05
- [x] 导入匹配与重复导入回归（API 自测）：最右 `-` 识别、格式错误提示、重复导入 `updatedCount=0` ✅ 2026-03-05
- [x] 导入结果弹窗重构：账单/客户导入均显示全部行状态（含成功），默认仅看最新失败并可切换全部 ✅ 2026-03-05
- [x] 导入重试历史列：每次重试保留历史并追加 `Result#N`，失败原因仅保留最新结果 ✅ 2026-03-05
- [x] 导入结果弹窗分页与窗口适配：近全屏（`100vw/100vh-10px`）+ 每页50行 ✅ 2026-03-05
- [x] 导入接口返回增强：`invoice/customer` 新增 `rowResults` 逐行状态输出 ✅ 2026-03-05
- [x] 客户导入取消自动更新：命中同池 `PHONE` 或 `MARK+NAME` 一律失败并返回已有客户详情 ✅ 2026-03-06
- [x] `invoice` 写接口迁入 `invoice-service + ApiError + runInTransaction`，账单路由收敛为薄路由 ✅ 2026-03-11
- [x] `invoice-write` 内部持久化继续事务化：整批坏数据不再留下半写入 invoice/order/orderAlias，提交后再做余额与 deposit 对账 ✅ 2026-03-11
- [x] 审计/错误目录继续统一：新增 `audit-catalog.ts` 与 `apiErrorCodes`，`deletion/settings/receipt/detail/swift/invoice` 统一切到常量目录 ✅ 2026-03-11
- [x] 系统配置更新审计补齐：记录前后值 + 操作人，敏感配置自动脱敏 ✅ 2026-03-11
- [x] `invoice-write` 单测补齐：覆盖“坏数据不进事务”和“成功提交后再对账”，并纳入局部 coverage 门禁 ✅ 2026-03-11
- [x] 前端 API 错误消费统一：workspace 共享 client 开始按 `code/detail/message` 解析，`invoice/customer/settings/receipt/detail/swift/users/dashboard` 不再直接依赖错误文案字符串 ✅ 2026-03-11
- [x] 设置页新增独立配置审计查询/展示：支持分页查看系统配置修改记录、操作人、更新时间与前后值 ✅ 2026-03-11
- [x] 覆盖率门禁第九轮上调：global 提升到 `47/73/67/66`，并同步提高 `use-settings-actions` 局部门禁 ✅ 2026-03-11
- [x] 统一剩余历史路由错误结构：`auth/customer/customer-fixes/report/upload-image/locale/init` 补齐 `code/message/detail`，清理裸字符串错误体 ✅ 2026-03-11
- [x] 前端错误消费继续收尾：登录页、账单导入、客户导入、用户管理切到错误码优先消费，移除遗留 `result.error || ...` 路径 ✅ 2026-03-11
- [x] 隔离 API 回归增加错误码断言：覆盖 `AUTH_REQUIRED / INVALID_CREDENTIALS / INVALID_ACTION / CUSTOMER_DUPLICATE / IMPORT_TEMPLATE_INVALID` ✅ 2026-03-11
- [x] 覆盖率门禁第十轮上调：global 提升到 `48/74/68/66`，并同步提高 `use-user-actions` 局部门禁 ✅ 2026-03-11
- [x] 客户新建/编辑重复校验补齐：手动路径不再绕过重复检测 ✅ 2026-03-06
- [x] 搜索框全字段化：账单/收据/付款明细/SWIFT/客户统一改为全字段文本搜索 ✅ 2026-03-06
- [x] 弹窗边距与可操作性修复：导入结果弹窗四边留5px；创建账单弹窗底部按钮固定可见 ✅ 2026-03-06
- [x] 新增 `text-search` 单测与 API/UI 自测 ✅ 2026-03-06
- [x] 修复源站 HTTPS 自循环风险：Caddy 兼容 Cloudflare 代理 HTTPS 头，不再对已由上游声明为 HTTPS 的请求重复 308 ✅ 2026-03-09
- [x] 修复源站 Host 不匹配导致的空白页：HTTP 入口改为全 Host 兜底反代，避免 `200` 空 body ✅ 2026-03-09
- [x] 前端保守拆分完成：`page.tsx` 抽出 API client、import-result hooks、登录/侧栏与各业务模块视图，`page.tsx` 收敛为鉴权+视图路由 ✅ 2026-03-09
- [x] 业务模块组件集落地：新增 `workspace/modules/{dashboard,invoices,receipts,details,swifts,deletions,customers,settings,users}` 与统一 barrel 出口 ✅ 2026-03-09
- [x] 前端独立路由落地：新增 `/dashboard`、`/invoices`、`/receipts`、`/details`、`/swifts`、`/deletions`、`/customers`、`/settings` 页面，侧栏切换改为基于 URL 导航 ✅ 2026-03-09
- [x] 根入口职责收敛：`/` 仅处理登录或登录后跳转，`/users` 统一重定向到 `/settings` ✅ 2026-03-09
- [x] 切模块体验修复：共享 `(workspace)` layout 持久化侧栏与鉴权，模块切换加载态仅作用于右侧主内容区 ✅ 2026-03-09
- [x] 侧边栏支持收缩为仅图标模式，并持久化收缩状态 ✅ 2026-03-09
- [x] 导入结果弹窗复用化：抽出 `ImportResultDialog` 与 `useImportResultTable`，发票/客户导入结果共用 ✅ 2026-03-09
- [x] 账单模块继续内聚拆分：创建账单/编辑订单/转移多付/付款记录/冲突匹配对话框抽离为独立组件，`invoice-manager.tsx` 继续瘦身 ✅ 2026-03-09
- [x] 账单列表区拆分：发票卡片列表、订单表格、行内加单表单抽离为 `invoice-list.tsx`，主模块进一步收敛为状态与动作编排 ✅ 2026-03-10
- [x] 账单模块副作用逻辑拆分：导入结果状态与客户候选查询抽为本地 hooks，`invoice-manager.tsx` 进一步收敛为页面编排层 ✅ 2026-03-10
- [x] 账单模块表单态拆分：创建账单、编辑订单、行内加单的本地状态与候选回填抽为 `use-invoice-order-forms`，主模块继续减重 ✅ 2026-03-10
- [x] 账单模块远程动作拆分：转移余额、冲突匹配、订单历史、账单日期编辑抽为 `use-invoice-tools`，主模块进一步收敛 ✅ 2026-03-10
- [x] 收据模块第一轮组件拆分：列表、上传对话框、直接创建对话框、图片预览对话框抽离，`receipt-manager.tsx` 显著减重 ✅ 2026-03-10
- [x] 收据模块本地表单与候选匹配拆分：OCR/直建客户候选查询、预览状态、打开关闭逻辑抽为 hooks，主模块继续减重 ✅ 2026-03-10
- [x] 收据模块远程动作拆分：OCR识别、确认创建、直接创建、签收、删除申请抽为 `use-receipt-actions`，主模块基本收敛为拼装层 ✅ 2026-03-10
- [x] 隔离 API 测试重构完成：`test-api-isolated.sh` 仅负责环境引导，API 回归拆分为 `tests/api/isolated/cases/*.case.mjs` 模块化 case ✅ 2026-03-10
- [x] 第一批 workspace hook/module 测试落地：`invoice/customer/settings` 关键 hooks 已纳入 Jest + RTL 自动化回归 ✅ 2026-03-10
- [x] 新增稳定 Playwright 闭环：登录导航、客户->账单创建、设置页渲染均已纳入隔离 E2E ✅ 2026-03-10
- [x] CI 门禁与覆盖率阈值上线：新增 GitHub Actions 流水线与 `npm run test:ci`，统一串联类型检查、lint、单测覆盖、隔离 API/E2E ✅ 2026-03-10
- [x] 修复根管理员初始化幂等与层级归一，避免 `/api/init` 并发或历史脏数据导致根账号层级错误 ✅ 2026-03-10
- [x] 修复 grouped order 合并后账单加单仍对旧 `orderId` 结算导致的潜在 500 ✅ 2026-03-10
- [x] 新增层级权限边界 API 回归：覆盖 1/2/3/4 级账号创建、同级可见不可管、旁支不可管理、下级可重置/删除 ✅ 2026-03-11
- [x] 新增删除审批 API 回归：覆盖 RECEIPT/DETAIL/SWIFT 申请、管理员审批、状态回退与自动对象级联清理 ✅ 2026-03-11
- [x] hook 分支测试继续补强：`use-invoice-actions`、`use-customer-actions`、`use-settings-actions` 新增失败/重试/成功路径自动化验证 ✅ 2026-03-11
- [x] 覆盖率门禁第二轮上调：global 与 `invoice/customer/settings` 关键 hook 阈值小步提升，不一次性全仓拉满 ✅ 2026-03-11
- [x] 修复 GitHub Actions `npm ci` lockfile 失配：通过 `npm overrides` 固定 transitive `@swc/helpers=0.5.19`，对齐 Node20/npm10 云端环境 ✅ 2026-03-11
- [x] 第二批模块 hook 测试落地：新增 `receipt/detail/swift/users` 四组动作 hook 自动化测试 ✅ 2026-03-11
- [x] 修复 GitHub Actions Jest 配置解析失败：`jest.config.ts` 改为 `jest.config.mjs`，移除 runner 对 `ts-node` 的隐式依赖 ✅ 2026-03-11
- [x] 第三批模块 hook 测试补齐：`receipt/detail/swift/users` 覆盖上传识别、确认创建、取消/异常分支、权限动作，Jest 扩展到 15 suites / 54 tests ✅ 2026-03-11
- [x] 覆盖率门禁第三轮上调：将 `receipt/detail/swift/users` 纳入 `collectCoverageFrom` 和 module thresholds，并将 global 提升到 `40/65/60/60` ✅ 2026-03-11
- [x] 修复 GitHub Actions isolated E2E 锁冲突：API/E2E 分别使用 `.next-api-isolated` 与 `.next-e2e-isolated`，不再共用 `.next/dev/lock` ✅ 2026-03-11
- [x] 清理错误测试产物来源：修正 `NEXT_DIST_DIR` 为相对路径，删除误生成的 `Users/...` 目录树，并将测试专用 distDir 纳入 `.gitignore`/`tsconfig.json` ✅ 2026-03-11
- [x] 增加业务链路集成测试（Receipt -> Detail -> Swift -> mark-received，含拒绝删除与签收后禁删）✅ 2026-03-11
- [x] 新增 SWIFT 金额容差 isolated API 边界回归：覆盖 `±5 / ±6 / ±50 / ±51`、错误 SWIFT 持久化与创建者直删 ✅ 2026-03-11
- [x] 覆盖率门禁第四轮上调：global 提升到 `42/68/62/62`，并同步提高 `invoice/customer/settings` 局部门禁 ✅ 2026-03-11
- [x] 升级 GitHub Actions `actions/checkout` / `actions/setup-node` 到 Node 24 兼容版本，消除 runner 退役告警 ✅ 2026-03-11
- [x] 删除审批模块测试补齐：新增 `use-deletion-actions` hook 测试与 `deletion-service` 单测，覆盖申请校验、审批/拒绝、事务回退与前端 reload 行为 ✅ 2026-03-11
- [x] 删除审批链路开始统一错误码与事务边界：`/api/deletion` 接入 `ApiError(code/message/detail)` 与 `runInTransaction`，并收口到 `deletion-service` ✅ 2026-03-11
- [x] 覆盖率门禁第五轮上调：将 deletion hook/service 纳入门禁，global 提升到 `43/69/63/63` ✅ 2026-03-11
- [x] `settings / receipt / detail / swift` 写接口迁到 `service + ApiError + runInTransaction`，统一路由层职责为“请求解析 + 识别 + 响应封装” ✅ 2026-03-11
- [x] `SWIFT_WARNING_TOLERANCE / SWIFT_REJECT_TOLERANCE` 配置化进 `/api/settings` 与设置页，并补 isolated API 回归验证配置更新后立即生效 ✅ 2026-03-11
- [x] 修复 `system-settings` 热缓存只缓存首批 key 的缺陷，避免设置更新后按不同 key 读取时错误回退默认值 ✅ 2026-03-11
- [x] 新增 `settings-service / receipt-service / detail-service / swift-service / system-settings` 单测，覆盖事务边界、结构化错误、状态回退、容差配置与缓存补齐 ✅ 2026-03-11
- [x] 覆盖率门禁第六轮上调：global 提升到 `44/70/64/64`，并将 `settings/receipt/detail/swift` service 纳入 coverage 门禁 ✅ 2026-03-11

## P1（两周内完成）

### 工程化与标准化
- [ ] 为核心写接口补事务边界审计（create/update/delete 全链路）
- [x] 统一 API 错误码与错误结构（`code/message/detail`），完成剩余前端字符串消费与旧路由改造 ✅ 2026-03-11
- [x] 将关键阈值配置化（如 SWIFT 容差 ±5/±50）并纳入 `/api/settings` ✅ 2026-03-11
- [x] 补充配置变更审计日志（记录配置前后值 + 操作人，敏感值脱敏）✅ 2026-03-11
- [ ] 多语言二期：将 API 中文报错改为错误码 + 服务端字典，前端按语言渲染（替代字符串映射）

### 测试覆盖
- [x] 覆盖 `deletion` 审批分支单测（RECEIPT/DETAIL/SWIFT 关键申请/审批/回退分支）✅ 2026-03-11
- [x] 覆盖 `swift` 金额容差分支单测（正常/警告/拒绝）✅ 2026-03-11
- [x] 增加 Playwright API 驱动用例（优先 API，不依赖手工 UI 点击）✅ 2026-03-10

## P2（持续迭代）

### 功能增强
- [ ] 通知系统（删除审批、异常金额、签收完成）
- [ ] 报表增强（按客户/时间维度聚合，支持 CSV）
- [ ] 客户信息修复模块支持批量处理
- [ ] 增加数据归档策略（历史数据只读、查询加速）

### 运维与监控
- [ ] 接入 Sentry（前后端异常聚合）
- [ ] 接入 Prometheus + Grafana（接口成功率、耗时、错误率）
- [ ] 制定备份与恢复演练（MariaDB 快照 + 上传目录备份）

### 文档与交付
- [ ] 补全 API 文档（可选 OpenAPI）
- [ ] 输出部署手册（开发/预发/生产）
- [ ] 输出故障排查手册（数据库连接、OCR失败、上传失败）
- [ ] 输出 i18n 规范（文案 Key 命名、目录分层、审计基线、提测门禁）

---

## 已完成里程碑摘要

- v1.0.58（2026-03-11）：`settings / receipt / detail / swift` 写接口继续迁到 `service + ApiError + runInTransaction`；新增 `SWIFT_WARNING_TOLERANCE / SWIFT_REJECT_TOLERANCE` 系统配置与设置页编辑，修复 `system-settings` 热缓存缺陷，并补齐 `settings-service / receipt-service / detail-service / swift-service / system-settings` 单测；isolated API 已验证设置修改后 SWIFT 容差立即生效，coverage threshold 第六轮提升到 `44/70/64/64`
- v1.0.59（2026-03-11）：`invoice` 写接口继续迁到 `invoice-service + ApiError + runInTransaction`，`/api/invoice` 路由收敛为薄路由；系统配置更新审计新增“前后值 + 操作人”记录并对敏感值脱敏；新增 `invoice-service` 单测与导入推断/冲突回归，coverage threshold 第七轮提升到 `45/71/65/65`
- v1.0.60（2026-03-11）：`invoice-write` 继续事务化，整批订单先校验再统一写入 invoice/order/orderAlias，并在提交后执行 grouped order consolidate、deposit 补挂与余额重算；新增 `audit-catalog.ts` 与 `apiErrorCodes`，把 `deletion/settings/receipt/detail/swift/invoice` 统一切到审计动作/目标类型与错误码常量目录；新增 `invoice-write` 单测并把 coverage threshold 第八轮提升到 `46/72/66/66`
- v1.0.61（2026-03-11）：前端 workspace 共享 API client 开始按 `code/detail/message` 统一消费错误，`invoice/customer/settings/receipt/detail/swift/users/dashboard` 这批模块不再直接依赖错误文案字符串；设置页新增独立配置审计查询/展示卡片；新增 `client.test.ts` 与更多 `use-settings-actions` 分支测试，coverage threshold 第九轮提升到 `47/73/67/66`
- v1.0.62（2026-03-11）：`auth/customer/customer-fixes/report/upload-image/locale/init` 这批历史路由统一补齐 `code/message/detail`；登录页、账单导入、客户导入、用户管理切到错误码优先消费；isolated API 新增错误码断言，coverage threshold 第十轮提升到 `48/74/68/66`
- v1.0.57（2026-03-11）：GitHub Actions 升级到 `actions/checkout@v5` / `actions/setup-node@v5`，消除 Node 24 兼容告警；删除审批链路抽出 `deletion-service + ApiError + runInTransaction`，并新增 deletion hook/service 单测，coverage threshold 第五轮提升到 `43/69/63/63`
- v1.0.56（2026-03-11）：新增 `Receipt -> Detail -> Swift -> mark-received` 生命周期集成测试与 SWIFT 容差边界 API 回归，补齐 `validateAmountTolerance` 单测，并将 coverage threshold 第四轮小步上调到 `42/68/62/62`；GitHub Actions run `22934138981` 最终通过
- v1.0.55（2026-03-11）：修复 GitHub Actions 中 isolated API 与 isolated E2E 共用 `.next/dev/lock` 导致的 `app not ready`；测试脚本改为独立 `distDir`，并收口 `NEXT_DIST_DIR` 的相对路径规则，避免再次生成仓库内 `Users/...` 编译产物
- v1.0.54（2026-03-11）：修复 GitHub Actions 对 `jest.config.ts` 的解析失败，将配置切换为 `jest.config.mjs`；第三批模块测试为 `receipt/detail/swift/users` 补齐上传识别、确认创建和异常/取消分支，Jest 扩展到 15 suites / 54 tests，并将这四组 hooks 纳入 coverage 门禁
- v1.0.53（2026-03-11）：修复 GitHub Actions `npm ci` 的 lockfile 失配；通过 `package.json#overrides` 固定 `@swc/helpers=0.5.19`，并新增 `receipt/detail/swift/users` 第二批 hook/module 测试，Jest 扩展到 15 suites / 36 tests
- v1.0.52（2026-03-11）：补齐第二批测试工程化；新增层级权限边界与删除审批链路的 isolated API case，继续为 `use-invoice-actions / use-customer-actions / use-settings-actions` 补分支测试，并将 coverage threshold 做第二轮小步上调
- v1.0.51（2026-03-10）：测试工程化收口；隔离 API 测试拆成环境引导 + 模块化 case 文件，新增 invoice/customer/settings 第一批 hook 测试、三条稳定 Playwright 隔离 E2E、GitHub Actions CI 与覆盖率阈值；同时修复 `/api/init` 根管理员层级归一和 `/api/invoice` grouped order 合并后的旧 `orderId` 结算风险
- v1.0.48（2026-03-10）：客户模块导入工作区继续拆分；顶部工具区抽为 `customer-toolbar`，导入问题行列定义抽为 `use-customer-import-columns`，`customer-manager.tsx` 从 347 行压缩到 236 行
- v1.0.49（2026-03-10）：用户管理模块完成首轮拆分；创建用户对话框、用户列表、本地表单态与远程动作拆到 `components/ + hooks/ + types.ts`，`user-manager.tsx` 收敛到页面编排层；README 补充前端模块拆分规则、共享能力边界与后续预留接口
- v1.0.50（2026-03-10）：账单模块新增 `use-invoice-view-state`，搜索词、展开状态、导入 input ref 与列表加载逻辑脱离 `invoice-manager.tsx`；主文件从 329 行压缩到 304 行；同时明确 `deletions / dashboard` 现阶段维持轻量模块，不为拆分而拆分
- v1.0.47（2026-03-10）：账单模块新增 `use-invoice-actions`，顶部工具区与搜索卡片抽为独立组件，创建/更新/删除/加单与模板下载逻辑脱离主组件，`invoice-manager.tsx` 从 533 行压缩到 329 行
- v1.0.46（2026-03-10）：设置模块完成首轮完整拆分；密码/分支清库/系统配置抽为独立组件，新增 `use-settings-forms` 与 `use-settings-actions`，`settings-manager.tsx` 从 479 行压缩到 139 行
- v1.0.45（2026-03-10）：SWIFT 模块完成首轮完整拆分；列表/上传/直建/图片预览抽为独立组件，新增 `use-swift-forms` 与 `use-swift-actions`，`swift-manager.tsx` 从 541 行压缩到 202 行
- v1.0.44（2026-03-10）：客户模块新增 `use-customer-forms` 与 `use-customer-actions`，创建/编辑/修复/导入/重试等状态与动作脱离主组件，`customer-manager.tsx` 从 558 行压缩到 347 行
- v1.0.43（2026-03-10）：客户模块开始组件化；列表、修复队列、创建/编辑弹窗、修复弹窗、长文本预览弹窗抽为独立组件，`customer-manager.tsx` 从 721 行压缩到 558 行
- v1.0.42（2026-03-10）：详情模块新增 `use-detail-forms` 与 `use-detail-actions`，上传/确认/直建/删除申请与图片预览状态脱离主组件，`detail-manager.tsx` 从 328 行压缩到 203 行
- v1.0.41（2026-03-10）：详情模块开始组件化；列表、上传、直接创建、图片预览抽为独立组件，`detail-manager.tsx` 从 549 行压缩到 328 行
- v1.0.40（2026-03-10）：收据模块新增 `use-receipt-actions`，OCR/确认创建/直接创建/签收/删除申请等网络动作脱离主组件，`receipt-manager.tsx` 从 397 行压缩到 257 行
- v1.0.39（2026-03-10）：收据模块新增 `use-receipt-customer-lookup` 与 `use-receipt-forms`，OCR/直建表单态与候选匹配脱离主组件，`receipt-manager.tsx` 从 529 行压缩到 397 行
- v1.0.38（2026-03-10）：收据模块开始组件化；列表、上传、直接创建、图片预览抽为独立组件，`receipt-manager.tsx` 从 797 行压缩到 529 行
- v1.0.37（2026-03-10）：账单模块新增 `use-invoice-tools`，转移余额/冲突匹配/订单历史/账单日期编辑等远程动作脱离主组件，`invoice-manager.tsx` 从 711 行压缩到 533 行
- v1.0.36（2026-03-10）：账单模块新增 `use-invoice-order-forms`，创建/编辑/加单表单态与候选回填脱离主组件，`invoice-manager.tsx` 从 901 行压缩到 711 行
- v1.0.35（2026-03-10）：账单模块抽出 `use-invoice-import` 与 `use-invoice-customer-lookup`，导入状态机与客户候选查询脱离主组件，`invoice-manager.tsx` 从 1112 行压缩到 901 行
- v1.0.34（2026-03-10）：账单列表区继续拆分；`invoice-list.tsx` 承接发票卡片列表、订单表格与行内加单表单，`invoice-manager.tsx` 从 1339 行压缩到 1112 行
- v1.0.33（2026-03-09）：账单模块内进一步拆分；五个大对话框抽为独立组件，新增 invoices/types.ts 收口本模块类型，`invoice-manager.tsx` 从 1608 行压缩到 1339 行
- v1.0.32（2026-03-09）：侧边栏支持收缩为仅图标并持久化；发票/客户导入结果弹窗与分页筛选逻辑抽为通用组件/hook，继续推进模块内部拆分
- v1.0.31（2026-03-09）：workspace 路由切换体验优化；共享 `(workspace)` layout 持久化侧栏，切模块时不再整屏白屏重挂，只在主内容区显示加载态
- v1.0.30（2026-03-09）：前端完成第二阶段真路由拆分；各业务模块拥有独立 app route，侧栏改为路径驱动导航，根 `/` 收敛为登录/跳转入口
- v1.0.29（2026-03-09）：前端完成第一阶段保守拆分；`page.tsx` 从 5359 行收敛到 93 行，API client / import hooks / 业务模块视图与 barrel 出口落地，为后续真路由拆分做准备
- v1.0.28（2026-03-09）：修复 Caddy 在 Cloudflare 反代下的 HTTPS 自循环；增加 HTTP 全 Host 兜底反代，修复 `CADDY_HOST` 缺失/不匹配时的空白页（`200` 空 body）
- v1.0.27（2026-03-06）：客户导入取消自动更新并显示重复客户详情；手动新建/编辑补齐重复校验；账单/收据/付款明细/SWIFT/客户统一改为全字段搜索；导入结果弹窗改为真正四边5px；创建账单弹窗改为内容滚动+底部按钮固定
- v1.0.26（2026-03-05）：导入结果弹窗重构（显示成功+失败全量行、默认失败筛选、Result#N 历史列、仅失败可编辑重试、分页50、近全屏适配）；`invoice/customer` 导入接口新增 `rowResults` 并完成 API 回归
- v1.0.25（2026-03-05）：账单空 MARK 自动识别改为“最右 `-` 提取 ORDER_NAME”并补齐格式错误提示；问题行弹窗列宽自适应；Customer List 长文本截断+全文查看；客户重复导入占位值不再重复计为更新；API 回归通过
- v1.0.24（2026-03-05）：修复客户导入重复更新计数；同池手机号重复兼容；客户导入匹配优先级优化；账单空 MARK 的 ORDER_NAME 回退识别增强
- v1.0.23（2026-03-05）：客户导入改为 PHONE 或 MARK+NAME 命中更新并增加多命中冲突拦截；更新仅填空字段；账单列表支持编辑 SHIP/RELEASE 日期；导入成功摘要与问题行弹窗可读性增强；导入/日期 API 回归完成
- v1.0.22（2026-03-05）：账单/客户批量导入新增问题行编辑重试闭环（仅重试问题行）；设置页分支清库支持任意账号+模块选择并按依赖级联删除
- v1.0.21（2026-03-05）：账单导入允许空 CUSTOMER_MARK 自动匹配；未匹配行不阻断整批导入；前端成功态展示失败明细
- v1.0.20（2026-03-05）：客户绑定账户字段前端可视化补齐；客户导入模板新增 SALES_EMAIL；新增 owner-options 接口与导入“默认绑定 + 行级绑定”双通道
- v1.0.19（2026-03-05）：Customer 引入 owner 绑定隔离；取消 name 唯一并改为同池 ORDER_NAME/PHONE/COMPANY_NAME 去重；批量导入改为逐行容错 upsert；新增 customer scope API 自动化脚本
- v1.0.18（2026-03-05）：客户导入/新建规则修复（consignee 可空、credit=0、长文本支持），INV 新增 SHIP/RELEASE 日期，组合 ORDER 子单号匹配统一结算，direct-create 默认服务器日期
- v1.0.17（2026-03-03）：修复删除用户外键冲突（createdBy 重挂后再删除），消除 `/api/auth` 删除 500
- v1.0.16（2026-03-02）：rematch 仅在当前账号可见范围执行，避免跨账号影响
- v1.0.15（2026-03-02）：修复 customers 搜索框与 receipt/detail/swift 日期筛选的 i18n 残留中文
- v1.0.14（2026-03-02）：设置页布局调整，新增主管理员分支清库能力（保留系统配置与用户）
- v1.0.13（2026-03-02）：rematch 同客组冲突预览收敛，避免不同订单被误判冲突
- v1.0.12（2026-03-02）：用户管理 parent 选择落地、查询可见性防越权修复、invoice/customer 可见性并集收口
- v1.0.11（2026-03-02）：层级权限模型落地、rematch 冲突处理升级、匹配规则收敛、金额 Decimal 化
- v1.0.10（2026-03-02）：刷新匹配空订单治理、收据自动建单修复、SALES 可见性修复、上传图片读取接口上线、用户管理并入设置
- v1.0.9（2026-03-02）：删除申请防重、DETAIL 删除级联清理自动收据与自动订单、订单余额一致性修复
- v1.0.8（2026-03-02）：销售权限链路修复、SWIFT 错误处理与删除策略优化、SWIFT 图片预览补齐
- v1.0.7（2026-03-02）：主页面多语言覆盖扩展、i18n 工作区封装、i18n 巡检脚本上线
- v1.0.6（2026-03-02）：一致性修复、系统探针鉴权收紧、自动化回归增强
- v1.0.5（2026-02-28）：MariaDB/MySQL 迁移、批量导入、业务清库能力
- v1.0.4（2026-02-27）：权限模型与输入校验加固、上传安全增强
- v1.0.3（2026-02-26）：鉴权封装、匹配算法升级、报表导出、多语言与高级搜索
- v1.0.2（2026-02-26）：会话签名 Cookie、初始化接口收敛、上传安全与仓库安全
- v1.0.1（2026-02-24）：密码哈希升级到 bcrypt（含旧密码迁移）

## 维护规则

- 每次版本更新必须同步更新 `README.md` 与本文件。
- 新需求先判断是否需要配置化，能配置的优先进入系统设置。
- 需要人工验证的流程优先封装成 API 脚本或自动化用例再交付。
