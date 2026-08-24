# Trading-Ledger-System Engineering Log

> 纯工程内部流水与技术变更记录  
> 当前版本：v1.0.211
> 最后更新：2026-08-24

> 说明：本文件保留详细技术流水、测试门禁、模块拆分、服务分层、CI 与基础设施调整。用户可读的里程碑与后续计划请看 `todolist.md`。

## P0（本周必须完成）

- [x] Dashboard 客户详情、MU Contract 来源恢复与系统池订单对账：新增共享 Dashboard 实时欠款快照，Customer Outstanding Ranking 与 Customer Order & Payment History 统一使用同一个客户详情弹窗，上方展示 Released/In Transit 欠款，下方复用 Historical Orders/Recent Receipts；MU Contract 新 PI 可接替同 ORDER NO 的 inactive 来源，active 来源仍冲突，旧 PI 重新激活不能抢回，并在事务提交后记录不含客户隐私的结构化接替日志；发票手工创建与批量导入统一把匹配的 `DEPOSIT_POOL / Un_Associated` 原 Order 事务迁入正式 INV，或在正式 INV 已有同单时只搬收据、不重复累计池金额，同时同步 Receipt 的 INV/ORDER/客户快照并重算余额。Rematch 新增 ADMIN 可见范围内的系统池预览：唯一正式目标自动修复，无法唯一确定且金额大于 0 的候选必须明确选择正式 INV，支持事务、审计、重复提交幂等和手机安全弹窗。功能提交：`7ed6f11`、`8c69db2`、`835ea49`、`0bd7ebb`、`6601adb`、`fd59216`。验证通过需求定向 17 suites / 126 tests、全量 181 suites / 1180 tests、typecheck、全仓 ESLint、路由权限与数据安全回归；`origin/main` 已通过 Clash SG2 同步确认未前进。`npm audit --omit=dev` 在 2026-08-24 新公告基线下报告 8 项（1 moderate / 7 high），完整修复涉及 Next/Prisma/sharp 越界或破坏性升级，未混入本业务分支。无 Prisma schema、迁移、Docker、数据库、NAS/COS 或备份范围变化；MySQL 完整快照仍覆盖全部相关数据，未执行真实 Rematch、未重建现有服务、未触碰业务数据。✅ 2026-08-24

- [x] MULEDGER NAS-only 备份与 MU Contract Orders 正式上线：PR #22 和合并后 main CI 均通过；每日 `02:30` 原子快照、二次校验和成功后 30 天保留已启用，腾讯 COS 新上传与本地凭据已停用，历史远端对象保留。正式快照 `muledger-20260719-181820` 在无生产卷的隔离 MariaDB 10.6 中完成恢复与迁移演练，29 -> 34 张表、25 -> 26 个迁移，6 张保护表迁移前后聚合指纹一致，405 个媒体文件及 PNG/JPEG/PDF 样本通过。生产安全部署到 v1.0.210 后，MU Contract 53 条 PI 完成首次对账：40 条挂接人工 Orders、13 条新建、10 条本地独有记录保持不动、0 未匹配、0 冲突；通过 Settings API 启用增量同步，显式 `sync-now` 返回 processed 0 / cursor 106，启用前后 Orders 与五张财务表完整指纹不变。最终快照 `muledger-20260719-193956` 再次校验通过；完整证据见 `docs/backup/restore-drills/2026-07-19-muledger-nas-local-backup-rollout.md`。✅ 2026-07-19

- [x] MULEDGER PR #21 审查修复：补齐同一隐藏 PI ID 对人工挂接 Orders 的改名路径，来源 ORDER NO 变更时仅更新订单号、标准化键与搜索 token，保留客户和全部人工字段；目标订单号冲突时不覆盖并记录 `ORDER_NO_COLLISION`。同时给 ADMIN 的同步订单客户解决接口补上服务端层级可见范围校验，防止绕过前端选择其他分支客户。新增 3 个单元回归场景并扩展 isolated API case 95；相关 20 suites / 197 tests、全量 174 suites / 1142 tests、隔离 API、typecheck、全仓 ESLint、Prisma validate、i18n audit 和 `git diff --check` 均通过。隔离测试只使用一次性 MariaDB 与假来源服务并已清理；未连接生产数据库、未运行生产迁移、未重建现有服务、未访问 NAS/COS。✅ 2026-07-18

- [x] MU Contract -> MULEDGER 实用版收口：放弃未提交的额外并发/审计扩张，从已提交同步基线重新核对双仓库真实接口。MULEDGER 共享 JSON Schema 与 MU Contract 源文件恢复逐字节一致（SHA-256 `45bfaaa9e6ae4f13c1c45a7aaab034cfbad6e1305204e4130178dcb3e482941b`），快照分页改为原样续传来源签发的最长 256 字符不透明游标，稳定 PI ID 不再被静默裁剪，并统一严格 UTC 日期及正式金额格式。验证通过同步聚焦 16 suites / 133 tests、全量 174 suites / 1139 tests、isolated API case 95、typecheck、ESLint、Prisma validate、Webpack build、i18n audit 和两类 0 漏洞审计。COS `2026-07-18 02:30:05` 备份在无挂载隔离 MariaDB 10.6 中完成迁移演练：23 张保护表逐行总哈希迁移前后相同、414 个媒体文件一致、5 张同步表正常创建、第二次迁移无待执行项、34 张表检查全部通过。未重建或连接现有应用/数据库/NAS/COS，版本更新为 `1.0.209`。✅ 2026-07-18

- [x] MU Contract Orders review-fix wave：Full Reconcile 预览改为完整规范化快照、高水位、汇总和本地目标状态的确定性指纹，apply 在任何写入前重读一次完整稳定分页并核对同一高水位、PI 顺序/唯一性、来源内容和本地目标，之后只分块应用已验证的内存快照并保留 PI 游标续传；可识别坏事件改为安全 `INVALID_SOURCE_DATA` 冲突 + 收据 + 游标同事务提交，原始业务值不落库且后续有效事件继续；人工挂接行不再重试覆盖客户，归档转移释放标准化业务键，人工编辑标记覆盖停用来源。新增仅 ADMIN 可用的未匹配/冲突同步 Orders 客户解决事务和 before/after 审计；增量/对账失败与完成状态均绑定同一租约 owner，接管后旧 worker 无法覆盖，管理动作竞争返回可读 409 且保留预览。v1 契约补齐 bigint 游标、int 版本和 decimal(18,2) 业务上限；isolated case 95 改为五张财务表完整行 SHA-256，并增加坏事件续传与客户解决 API 证据。最终门禁通过 174 suites / 1133 tests、typecheck、全仓 ESLint、Prisma validate、isolated API case 95、Webpack 生产构建、验证专用密钥 Compose config、i18n audit、完整及生产依赖 0 漏洞审计和 `git diff --check`。无新表、迁移、Docker volume、NAS/COS 路径或备份范围变化，版本保持 `1.0.208`。✅ 2026-07-18

- [x] MU Contract PI -> MULEDGER Orders 双系统同步分支实现：以隐藏 PI ID 为稳定身份、标准化 ORDER NO 为业务键，新增版本化 JSON Schema、15 秒/最多三次/2 MiB 上限的只读客户端、120 秒可续租、事务化事件应用/幂等收据/游标、15 分钟 Full Reconcile 预览、人工订单优先和冲突证据；只写 `OrderTracker` 与五张新增集成表，不写财务订单、发票、收据、Detail、SWIFT、余额或媒体。Orders 增加 PI 创建日期/正式金额，Settings 增加 ADMIN 同步控制，Docker 增加仅持内部维护令牌的轻量触发器。新增迁移为纯增量，完整 `trading_ledger` dump 已覆盖新表且无新增 NAS/COS 路径。门禁通过 Prisma validate、typecheck、全仓 ESLint、174 suites / 1102 tests、isolated API case 95、Webpack 生产构建、Compose 配置校验以及完整/生产依赖 0 漏洞审计；case 95 证明 39 条仅挂接、14 条新建、10 条人工保留、事件重放幂等、游标续传且财务表计数零变化。正式部署仍需双仓库 PR 审查、最新备份的隔离恢复试迁移和明确批准。✅ 2026-07-18

- [x] 恢复演练缺失媒体收口：只读追溯确认 `/upload/images/details/ocr/1779001460754_u71fgf.jpg` 由 SALES 账号 Pikin 于 2026-05-17 上传，原文件名为 `IMG_20260517_061920.jpg`，同时被 `0001001 / PETROUM-02` 与 `0001004 / YD-01` 引用；NAS、COS 当前对象、COS 历史版本、Mac 与微信本地目录均无副本，上传人也无法从源设备找回。经用户明确确认，两张收据保留为无图片记录；执行前保存权限为 `0600` 的行级回滚快照，随后在单个数据库事务中仅清空两条当前 `Receipt.imageUrl / imageName`，并为两条记录分别写入包含 before/after 的 `RECEIPT_UPDATE` 审计。金额、状态、订单、发票号、Payment Detail、历史版本和 NAS 文件均未修改；事务后确认当前失效路径引用数为 0。随后创建并上传数据库恢复点 `trading_ledger-20260717-170009.sql.gz`，gzip 与 SHA-256 校验通过；该备份在无端口、无生产卷的临时 MariaDB 10.6 中恢复后，两张收据图片字段均为 `NULL`、金额和状态保持不变、失效路径引用数为 0、审计记录数为 2，临时容器已清理。✅ 2026-07-17

- [x] COS 真实恢复演练与历史计划状态收口：关闭并删除已被主线替代的旧草稿 PR #1；新增历史计划状态索引，28 份计划标记为已完成归档、1 份整张收据编辑器计划标记为被最终 `No/Date/Tél` 方案替代。恢复演练从 COS 下载 2026-07-17 数据库、校验文件、manifest 和完整媒体，在无主机端口、无生产卷的独立 MariaDB 10.6 + 应用容器中恢复；SHA-256、gzip、29 张表 `mariadb-check`、25 条 migration、管理员登录、客户/发票/收据/Detail/SWIFT/Dashboard/客户分析 API、PNG/JPG/PDF 预览均通过。演练状态为 `PASS_WITH_FINDINGS`：265 个有效媒体引用中 264 个可恢复，缺失图片影响 `0001001 / PETROUM-02` 与 `0001004 / YD-01`，且源 NAS 与 COS 历史版本均无副本；另发现 7 个 `.smbdelete*` 临时文件和旧 `0001031` 签名会话孤儿元数据。生产数据库、NAS、运行容器和端口均未触碰。✅ 2026-07-17

- [x] 依赖安全修复第六批 D：最后四项均由开发工具链引入，现有父依赖范围允许同大版本安全更新；`@babel/core 7.29.0 → 7.29.7` 并同步其 7.x 官方组件，`flatted 3.3.3 → 3.4.2`，`js-yaml 3.14.2 / 4.1.1 → 3.15.0 / 4.3.0`，`ws 8.19.0 → 8.21.1`。不升级 Jest、ESLint、JSDOM 主版本，不增加强制 override。完整 `npm audit` 从 4 项降至 0 项，`npm audit --omit=dev` 保持 0 项，两种审计均以退出码 0 通过；完整 `test:ci` 通过 typecheck、ESLint、全量 160 suites / 1018 tests、isolated API 20 cases、isolated Playwright 9/9，Webpack 生产构建和 i18n audit 通过。PR #17 与合并后的 main CI 均通过，主线提交为 `176407c`；本地首次重建因 Docker Hub 获取 `node:22-alpine` 令牌时返回临时 `EOF`，旧服务和数据未受影响，第二次使用同一安全脚本成功完成。运行容器版本 `1.0.207`，25 个迁移无待执行，本地首页 `200`、未登录健康接口 `401`、公网首页 `200`，app / maintenance / Caddy 重启次数均为 0。无业务代码、数据库、Docker volume 或 NAS/COS 路径变更。✅ 2026-07-16

- [x] 依赖安全修复第六批 C：现有父依赖范围直接允许安全补丁，不增加 override，将 1.x / 2.x / 5.x 的 `brace-expansion` 分别更新到 `1.1.16 / 2.1.2 / 5.0.7`，将 2.x / 4.x 的 `picomatch` 更新到 `2.3.2 / 4.0.5`；不升级 ExcelJS、Next Intl、Parcel Watcher、Jest 或 ESLint。`npm audit` 从 6 项降至 4 项，`npm audit --omit=dev` 从 2 项降至 0 项，生产依赖审计首次清零。完整 `test:ci` 通过 typecheck、ESLint、全量 160 suites / 1018 tests、isolated API 20 cases、isolated Playwright 9/9，Webpack 生产构建和 i18n audit 通过。无业务代码、数据库、Docker volume 或 NAS/COS 路径变更。✅ 2026-07-16

- [x] 依赖安全修复第六批 B：Recharts 2.15.4 的现有 `lodash ^4.17.21` 范围允许安全版，因此不升级图表库、不增加强制 override，仅将锁文件中的 `lodash 4.17.23 → 4.18.1`。只变化 1 个包，`npm audit` 从 7 项降至 6 项、生产依赖从 3 项降至 2 项。完整 `test:ci` 通过 typecheck、ESLint、全量 160 suites / 1018 tests、isolated API 20 cases、isolated Playwright 9/9，Webpack 生产构建和 i18n audit 通过。无业务代码、数据库、Docker volume 或 NAS/COS 路径变更。✅ 2026-07-16

- [x] 依赖安全修复第六批 A：全仓检索确认 `@reactuses/core` 只存在于依赖清单和旧 Bun 锁文件，源码、页面、测试均无引用；移除该包及其 5 个专属子依赖，连带清除 `js-cookie / lodash-es` 两条生产漏洞链。`npm audit` 从 9 项降至 7 项、生产依赖从 5 项降至 3 项。完整 `test:ci` 通过 typecheck、ESLint、全量 160 suites / 1018 tests、isolated API 20 cases、isolated Playwright 9/9，Webpack 生产构建和 i18n audit 通过。无业务代码、数据库、Docker volume 或 NAS/COS 路径变更。✅ 2026-07-16

- [x] 依赖安全修复第五批：确认源码不直接使用顶层 `uuid` 后移除其声明；ExcelJS 4.4.0 仍为最新版且内部固定旧依赖，因此使用限定在 `exceljs` 子树的 npm override，把 `uuid 8.3.2 → 11.1.1`、`tmp 0.2.5 → 0.2.7`，不影响其他包。真实内存工作簿写入/读取往返通过；完整 `test:ci` 通过 typecheck、ESLint、全量 160 suites / 1018 tests、isolated API 20 cases、isolated Playwright 9/9，Webpack 生产构建和 i18n audit 通过。`npm audit` 从 12 项降至 9 项，生产依赖从 8 项降至 5 项。无业务代码、数据库、Docker volume 或 NAS/COS 路径变更。✅ 2026-07-16

- [x] 依赖安全修复第四批 B：全仓检索确认 `react-syntax-highlighter` 只存在于依赖清单和旧 Bun 锁文件，源码、页面和测试均无引用；删除该依赖及 25 个未使用子依赖，连带清除 `prismjs / refractor` 漏洞链。`npm audit` 从 15 项降至 12 项、生产依赖从 11 项降至 8 项。验证：完整 `test:ci`（typecheck、ESLint、全量 Jest coverage、isolated API 20 cases、isolated Playwright 9/9）、Webpack 生产构建和 i18n audit。未修改 UI、业务代码、数据库或持久化路径。✅ 2026-07-16

- [x] 依赖安全修复第四批 A：全仓检索确认 `@mdxeditor/editor` 只存在于 `package.json / bun.lock` 依赖记录，源码、页面和测试均无引用；选择删除而不是承担无业务收益的 3.x → 4.x 大版本升级。npm 共移除 148 个未使用子依赖，`npm audit` 从 16 项降至 15 项、生产依赖从 13 项降至 11 项。验证：typecheck、ESLint、i18n audit、全量 160 suites / 1018 tests、Webpack 生产构建、isolated API 20 cases、isolated Playwright 9/9。未修改 UI、业务代码、数据库或持久化路径。✅ 2026-07-16

- [x] 依赖安全修复第三批：`prisma / @prisma/client` 从 `6.19.2` 同步升至同大版本安全补丁 `6.19.3`，连带更新 `@prisma/config`、`effect`、`defu` 等官方子依赖；`npm audit` 从 20 项降至 16 项、生产依赖从 17 项降至 13 项。Prisma CLI 保持原有运行依赖位置，避免未来省略开发依赖安装时影响启动迁移检查；`prisma generate / validate` 通过，`prisma/schema.prisma` 与全部 25 个迁移目录无差异。验证：typecheck、ESLint、i18n audit、全量 160 suites / 1018 tests、Webpack 生产构建、isolated API 20 cases、isolated Playwright 9/9。无数据库结构、MySQL 数据、Docker volume 或 NAS/COS 变更。✅ 2026-07-16

- [x] 依赖安全修复第二批：`next-intl / use-intl / icu-minify` 从 `4.8.3` 升至 `4.13.2`，同时更新其官方 FormatJS 解析子依赖，消除国际化开放重定向、翻译目录原型污染及 ICU 处理公告。`npm audit` 从 22 项降至 20 项、生产依赖从 19 项降至 17 项；不修改现有中英文文案、语言偏好、路由或业务逻辑。验证：国际化/登录/导航定向 6 suites / 26 tests、typecheck、ESLint、i18n audit、全量 160 suites / 1018 tests、Webpack 生产构建、isolated API 20 cases（含 locale update）、isolated Playwright 9/9。无 Prisma schema、迁移、MySQL、Docker volume 或 NAS/COS 变更。✅ 2026-07-16

- [x] 依赖安全修复第一批：`next / eslint-config-next` 从 `16.1.6` 升至 `16.2.10`，清除 Next.js 请求走私、DoS、CSRF 绕过、缓存污染、XSS、SSRF 等已公开版本公告；Next 内置与 Tailwind 使用的 PostCSS 统一覆盖到同大版本安全补丁 `8.5.19`。升级后隔离 E2E 首轮准确拦截了 Next 16.2 开发资源来源收紧问题，根因是测试浏览器使用 `127.0.0.1` 而开发服务器默认只认可自身主机名；`allowedDevOrigins` 仅增加本机回环地址后 9/9 通过，生产来源策略不变。`npm audit` 从 24 项降至 22 项、生产依赖从 21 项降至 19 项。验证：typecheck、ESLint、i18n audit、全量 160 suites / 1018 tests、Webpack 生产构建、isolated API 20 cases、isolated Playwright 9/9。无业务代码、Prisma schema、迁移、MySQL 数据、Docker volume 或 NAS/COS 路径变更。✅ 2026-07-16

- [x] Dashboard 客户分析排行精简：移除重复的 `Customer` 表头与客户名称单元格，保留整行鼠标/键盘打开明细、排名、MARK、当前指标、标签切换、排序、分页和后端统计逻辑；空状态列数同步为三列。无数据库、NAS/COS 路径或备份范围变更。验证：Dashboard 定向 5 suites / 30 tests、全量 160 suites / 1018 tests、typecheck、ESLint、Webpack 生产构建和 i18n audit 均通过 ✅ 2026-07-16

- [x] Dashboard 客户分析明细关闭崩溃修复：真实浏览器复现 `Application error: a client-side exception has occurred`，定位为非年度明细关闭动画期间，父组件把空选择回退为 `annual-amount`，子组件仍短暂持有上一份 `payment-capacity/payment-cycle` 响应，导致把错误数据结构传给年度表格并在 `detail.orders.map` 处抛出未捕获异常。明细弹窗现在只渲染与当前 `metric + customerId` 完全一致的响应，关闭时同步失效在途请求并清空响应、错误和 loading 状态。新增受控关闭 Harness 回归，修复前稳定复现同一 TypeError，修复后通过。无数据库、NAS/COS 路径或备份范围变更 ✅ 2026-07-15

- [x] Dashboard 客户分析：新增后端纯计算域 `customer-analytics`，统一负责几内亚自然年/完整月份窗口、金额聚合、付款分配、金额加权付款周期和风险分级；年度下单金额只使用 `Invoice.releaseDate`，付款能力按最近 N 个完整自然月（含零付款月）计算，付款周期同时解释已付和未付金额的等待时间，正式收据只排除 `SIGNING_PENDING`。`customer-analytics-service` 按现有管理树权限一次性批量读取客户、订单和收据，排行与三类明细共享同一计算结果，不在 React 重算、不新增排行表或持久化缓存。新增 `/api/dashboard/customer-analytics` 排行/明细动作、三标签 Dashboard 卡片、10 行固定分页、键盘/手机可用的规则和风险说明、按指标懒加载的响应式证据弹窗；卡片登记进账号级 Dashboard 显示/排序配置。七项全局规则复用 `SystemSetting`、ADMIN 权限、事务校验和配置审计，非法或逆序阈值不会部分写入。备份范围不变：规则随 MySQL `trading_ledger` dump 保存，无新增 NAS/COS 路径；恢复验收新增规则值和三类排行 API。门禁：定向 14 suites / 143 tests、全量 160 suites / 1006 tests、isolated API 36 的 52 条业务断言、isolated Playwright 9 tests、typecheck、ESLint、生产构建和 i18n audit 均通过 ✅ 2026-07-15

- [x] Dashboard 客户分析独立审查加固：年度默认年份改由服务端 `Africa/Conakry` 时钟决定，浏览器首次请求不再自行推断年份；明细请求只接受排行输出的标准 UTC `asOf`，并在点击排行时一次性冻结行、年份、时间点和生效规则，刷新提示只比较指标值与规则，避免请求时间不同或后台排行刷新导致误报。七项客户分析规则改为整组提交、仅在实际变化时整组校验、事务保存，服务端只写入真正变化的配置，历史异常规则不再阻塞 OCR 等无关设置；结构化统计日志移除金额字段，API 仍返回该金额并在帮助说明中明确展示排除影响。无数据库迁移、无新增持久化路径、备份范围不变。验证：定向 5 suites / 91 tests、全量 160 suites / 1016 tests、isolated API case 36（含标准时间点复用与非法时间拒绝）、isolated Playwright 9/9、typecheck、全仓 ESLint、Webpack 生产构建和 i18n audit 均通过；临时测试容器及卷已清理，生产应用和维护容器保持 `restart=0` ✅ 2026-07-15

- [x] Next 16 worktree 构建兼容：确认 Turbopack 会拒绝隔离 worktree 中指向主仓库的 `node_modules` 软链接；API/E2E 隔离启动和正式 `npm run build` 显式固定为官方 Webpack 模式，避免 agent 在 worktree 内出现与业务代码无关的 panic。临时 MariaDB project/volume 均由清理钩子销毁，现有业务容器未重启，MySQL/NAS 未触碰；Webpack 生产构建和两类隔离测试已通过 ✅ 2026-07-15

- [x] GitHub Actions E2E 路由等待稳定性：CI 首轮中登录 API 与 `/dashboard` 均成功，但开发模式页面切换超过 Playwright 默认 5 秒，导致登录 URL 误报；将登录等待放宽后，第二轮又在 Dashboard → Invoice 的同类 5 秒断言处失败，证明问题属于全局路由等待而非登录业务。Playwright 统一设置条件断言最多 15 秒、单条用例最多 60 秒，到达目标即继续，不增加固定休眠、不修改产品逻辑；本地隔离曾复现首条导航耗时 10.1 秒，isolated Playwright 9/9 通过 ✅ 2026-07-15

- [x] Orders 确认日期持久化：`OrderTracker` 新增可空 `confirmedAt`，迁移对当前 `Confirmed` 历史记录使用 `updatedAt` 做一次性近似回填；后续由服务端统一执行“进入 Confirmed 记录当前时间、离开 Confirmed 清空、无状态变化或仅改备注时保持”的规则，并与状态在同一次 Prisma 写入中提交。Orders 表格在 `DEPOSIT` 右侧新增 `CONFIRMED DATE`，复用 `Africa/Conakry` 全局时区显示 `DD/MM/YYYY`。状态审计增加前后状态与确认时间。字段位于现有 MySQL `trading_ledger`，无新增 NAS/COS 路径；部署前创建数据库备份。测试：确认时间内核、OrderTracker service/UI、isolated API 25 状态生命周期 ✅ 2026-07-14

- [x] Dashboard 客户历史订单/付款搜索：保留旧 `order-receipt-search` 卡片 ID 以兼容账号布局偏好，替换旧单订单收据查询服务和 API；新增 `dashboard-customer-history-service` 与 `/api/dashboard/customer-history-search`，精确匹配标准化 `MARK / ORDER_NAME / ORDER NO`，`NAME` 使用不区分大小写的包含匹配，返回所有命中且当前账号可见的客户。抽出 `customer-history-service` 作为 Customer Management 与 Dashboard 共用历史内核，统一实时余额、排序、分页和收据图片字段；Dashboard 点击同一客户任意 `MARK / ORDER NAME / NAME` 都打开一份合并全部 ORDER_NAME 的历史弹窗。搜索结果区约三行高并滚动，不再分页；USER/SALES/ADMIN 均可使用且复用订单、收据可见范围。删除旧 `/api/dashboard/receipt-search` 与重复服务。无数据库、NAS/COS 路径或备份范围变更。测试：服务、route、API catalog、resource visibility、Customer Manager、Dashboard、共享历史弹窗及 isolated API 35 权限链路 ✅ 2026-07-14

- [x] Customer ORDER_NAME History 分页体验修复：确认根因是弹窗只有一个 `loading` 状态，翻页或切换每页条数时即使已有 `history` 数据也会卸载两张表并显示整块 Loading；改为仅首次无数据加载时显示整块 Loading，已有数据刷新时保留 Historical Orders / Recent Receipts 表格和分页控件，体验与 Dashboard 列表分页一致。无数据库、NAS/COS 路径或备份范围变更。测试：先新增 `loading=true + history` 的失败用例，再通过弹窗与 CustomerManager 回归 ✅ 2026-07-03

- [x] Customer ORDER_NAME History 排序与独立分页：历史订单 O/S 改为复用 `order-balance` 统一内核，按 `Order.amount - 非 SIGNING_PENDING 收据合计` 实时计算，避免客户历史弹窗再次展示失真的 `Order.orderBalance`；订单按“`O/S > 10` 在前、`O/S <= 10` 永远在后”，组内依次按无日期且 O/S 倒序、Release Date 由近及远、仅 Ship Date 由近及远排列。Historical Orders 与 Recent Receipts 使用独立服务端分页，默认 10 条，可选 `5 / 10 / 15 / 20`，每页条数按账号持久化且互不影响；分页偏好保存改为只提交当前键、后端与数据库现值合并，避免两个分页器或其他列表互相覆盖。Recent Receipts 按创建时间由近及远。复用共享紧凑分页组件，手机端保持单行。无数据库迁移、无新增 NAS/COS 路径，现有 MySQL 偏好 JSON 和备份范围可直接覆盖。测试：排序内核、客户读取服务、Customer API、偏好归一化/持久化、双表状态、弹窗与共享分页回归 ✅ 2026-07-03

- [x] Dashboard 余额可信度防错：新增 `order-balance` 纯内核和 `order-balance-service` 持久化服务，统一规则为 `Order.amount - 非 SIGNING_PENDING 收据合计`；`Dashboard` 不再信任 `Order.orderBalance` 作为最终来源，而是在后端一次性读取可见订单及关联收据后计算 `unpaidTotal / Released Unpaid Invoices / Customer Outstanding Ranking / 弹窗 Balance`，同一订单只计算一次并复用。若缓存与计算值不一致，系统自动写回正确 `Order.orderBalance`，只记录结构化日志与 `ORDER_BALANCE_CACHE_REPAIR` 审计，不提供人工修复按钮、不在页面打扰用户。`invoice-read-service / deletion-service / order-alias-db` 已移除重复公式并复用统一内核/服务；主要写入路径回归仍通过统一 `updateOrderBalance` 入口。无新增数据库表、无新增 NAS/COS 路径、备份范围不变。测试：`order-balance / order-balance-service / dashboard-summary-service / invoice-read-service / deletion-service / order-alias-db / receipt-service / receipt-generator-service / receipt-edit-request-service / detail-service / invoice-service / invoice-write` 聚焦回归 ✅ 2026-07-03

- [x] Receipt 全局分页收口：`Receipt Management` 删除独立的 `30 / 50 / 100 / 200` 分页状态和重复底部控件，改为复用共享 `ListPagination` 与 `useListPageSizePreference('receipt')`；账号偏好 JSON 新增 `receipt` 键，旧账号缺失时自动补默认 `20`，选项统一为 `5 / 10 / 20 / 50`，手机端条数选择、左右箭头和页码摘要保持单行。未新增数据库表或迁移，未修改 NAS/COS 路径及备份范围。测试按 RED/GREEN 覆盖偏好归一化、跨页面偏好保留、Receipt 组件布局及账号持久化 ✅ 2026-07-01

- [x] 分页与客户历史弹窗上线修复：确认 `Customer Management -> ORDER_NAME History` 桌面表格适配此前只存在于未合并 worktree，未进入 `main`；现将有效布局合入主线，弹窗桌面端按两张表内容宽度自适应，最大宽度限制为 `calc(100vw - 32px)`，超宽时只在弹窗内部横向滚动；`ORDER` 列按 `/` 允许断行，其余关键金额/编号/状态列保持不换行，`Outstanding` 改为 `O/S`，Recent Receipts 增加创建时间并把 Receipt 列移到最右。共享 `ListPagination` 移动端改为条数下拉与翻页控件同一行不换行。无数据库、NAS/COS 路径或备份范围变更。测试：`list-pagination / customer-order-history-dialog / customer-read-service` 红绿回归 ✅ 2026-07-01

- [x] Dashboard ORDER 收据查询图片预览：`dashboard-receipt-search-service` 在保持原 ORDER NO 匹配、权限和分页逻辑不变的前提下，补齐 `imageUrl / imageName / invNo / boundInvNo / creator` 预览字段；Dashboard `Order Receipt Search` 结果中只有带图片的 `ORDER NO` 渲染为可点击按钮，并复用 `ReceiptImagePreviewDialog` 展示已绑定 ORDER NO、发票号、创建者和收据图片。无新增数据库表、NAS/COS 路径或备份范围。测试：先确认 Dashboard 组件测试因 ORDER NO 不可点击失败，再通过 `dashboard-receipt-search-service / dashboard-view` 红绿回归 ✅ 2026-06-28

- [x] Dashboard ORDER 收据查询卡片：新增 `order-receipt-search` Dashboard 卡片注册项，按账号参与 Dashboard 设置中的显示/排序；新增 `/api/dashboard/receipt-search` 和 `dashboard-receipt-search-service`，输入 `ORDER NO` 后先复用现有精确/alias/复合订单匹配规则，匹配不到不原始搜索收据，匹配到后按可见权限查询该订单收据；前端卡片支持按钮和 Enter 查询、10 条分页，并把 Dashboard 现有列表卡片分页固定到底部。无新增数据库表、NAS/COS 路径或备份范围。测试：`dashboard-layout-preference / dashboard-receipt-search-service / dashboard receipt-search route / dashboard-view` 红绿回归 ✅ 2026-06-28

- [x] `Generate Signed Receipt` 付款类型自动诊断：新增 `payment-type-classifier` 共享分类器，把 Payment Detail Export Pic 原有 `Initial / Std / Final / Full payment / Deposit` 判断抽出为单一规则；`lookupReceiptGeneratorOrderContext()` 在订单上下文中按预计付款后余额、正式收据历史和 `DEPOSIT_POOL` 状态返回 `suggestedPaymentType`，并继续排除 `SIGNING_PENDING` 临时收据；前端 hook 自动回填 `Payment Type`，但用户手动改选后不再被当前上下文刷新覆盖。无新增数据库表、NAS/COS 路径或备份范围。测试：先确认新增测试失败，再通过 `npm test -- --runInBand src/lib/payment-type-classifier.test.ts src/lib/detail-export-image.test.ts src/lib/receipt-generator-read-service.test.ts src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx`，`npm run typecheck` ✅ 2026-06-23

- [x] `Generate Signed Receipt` 法语收据选项扩展：`receipt-generator-layout` 新增单一来源 `RECEIPT_GENERATOR_PAYMENT_MODES = Espèces/Virement` 与 `RECEIPT_GENERATOR_FRAIS_STATUSES = Payé/Non payé`，并保留旧 `Cash/Transfer` snapshot 兼容映射；弹窗新增 `Frais` 下拉，`Mode de paiement` 改为法语选项，hook/API/service 透传 `fraisStatus` 并写入 `layoutSnapshot`；正式导出画布不再写死 `Paid/Cash`，改为使用 layout 中的 `fraisStatus/paymentMode`。无新增数据库表、NAS/COS 路径或备份范围。测试：`npm run typecheck`，`npm test -- --runInBand src/lib/receipt-generator-layout.test.ts src/lib/receipt-generator-service.test.ts src/lib/receipt-generator-read-service.test.ts src/app/api/receipt-generator/route.test.ts src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx src/components/workspace/modules/receipts/components/receipt-generator-launch-dialog.test.tsx src/components/workspace/modules/receipts/generator/receipt-canvas.test.tsx src/components/workspace/modules/receipts/generator/signing-view.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx` ✅ 2026-06-22

- [x] `Generate Signed Receipt` 定金未登记订单回归修复：确认旧逻辑为“未录入过的 `ORDER NO` 创建定金收据后直接创建该订单并归入 `DEPOSIT_POOL`”。`receipt-generator-service` 现在只在 `paymentType=Deposit` 时允许 `lookupInvoiceOrderContext` 无 exact order 但有 inferred customer 的场景，并在同一事务中创建 `DEPOSIT_POOL` order、同步 order aliases、创建 `SIGNING_PENDING` receipt；`INV NO` 保持 `null`，`isDeposit=true`，余额公式继续留空。补齐 service 红绿回归，未新增数据库表、NAS/COS 路径或备份范围。测试：`npm run typecheck && npm run lint && npm test -- --runInBand src/lib/receipt-generator-service.test.ts src/lib/receipt-generator-read-service.test.ts src/app/api/receipt-generator/route.test.ts src/components/workspace/modules/receipts/hooks/use-receipt-generator.test.tsx src/lib/receipt-generator-layout.test.ts` ✅ 2026-06-22

- [x] 签名收据底部签名行模板固化：将用户通过 `tools/receipt-signature-row-layout-editor.html` 导出的 `RECEIPT_SIGNATURE_ROW_LAYOUT` 写入 `template-geometry.ts`，并让 `receipt-canvas.tsx` 的 `Reçu par / Signature / Signature du payeur` 文本、签名图片与下划线全部从该布局常量读取；新增画布回归测试断言正式导出图按确认坐标绘制。无数据库、NAS/COS 路径或备份范围变更。测试：`npm test -- --runInBand src/components/workspace/modules/receipts/generator/template-geometry.test.ts src/components/workspace/modules/receipts/generator/receipt-canvas.test.tsx` ✅ 2026-06-22

- [x] 签名收据底部签名行可视化排版工具：新增 `tools/receipt-signature-row-layout-editor.html`，用于在浏览器中拖拽/缩放 `Reçu par / Signature / Signature du payeur` 这一行的文本、签名样例和下划线，并导出 `RECEIPT_SIGNATURE_ROW_LAYOUT` JSON；新增 `tools/receipt-signature-row-layout-editor.contract.mjs` 做静态契约测试，确保后续 agent 不会改丢关键图层和导出入口。本次只新增本地辅助工具，未改正式收据模板、数据库、NAS/COS 路径或 Docker 服务。测试：`node tools/receipt-signature-row-layout-editor.contract.mjs` ✅ 2026-06-22

- [x] `Generate Signed Receipt` 付款类型与签名布局收口：弹窗新增 `Payment Type`（`Deposit / Full / Initial / Standard / Final`，默认 `Standard`）和 `Reçu par`（默认 `Mamadou Dian Diallo`，可选 `Transferred via bank account`）；后端创建签名 session 时标准化写入 `layoutSnapshot`，`Deposit` 会在事务内写入 `Receipt.isDeposit=true`，并把 `Reste à payer` 留空、`balanceAfter` 置空，避免定金收据进入普通余额公式。导出画布改为电话单行缩放、金额大写首字母大写，接收方签名移到收款人区域中部，付款方签名移到原接收方签名位置。补齐 receipt-generator layout/service/route/read/hook/dialog/canvas 回归测试 ✅ 2026-06-22

- [x] `Payment Detail Management` 已完成明细权限收口：`DetailList` 增加当前账号 ADMIN 判断，`RECEIVED` 状态下对 ADMIN 以下账号隐藏 `Edit Payment Detail` 和 `Request Deletion`，ADMIN 及以上保持原有修改和删除入口；只改前端可见动作，不改变后端审批、删除和数据权限规则。补齐 DetailList 回归测试 ✅ 2026-06-22

- [x] `Payment Detail Management` 图片预览标题规范化：小眼睛预览弹窗对 `payment-detail_...` 形式的历史/生成图片名称仅在显示层转换为 `Payment-Detail_...`；不修改数据库 `imageName/imageUrl`、NAS 真实文件名或路径，也不影响预览接口和下载。补齐 DetailManager 红绿回归测试 ✅ 2026-06-10

- [x] `Payment Detail Export Pic` 样式分支安全移植：确认旧提交 `44721e0` 停留在 `feature/payment-detail-export-pic-style`，且该分支落后于 `main`，不能整分支合并。现只把 `src/lib/detail-export-image.ts` 与测试中的导出图样式改动移植到当前主线：日期、行号、底部 agent/records 改为主蓝色，表头新增主蓝底和白色标题，`ORDER NO` 列加粗，`Final` 与新增 `Full payment` 使用绿色徽章；首笔真实发票付款且付款后余额 `<= 5` 时分类为 `Full payment`。无新增数据库表、迁移、NAS/COS 路径或备份范围变更。补齐 `detail-export-image / detail-image-assets / detail route` 回归测试 ✅ 2026-06-09

- [x] Dashboard 个人卡片布局设置落地：`UserPreference` 新增 `dashboardLayout` JSON 字段，复用 `/api/settings?view=user-preferences` 按账号读取和保存；新增 `dashboard-layout-preference` 共享注册表，集中定义 `summary / analysis / recent` 三个 section 与 8 个卡片，Settings 和 Dashboard 都只消费归一化后的布局，后续新增卡片必须先登记到该注册表。Dashboard 卡片右上角提供低干扰隐藏按钮，隐藏前中英文确认，空 section 自动不显示；Settings 新增 `Dashboard Settings` 折叠区，可调整 section/card 顺序和可见性。备份口径：该偏好只写 MySQL `UserPreference.dashboardLayout`，已纳入 `trading_ledger` dump，无新增 NAS/COS 媒体路径。补齐 schema/service/API/settings/dashboard 回归测试 ✅ 2026-06-08

- [x] Dashboard 欠款排行弹窗分组：`dashboard-summary-service` 在客户欠款聚合中为每个未结清订单标记 `IN_TRANSIT / RELEASED`，按 `Invoice.releaseDate` 计算已放单天数，并返回每个客户的运输中/已放单小计；前端 `Customer Outstanding Ranking` 外层保持原三列表格，点击客户后按 `Released -> In Transit` 展示订单、分类小计和 Released 天数。`releasedInvoices` 同步返回发票下订单明细，点击 `INV NO` 可按 `OUT STANDING` 倒序查看 `ORDER_NAME / INV AMOUNT / OUT STANDING`。补齐 service 与 dashboard view 红绿回归测试 ✅ 2026-06-08

- [x] 一键安全重建脚本固化：新增 `scripts/rebuild-local-app.sh`，把本地日常更新统一为“检查 `.env` 必要密钥 -> `docker compose config --quiet` -> `docker compose up -d --no-deps --build app` -> 刷新 `maintenance` -> app health check -> maintenance 清理接口检查 -> 最终容器状态输出”。脚本只重建 app 与维护服务，不执行 `docker compose down -v`、Docker volume 删除或上传目录清理；本地缺失/不安全的 `SESSION_SECRET` 和 `MAINTENANCE_JOB_TOKEN` 只在 `.env` 中生成，不向终端打印真实值。新增脚本安全契约测试，确保后续改脚本不会引入破坏性 Docker 命令 ✅ 2026-06-05

- [x] 代码审计第二轮工程收口：`tsconfig.noImplicitAny` 从 `false` 改为 `true`，修复客户导入/创建/更新、OCR 模型探测、客户和发票前端 hook 中暴露出的隐式 any；`customer-service` 中三处事务外部变量赋值改为事务直接返回创建/更新结果，避免严格类型下出现“事务成功但外部对象可能为空”的不稳定写法。新增 `logger.ts`，服务端/API 裸 `console.*` 统一收口为结构化日志并对 password/token/secret/cookie/authorization 等字段递归脱敏；OCR 解析失败不再记录完整模型原文，只记录长度。定向 typecheck、lint 与 83 个相关测试通过 ✅ 2026-06-05

- [x] 代码审计第一轮修复：生产 `SESSION_SECRET` 和维护任务 token 改为 fail-fast，公开占位符不再能通过生产校验；初始化管理员密码取消 `12345678` 兜底并新增 `INIT_PASSWORD_WEAK` 中英文错误码；移除未使用的 `next-auth` beta 依赖；限流默认不信任可伪造的 `x-forwarded-for`，只有 `TRUST_PROXY_HEADERS=true` 时使用受 Caddy 重写的代理头，同时为内存限流 Map 增加过期 key 机会清扫；Dashboard 待审批总数改为数据库 count，首页欠款统计改用 `Order.orderBalance`，不再带出每个订单所有收据；`matching.findOrCreateOrder/findMatchingOrder` 改为按订单 token 收窄候选后再计算相似度；关键订单余额刷新路径引入 `money.ts` Decimal 工具，避免 `0.30 - 0.10 - 0.20` 这类浮点尾差；`.txt` 上传增加 UTF-8/NUL 内容校验；CI、Docker、`npm start` 统一到 Node 22，`@resvg/resvg-js` 通过 `serverExternalPackages` 外部化，不再使用 `eval('require')`。补齐 session/init/rate-limit/matching/dashboard/upload 回归，定向 70 用例通过，`npm run typecheck` 通过。未强行落地默认拒绝 middleware 和大文件拆分：这两项会影响 Excel token、内部维护、外部同步等非 Cookie API，需要单独设计后实施 ✅ 2026-06-05

- [x] README 用户化收口：将 README 从混合“版本流水 + 技术手册 + 数据手册”的 500+ 行文档压缩为面向使用者的入口说明，保留用户截图、模块、流程、权限、数据安全和启动方式；新增 `docs/data-and-integrations.md` 承接 Excel ML / sync / consignee 写入接口、MySQL/NAS 数据范围、上传目录、资产台账、Docker volume、内置模板与测试临时数据说明。版本升至 `1.0.170`，不新增数据表、不新增持久化路径，备份范围不变 ✅ 2026-06-04

- [x] `Generate Signed Receipt` 完整复合订单精确输入漏分支修复：复核用户反馈后确认 v1.0.168 只让 `lookupInvoiceOrderContext()` 的 alias fallback 分支选择了 `amount + receipts`，但第一条 exact `orderNo in candidates` 分支仍只选择旧 `orderBalance`，导致直接输入 `PIKIN-19_B/PIKIN-19B/PIKIN-21` 时继续返回 `17869`。现 exact 分支同样选择 `amount` 和非 `SIGNING_PENDING` receipts，并把单测升级为断言第一条 Prisma 查询必须带出实时余额所需字段；本地源码只读调用已确认该订单返回 `3869` ✅ 2026-06-04

- [x] 签名收据复合订单余额暗病修复：确认 `PIKIN-19_B/PIKIN-19B/PIKIN-21` 这类复合订单在 `Generate Signed Receipt` 弹窗里读到的是旧 `Order.orderBalance`，而 `Invoice / Receipt` 页面按已完成收据实时重算，所以两个页面余额不同。`lookupInvoiceOrderContext()` 现改为按订单金额减去非 `SIGNING_PENDING` 收据实时计算上下文余额；`finalizeReceiptGeneratorSession()` 在签名完成事务内调用 `updateOrderBalance()` 重算对应订单余额；`calculateOrderBalance()`、收据列表余额、删除/alias 回填与历史脚本均排除未完成签名的临时收据。补齐 invoice-read-service、receipt-generator-service、matching、receipt-balance 单测与 isolated API 65 回归 ✅ 2026-06-03

- [x] 持久化数据变更备份门禁：根目录 `AGENTS.md` 和 `CHANGE_CHECKLIST.md` 新增规则，后续任何新增/修改数据库表、迁移、上传目录、生成文件目录、外部对象存储路径、定时清理任务或第三方持久化数据时，必须同步检查并更新项目备份范围；`docs/backup/muledger-cos-backup.md` 新增 `Backup Change Gate` 和 NAS 上传路径表，把 MySQL `trading_ledger`、NAS 上传目录、COS 路径、`UploadedAsset` 生命周期、清理任务、恢复演练触发条件和 dry-run 要求关联到同一份运行手册，避免新增业务数据但备份遗漏 ✅ 2026-06-01

- [x] `muledger` COS 备份脚本落地：新增 `scripts/backup/muledger-cos-backup.sh`，按 `database/mysql/YYYY/MM/DD` 上传 `trading_ledger` gzip dump 与 sha256，按 `media/upload/` 增量同步 NAS 上传目录，并写入 manifest；新增 macOS COSCLI 安装脚本、LaunchAgent 每日定时安装脚本、本地 env 模板和 `docs/backup/muledger-cos-backup.md` 权限/运行手册。密钥只读取本机私有 env，不进入 Git。已完成 shell 语法与 dry-run 验证 ✅ 2026-06-01

- [x] `CustomerConsignee` 空白占位清理：统一把 `- / － / — / –` 视为空白 `CONSIGNEE` 占位，新增/API 写入真实 `CONSIGNEE` 时事务内删除同客户占位项；如果原默认项是占位项，则把写入或匹配到的真实 `CONSIGNEE` 升为默认并同步旧 `Customer.consignee` 字段；列表读取过滤占位项，直接传入占位值会按空白拒绝。补齐 service 红绿回归 ✅ 2026-05-26

- [x] `CustomerConsignee` 默认值选择与弹窗按钮收口：新增 `setCustomerConsigneePrimary()`，事务内校验客户可见范围和 `consigneeId` 归属，先清空同客户全部 `isPrimary`，再设置目标为默认，并同步旧 `Customer.consignee` 字段；`/api/customer` 新增 `consignee-set-primary` action。前端 `CustomerConsigneeDialog` 新增“设为默认”入口，当前默认项显示默认状态，删除改为 icon-only 小垃圾桶按钮；`CustomerManager` 统一错误兜底与刷新。补齐 service / dialog / manager 红绿回归 ✅ 2026-05-25

- [x] `CustomerConsignee` 长文本与前端错误闭环修复：复现用户新增长 `CONSIGNEE` 时后端返回 `CONSIGNEE过长`，同时前端 `submitConsignee()` 缺少 `catch/finally` 导致 Add 按钮一直转圈；新增 `normalized_consignee_hash` 字段并迁移旧数据，唯一约束改为 `customerId + sha256(normalizedConsignee)`，`normalized_consignee` 改为 `TEXT`，允许保留完整长文本；前端新增异常兜底，失败时显示错误并必定关闭 submitting。补齐长文本 service 回归与 CustomerManager 异常 UI 回归 ✅ 2026-05-25

- [x] 多 `CONSIGNEE` 子表与外部写入接口落地：新增 `CustomerConsignee` 子表和安全迁移，仅从旧 `Customer.consignee` 回填，不删除旧字段；新增 `customer-consignee-service`，`writeOrderConsignee()` 复用 `resolveOrderCustomer()` 和 Excel ML token 可见范围，事务内按 `ORDER NO -> CUSTOMER -> CONSIGNEE` 幂等写入；新增 `POST /api/customers/order-consignee/write` 与兼容路径 `/customers/order-consignee/write`，响应直接返回 `{ written, orderNo, customerId, consigneeId, consignee, updatedAt }`；`Customer Management` 列表点击 `CONSIGNEE` 打开管理弹窗，支持新增/删除并同步旧字段。补齐 service / route / api-catalog / UI component 单测 ✅ 2026-05-25

- [x] `Payment Detail Export Pic` 预览刷新修复：`Deposit` TYPE 改为与 `Initial` 一致的浅蓝底蓝字徽章；新增 `regenerateDetailPreviewImage()`，`/api/detail?action=export-pic` 下载时不再只返回一次性 JPEG，而是重新生成并写回 `Detail.imageUrl/imageName`，已有系统生成预览图会直接覆盖同一路径，非系统图则生成新的 `payment-detail_<金额>_<日期>_<agent>.jpg` 预览引用。`preview-image` 响应改为 `no-store`，避免浏览器继续缓存旧图。补齐 export SVG、detail-image-assets、detail route 红绿回归 ✅ 2026-05-24

- [x] `Payment Detail Export Pic` 版式规则收口：`detail-export-image` 新增 `Deposit` 类型，首笔付款在 `receipt.isDeposit=true` 或所属订单在 `DEPOSIT_POOL` 时显示 `Deposit`，`Un_Associated` 仅继续阻止误判 `Final`；`export-pic` 与预览图生成查询补充 `receipt.isDeposit`。导出 SVG 右上角日期改浅蓝，`ORDER NO` 按列宽拆分为多行并动态增加行高，行内 `MARK / ORDER / TYPE / AMOUNT` 全部使用垂直居中，避免长订单号遮挡 TYPE。补齐 `detail-export-image` 红绿回归 ✅ 2026-05-24

- [x] 签名收据编号规则三次收口：保留 `RECEIPT_COUNTER_START = 10000` 和后端事务原子分配，只把 `formatReceiptNo()` 输出从 6 位改为 7 位，首号为 `0010000`；同步更新 receipt-generator route/service/read/hook/dialog/E2E 与 isolated API 断言，避免 CI 继续按旧 `010000` 规则判断。`Payment Detail` 新增 `detail-image-assets` 服务，统一处理小眼睛预览图：已有上传图会移动到 `details/ocr` 并按 `payment-detail_<金额>_<日期>_<agent>` 命名，无上传图会生成 `Export Pic` JPEG、保存到同目录、写回 `Detail.imageUrl/imageName` 并登记为已绑定上传资产；前端小眼睛统一走 `/api/detail?action=preview-image`。补齐 receipt-number / detail-image-assets / detail route / detail service / detail list 回归 ✅ 2026-05-24

- [x] 签名收据编号规则二次收口：`RECEIPT_COUNTER_START` 调整为 `10000`，`formatReceiptNo()` 统一输出 6 位编号，`getSuggestedNextReceiptNo()` 改为读取 `SystemCounter` 并跳过已占用编号，不再按最近 10 条收据推导。`Generate Signed Receipt` 创建 session 时不再接收前端 `receiptNo`，后端事务内调用 `allocateNextReceiptNo(tx)` 原子分配，弹窗编号改为只读预览；`SIGNING_PENDING` 收据删除入口开放给创建者和管理员，但仍走 `DeletionRequest` 审批通道。补齐 receipt-number / generator service / route / hook / dialog / receipt-list / deletion-service 回归，定向 49 用例、全量 754 用例通过 ✅ 2026-05-24

- [x] 全局搜索框 Enter 强制提交：新增 `submitSearchOnEnter` 统一键盘入口，过滤 IME 组合输入并阻止默认表单提交；`Customer / Invoice / Receipt / Payment Detail / SWIFT / Orders / Approval` 顶部搜索及客户修复、付款明细直建弹窗搜索接入 Enter 主动查询。原有 onChange 即时搜索、按钮查询和本地过滤逻辑保持不变；列表加载函数只新增可选 `searchOverride` 参数，避免按 Enter 时被 React 状态延迟影响。补齐 helper 与 CustomerToolbar 红绿回归测试 ✅ 2026-05-24

- [x] `Create Payment Detail Directly` 手动行折叠交互收口：移除 `Manual detail rows` 下方灰色说明和单独 `Expand manual rows` 按钮，改为标题行本身作为展开/收起按钮；保留默认折叠和展开后手动录入能力，补齐组件断言防止重复控件回归 ✅ 2026-05-23

- [x] `Create Payment Detail Directly` 付款代理选择与手动行折叠：`DetailDirectCreateDialog` 新增 `agents / selectedAgentId` 受控参数，在日期下方渲染付款代理下拉，只展示 `PaymentAgent.companyName`；`handleDirectCreate` 新增前端必选校验并把 `agentId` 写入 `direct-create` payload，复用后端 `resolveAccessiblePaymentAgentId` 进行权限校验和持久化。`DetailList` 在卡片头部显示已保存的 agent company name；手动新增明细行默认折叠，展开后才显示输入行和新增按钮，降低手机端弹窗高度。补齐 dialog / hook / list / manager 回归测试 ✅ 2026-05-23

- [x] `Create Payment Detail Directly` 移动端 footer 溢出修复：将 `DetailDirectCreateDialog` 改为 `header / scrollable body / sticky footer` 三段式，弹窗最大高度使用 `92dvh`，内容区独立滚动，底部操作区固定在弹窗底部并保持背景遮罩；新增总计栏，实时汇总已勾选 `SR_Received` 收据金额和手动新增明细金额，统一走 `formatUsdAmount/parseDisplayMoney` 金额格式化。补齐组件回归覆盖 sticky footer 与 total 展示 ✅ 2026-05-23

- [x] 外部 agent 按 `ORDER NO` 批量查询客户资料：新增 `order-customer-lookup-service`，将财务订单精确匹配、`OrderAlias`、`/` 复合订单拆分和 `ORDER_NAME` 忽略空格推导封装为单一查询入口；新增 `POST /api/sync/customers/by-orders`，沿用 Excel ML Bearer token 和 `excelLookup` 限流，入参 `orderNos: string[]`，每条结果独立返回成功或错误，避免单个异常拖垮整批。`excel-ml-service` 同步改为调用该解析服务，避免 Excel 单字段查询和外部 agent 批量查询规则分叉；补齐 service、route、api-catalog、excel-ml 回归测试 ✅ 2026-05-23

- [x] 签名收据编号冲突修复与可配置起始号：确认线上 `Server error` 根因是 `Receipt.receiptNo` 唯一键冲突，而非 `INV NO` 发票号冲突；新增 `getSuggestedNextReceiptNo()`，按最近登记 10 条 receipt 中最大纯数字编号 +1 生成默认建议。`Generate Signed Receipt` 弹窗新增可编辑 `Receipt No.` 字段，创建 session 时将用户指定编号传入后端；`allocateNextReceiptNo()` 支持显式编号、推动 `SystemCounter` 到指定编号之后，并在重复编号时返回 `CONFLICT` 人类可读错误。普通收据修改/创建中的 `receiptNo` 唯一冲突也统一映射为“收据号已存在，请换一个编号”，并补齐英文错误片段翻译与 service/route/hook/dialog/number 回归 ✅ 2026-05-23

- [x] `Create Payment Detail Directly` 可加入收据列表二次收口：`DetailDirectCreateDialog` 中 `Receipts available to add` 的已存在收据行只展示 `ORDER NO` 与格式化收据金额，移除可见的 `receiptNo/date/mark/payer`，搜索框同步收窄为按订单号搜索；补齐组件回归断言，确保手机端列表继续使用有界滚动区域 ✅ 2026-05-23

- [x] `Create Payment Detail Directly` 增加 `SR_Received` 收据直选能力：打开弹窗时加载当前账号可见的 `SR_Received` 收据，前端以只读勾选行合并到 direct-create payload，手动新增行保留；后端 `createDetailRecord` 对显式 `receiptId` 再次校验状态仍为 `SR_Received`，并阻止同一收据重复加入同一张付款明细；补齐 dialog / manager / hook / service 回归测试 ✅ 2026-05-23

- [x] `Receipt Management` 顶部右侧动作按钮顺序收口为 `Create Directly -> Generate Signed Receipt -> Upload Receipt`，仅调整视觉排序，不改变权限、弹窗或数据逻辑 ✅ 2026-05-20

- [x] Payment Agent 管理弹窗修复：确认根因是 `PaymentAgentManagerDialog` 打开后会在 effect 中自动选择第一条代理，点击 `New` 清空 `selectedAgentId` 后又被同一 effect 选回第一条，导致用户看到“没有任何反应”。新增 `isCreatingDraft` 明确区分新建草稿与已选代理；点击代理列表会退出新建草稿，保存/删除/关闭后重置状态。桌面端弹窗改为固定高度两栏布局，右侧详情面板独立滚动并增加 `minmax(0,1fr)` 防止内容被横向挤出；补齐组件回归测试覆盖 `New` 状态和布局约束 ✅ 2026-05-16

- [x] 客户增量同步 API：新增 `customer-sync-service` 和 `/api/sync/customers`，接口通过不透明 base64url 游标维护 `Customer.updatedAt` 与 `AuditLog.CUSTOMER_DELETE.createdAt` 两条水位；本次只返回 `since < changedAt <= highWatermark` 的 upsert/tombstone，避免同步过程中新增变更丢失。删除客户因当前系统为硬删除，改从 `CUSTOMER_DELETE` 审计日志读取 `ownerId / mark / orderName` 生成 `DELETED` 标记；当前无停用字段，`disabled` 明确返回空数组。接口复用登录态和客户权限范围，`ADMIN` 全量、`SALES` 仅自有绑定池、`USER` 403；补齐 service、route、api-catalog 单测和 isolated API 真实创建/更新/删除/权限回归 ✅ 2026-05-15

- [x] Orders 页面用户侧文案与弹窗适配收口：移除 `Independent business order tracking...` 这类面向工程实现的可见说明；侧边栏入口、页面标题、创建按钮、表头、状态选项、空状态、弹窗字段和保存提示统一走 `useUiText` 中文化；`DialogContent / SelectTrigger / SelectContent / SelectItem / selected customer hint / table customer cell` 增加 `min-w-0 / overflow-hidden / truncate / title` 约束，防止超长客户名称撑宽新建弹窗或表格列；补齐 React 回归测试覆盖英文模式不显示技术说明、中文标签和长客户名截断 ✅ 2026-05-14

- [x] Orders 创建体验补齐：`OrderTrackerManager` 新建弹窗复用 `lookupOrderContextByOrderNo` 的全局订单上下文能力，对输入的 `ORDER` 做防抖匹配并回填/选中客户候选；关闭弹窗会主动失效未完成请求，避免异步回填污染下一次创建。创建模式隐藏管理员字段区，`SYSTEM NOTED` 仅保留在编辑模式并继续受上级 `ADMIN` 权限控制；补齐 React 组件回归测试 ✅ 2026-05-14

- [x] 独立 `Orders` 页面落地：新增 `OrderTracker` 持久化表和 `/api/orders`，结构复用财务 `Order` 的订单号、tokens、金额/余额快照、客户快照、创建者等连续性字段，并增加 `status / piStatus / remark / systemNote`；该表不参与财务匹配、余额和收据链路。创建前通过 `findOrderIdByNoOrAlias` 严格查重财务订单和别名，命中则 409 拒绝；列表按权限树可见范围读取并按 `Receipt.isDeposit / DEPOSIT_POOL` 汇总 `DEPOSIT`；前端新增 `/orders` 页面、侧边栏入口、状态筛选、客户选择、编辑弹窗与上级 ADMIN 字段权限；补齐 service/api-catalog/routes 回归和 isolated API 真实迁移验证 ✅ 2026-05-14

- [x] `RECEIVED` 收据重绑订单/发票：移除管理员直改 `RECEIVED` 收据时的后端阻断，复用 `resolveReceiptEditBinding` 在事务内重新绑定 `orderId/orderNo/invNo`；新增 `syncReceiptDetailItemsForBinding`，管理员直接保存和销售审批通过都会同步更新关联 `DetailItem.orderNo/mark`，避免收据已转单但付款明细/导出图仍显示旧订单；旧/新订单余额继续重算，`Receipt/Detail/SWIFT` 完成状态不回退；补齐 service/request/binding 回归 ✅ 2026-05-14

- [x] 网页标签栏图标替换：将 `public/logo.svg` 替换为用户提供的 MU 红蓝 SVG，并把 Next metadata `icons.icon` 改为带 `image/svg+xml` 类型声明的 favicon 入口，确保浏览器标签栏使用新图标 ✅ 2026-05-12

- [x] Payment Detail Export Pic TYPE 判断修复：确认最新 Detail `cmoxhdg8g0027ro01sm97k47m` 中 `SPK-03B / MSP-06 / THP-04 / FALO-17` 这类真实发票订单余额已为 0，但旧逻辑要求 Detail 必须先关联 `Bank_Transfer / RECEIVED` Swift 才显示 `Final`，导致导出图误显 `Standard`；现改为真实发票订单余额 `<= 5` 即显示 `Final`，`DEPOSIT_POOL / Un_Associated` 池子排除在 Final 判断外；补齐红绿回归测试 ✅ 2026-05-11

- [x] Payment Detail Export Pic 视觉样式微调：导出模板表头改为黑色加粗并提升到 16px，`ORDER NO` 列内容改为黑色，`Std` 展示文案改为黑色加粗 `Standard`；蓝色总计条左侧 `TOTAL TRANSFERRED` 改为与右侧金额同字号白色加粗；顶部 `TOTAL / TRANSACTIONS` 改为黑色加粗；底部付款公司与 records 字号从 10px 放大到 15px；补齐 SVG 断言与 JPEG 渲染回归 ✅ 2026-05-09

- [x] SWIFT PDF 手机端多页滚动修复：确认根因是 `SwiftImagePreviewDialog` 只有 `max-height`，移动端没有稳定的确定高度，导致 PDF 内容被外层弹窗裁切而滚动区域没有接管触摸滚动；现把 SWIFT 文件预览弹窗改为手机端固定视口高度，`PdfPreview` 根容器增加 `min-h-0 / touch-pan-y / overscroll-contain / -webkit-overflow-scrolling: touch`，让多页 PDF 在弹窗内纵向滚动；补齐 SWIFT preview 回归并验证 `typecheck / lint` ✅ 2026-05-08

- [x] 金额显示、dashboard 汇总与 SWIFT PDF 移动端预览收口：新增 `src/lib/display-format.ts` 作为金额和 ORDER_NAME 展示单一格式化入口，前端金额输入新增 `MoneyInput`，统一美元金额为英文千分位、四舍五入、无小数显示；`Invoice / Receipt / Detail / SWIFT / Dashboard / Customer history / Approval` 等页面替换散落的 `toFixed(2)` 展示；`dashboard-summary-service` 扩展首屏汇总，新增已放单未结清发票列表和客户 ORDER_NAME 欠款汇总列表；`PdfPreview / SwiftImagePreviewDialog` 优化手机端长文件名、多页 PDF 宽度和滚动边界；补齐 formatter、dashboard service、receipt layout、SWIFT preview、invoice transfer、matching 等回归，并验证 `typecheck` ✅ 2026-05-08

- [x] 登录页凭据默认填充修复：确认 `LoginPage` React state 已为空，用户看到管理员账号密码的主要来源是页面示例占位与浏览器凭据自动填充；现移除登录框中的 `admin@example.com / ••••••` 占位提示，并在 form、email、password 字段上显式关闭/规避 credential autofill；补齐登录页回归测试 ✅ 2026-05-08

- [x] SWIFT PDF 文件预览收口：新增共享 `PdfPreview` 组件，基于 `pdfjs-dist@4.10.38` 在前端按页渲染 PDF 到 canvas；`SwiftUploadDialog` 的 PDF 上传预览从静态文件卡片升级为多页预览，`SwiftImagePreviewDialog` 升级为图片/PDF 通用文件预览弹窗，SWIFT 列表“小眼睛”对已上传 PDF 走同一预览链路，图片仍保留原 `<img>` 逻辑；补齐 PDF 类型识别、上传弹窗和已上传附件弹窗回归，并验证 `typecheck / lint / build` ✅ 2026-05-08

- [x] 移动端筛选与客户历史弹窗收口：新增 `ResponsiveFilterCard`，`Receipt / Detail / SWIFT` 三页手机端只展示搜索框和筛选收纳按钮，`Receipt` 额外保留外部查询按钮，桌面端仍走完整筛选网格；`Customer Management` 的 `ORDER_NAME` 改为可点击 alias chip，新增 `customer?action=order-history` 和 `getCustomerOrderNameHistory()`，按可见客户与选中 `ORDER_NAME` 返回历史订单/发票/金额/未收金额，并在桌面弹窗右侧展示该客户最近收据状态；`Create Invoice` 弹窗将 `Add Order / Cancel / Create` 统一放到底部操作区并修复手机端输入行遮挡问题；补齐 manager/component/service 回归 ✅ 2026-05-07

- [x] 工程数据安全基线补充：明确本项目日常验证优先采用 app-only rebuild，不把普通 Docker Desktop daemon EOF / lingering process 视为数据库删除事件；禁止在活跃数据服务上执行 `docker compose down -v`、Docker volume 删除、`prisma migrate reset`、`prisma db push --force-reset`、清表或重建业务库等破坏性命令；涉及数据库结构变更前必须先说明迁移路径、回滚路径和数据风险，风险验证应优先单开测试部署，不替换现有数据服务 ✅ 2026-05-07

- [x] SWIFT PDF 多页识别接入：确认 `glm-4.6v` 的 chat `file_url` 不接受 `data:application/pdf;base64`，本地实测会返回平台侧网络错误；现改为 PDF 文件走 BigModel `/files/parser/sync` 同步文件解析，联合提取多页文本后再调用同一 OCR 配置的 GLM 做 SWIFT JSON 结构化。`/api/swift?action=recognize` 支持 `application/pdf`，`SWIFT_OCR` 暂存资产从图片专用写入扩展为通用文件写入，前端上传弹窗支持 `image/*,application/pdf` 并对 PDF 显示文件预览卡；补齐 OCR、OCR input、上传压缩、暂存资产和弹窗回归，并用用户示例 PDF 真实 API 验证 HTTP 200 ✅ 2026-05-07

- [x] 收据 OCR 进度与客户显示规则收口：确认 `Upload Receipt` 在上传完成后仍等待 `/api/receipt?action=recognize` 返回，旧 UI 只显示 `100%` 进度条导致用户感知为卡死；现将阶段拆为压缩、上传、AI 识别、AI 回传整理、识别完成核对，并补 hook 回归。新增 `customer-display` 纯工具统一 `COMPANY_NAME -> NAME + "MARK"` 显示规则，替换 `receipt-service / receipt-generator-layout / invoice-read-service / api client / Generate Signed Receipt` 弹窗内的重复拼接逻辑，防止模板层再次退回只用 `customer.name`；补齐工具、弹窗、hook、client 回归 ✅ 2026-05-07

- [x] 复合订单收据录入回填收口：`lookupOrderContextByOrderNo` 新增 `orderSuggestion` 返回真实命中的完整 `ORDER NO`，`Upload Receipt / Create Receipt Directly` 表单在单段 `AB-13B` 命中复合订单 `AB-13B/AB-12B` 时会回填完整订单；`receipt-service` 后端入库同步改为优先保存 `matchedOrder.orderNo`，防止绕过前端直接 API 只存单段；`Generate Signed Receipt` 的 order context、预览、session 创建和占位收据也同步使用完整订单；底层 `order-alias` 兼容旧空格复合格式 `AB-13B AB-12B`，同时避免误拆 `OUMAR LAH-01` 等正常空格订单名；补齐 client/forms/service/generator/order-alias 回归 ✅ 2026-05-07

- [x] 收据 OCR Motif 发票号保留二次修复：确认根因在 `use-receipt-forms` 的上传回填层，订单匹配成功但无 `invoiceSuggestion` 时会把 OCR 已识别的 `invNo` 强制清空；现改为“数据库发票建议优先，否则保留 OCR `INV NO`”，并补强 `receipt-normalization` 从 `Payment for L25MH060523 Big Alpha-07` 这类 Motif 中分别拆出 `INV NO` 与 `ORDER NO`；同步更新 OCR prompt 与 hook/normalizer 回归 ✅ 2026-05-07

- [x] 收据 OCR 手写 Motif 二次修复：复现用户上传图片 `/upload/images/receipts/ocr/1778125156912_jimd6z.jpg`，当前运行 API 返回 `orderNo=null/isDeposit=true`；根因是 prompt 未明确订单号常位于 `Motif: Initial payment for ...`，且模型把 `Initial payment` 误判为定金。现扩展 OCR prompt 返回 `motif`，`receipt-normalization` 新增从 `payment for / initial payment for / final payment for` 后兜底抽取 `ORDER NO`，并强制 Upload Receipt 的 `isDeposit=false` 默认值；`/api/receipt recognize` 增加标准化字段摘要日志；补齐 normalizer 与 receipt OCR 回归 ✅ 2026-05-07

- [x] 收据 OCR / SWIFT 签收 / 审批分页收口：新增 `receipt-normalization`，前后端统一把 `receipt_no/payment_date/phone/amount/inv_no/order_no/client_name/is_deposit` 等 OCR alias 标准化为 `ReceiptOcrResult`，确保 `ORDER NO` 不会因未命中发票被误清空且 `DEPOSIT` 默认 false；`ReceiptList` 把 rows-per-page 控件下沉到底部分页区；`swift-service` 新增 `markSwiftReceived`，管理员可事务化签收 SWIFT 并联动同 detail 下 `Receipt/Detail/Swift -> RECEIVED`，SALES 403；统一 `Approval` 四个待审批区块为 20 条分页展示；补齐 hook/component/service/route/API isolated 回归 ✅ 2026-05-07

- [x] `Receipt Management` 修改绑定链路补齐：图片预览元信息改为展示绑定 `ORDER NO / INV NO / creator`；`ReceiptEditablePatch`、`receipt-edit-request-service`、`receipt-service` 与 `/api/receipt` schema 新增 `orderNo`，`ReceiptEditDialog` 支持修改订单号；新增 `receipt-edit-binding` 统一处理“现有订单命中 / 临时池订单迁移到目标发票 / 未登记订单创建零金额订单 / 无法匹配回退系统池”，审批通过与管理员直接保存均在事务内重新绑定 `orderId/orderNo/invNo`，并在订单迁移后重算旧/新订单余额；补齐 binding/service/request/route/UI/API isolated 回归 ✅ 2026-05-07

- [x] `Receipt Management` 未登记订单入账规则收口：`findMatchingOrder` 删除同组前缀与相似度兜底，只保留 `ORDER NO` 精确匹配和 `/` 复合订单 alias/分段命中，避免 `AB-13B -> AB-07` 误挂；`createReceiptRecord` 在未命中已登记发票订单时强制 `invNo = null`，继续按 `isDeposit` 创建 `DEPOSIT_POOL` 或 `Un_Associated` 系统池订单；`resolveCustomer` 扩展 `customerPayerName`，收据创建服务端统一生成 `COMPANY_NAME + "MARK"` 或 `NAME + "MARK"` 的 payer；前端订单上下文、OCR/Direct 表单同步清空无匹配订单的识别发票号；收据图片预览改为绑定元信息，状态筛选改成下拉草稿 + 查询按钮应用；补齐 matching / receipt-service / api client / receipt forms / receipt manager / image preview 回归 ✅ 2026-05-07

- [x] `Payment Detail` 编辑与导出 TYPE 二次收口：`Detail` 修改状态门禁改为只禁止 `RECEIVED`，`Bank_Transfer` 下管理员直接修改与 SALES 修改审批均可继续提交；`applyDetailUpdate` 根据原 detail 状态保持关联收据状态，`Bank_Transfer` 更新不再回退到 `Waiting_SWIFT`；`order-preview` 与保存链路新增编辑专用 receipt 匹配参数，可匹配 `SR_Received / Waiting_SWIFT / Bank_Transfer` 的已有收据并按金额接近排序，避免已有订单号误提示新建收据；`Export Pic` 将 `Bank_Transfer / RECEIVED` 都视为 SWIFT 已生效，余额 `<= 5` 时优先显示 `Final`，覆盖首付款同时结清订单的场景；同步优化 `PaymentAgentManagerDialog` 桌面/移动端可视高度、滚动区和底部按钮 ✅ 2026-05-06

- [x] `Payment Detail -> Export Pic` TYPE 规则修正：旧实现用历史 `DetailItem` 判断首付款，但当前真实历史付款主要存在 `Receipt` 链路中，导致只有一条 detail 时所有订单都被误判为 `Initial`；现改为按订单下有效 `Receipt` 的时间顺序判断当前 linked receipt 是否第一笔，同时严格要求 `detail.swift.status === RECEIVED && orderBalance <= 5` 才显示 `Final`，否则回退 `Std`；补齐 `Initial / Std / Final` 与“余额清零但 SWIFT 未到账不能 Final”的回归 ✅ 2026-05-06

- [x] `Payment Detail -> Export Pic` 手机竖屏版式与代理编辑收口：导出模板从 1560px 宽幅改为 720px 竖屏友好宽度，并同步调整 logo、汇总卡、表格列距、行高和字号；`DetailEditablePatch`、`/api/detail request-edit`、审批快照与 `DetailEditDialog` 全链路加入 `agentId`，管理员直接修改或销售审批通过后都会更新 `Detail.agentId`，导出 footer 使用新代理名称；`listPaymentAgents` 自动补齐默认 `Mitty Group`，补齐 route/service/UI/export 回归 ✅ 2026-05-06

- [x] `Payment Detail -> Export Pic` Arial 字体二次收口：确认用户反馈的“非乱码但内容空白”根因是 Docker 运行镜像没有 Arial 字体，Resvg 只能画出 logo、线条和色块；现已把 `Arial / Arial Bold` 固化到 `public/detail-export` 并由 `detail-export-image` 显式加载，同时删除旧的 `Noto Sans` 资产路径，补回归测试确保导出不再依赖容器系统字体 ✅ 2026-05-06

- [x] `Payment Detail -> Export Pic` 模板资产收口：新增项目内置透明 `MU Group` logo 与内嵌 `Noto Sans` 字体资源，`detail-export-image` 不再依赖容器字体或旧 `public/logo.svg`，导出 JPG 的 logo、日期、表格和 footer 进一步对齐用户提供的 `payment_details.html` 与参考图，同时补 `detail-export-image` 元数据/字体回归并重新验证 `build + targeted jest` ✅ 2026-05-06

- [x] Dashboard / Detail / SWIFT UX 收口：新增 `/api/dashboard?action=summary` 与 `dashboard-summary-service`，把首页统计改成后端直接汇总，不再依赖先打开其他业务页才能有数据；`SWIFT Management` 打开上传/直建弹窗时会主动加载 `Waiting_SWIFT` 的付款明细选项；`Payment Detail -> Export Pic` 改为按标准 `payment_details.html` 结构渲染模板化 JPG；`SWIFT` OCR 改为按报文 `Block 4` 的 `:50K:` / `:59:` 解析付款人、付款人地址、收款人和收款账号，并修复 `Confirm Create` 数值解析、`Detail/SWIFT` 手机弹窗底部按钮超窗，以及 `Edit Payment Detail` 暴露内部 `receiptId` 的问题；补齐 `dashboard route / dashboard summary service / detail export image / swift route / swift hook / detail manager` 回归并重新跑通 `build + test:ci` ✅ 2026-05-06

- [x] workspace 移动端观看性与列表交互收口：`Dashboard / Invoice / Receipt / Payment Detail / SWIFT / Customer / Approval / Settings` 的头部操作区、筛选区、表格溢出和按钮折行统一改成更稳的窄屏布局；设置页新增通用 `CollapsibleSettingsSection`，把密码、Excel Token、图片压缩、用户管理、分支清库、系统配置、设置审计全部收成折叠面板；收据页新增多状态筛选与 `30/50/100/200` 分页大小，并把 `/api/receipt` 扩展为支持多 `status` 查询参数；账单列表默认排序改为“未完成在前、已完成在后、空 shipDate 置顶、其余按 shipDate 从早到晚”；补齐 `receipt route / receipt manager / settings manager / invoice ordering / settings workspace e2e` 回归并重新跑通 `build + test:ci` ✅ 2026-05-06

- [x] 审批聚合与搜索稳定性收口：原 `Deletion Approval` 页面重构为统一 `Approval` 页，集中展示删除审批、收据修改审批、付款明细修改审批和 SWIFT 修改审批，并移除各业务页底部重复待审批表；新增 `useLatestRequestGuard` 并在 customer/invoice/receipt/detail/swift 列表加载中统一接入“只采用最新请求结果”的保护，修复搜索框输入结束后被过期请求覆盖的错误结果，以及因此引发的 `ReceiptManager` 无限更新回归；补齐 `use-invoice-view-state` 与相关页面测试并重新跑通 `build + test:ci` ✅ 2026-05-05
- [x] 复合订单 `/` 匹配规则落地：`order-name-kernel` 新增复合订单候选扩展，`customer-order-name-service / customer-matching / invoice-read-service / excel-ml-service / order-alias-db` 统一支持“复合订单任一分段命中整条记录”，同时保持 ignore-space 与客户主数据规范回填；补齐 `order-name-kernel / customer-order-name-service / order-alias-db / invoice-read-service / excel-ml-service` 单测 ✅ 2026-05-05
- [x] `Payment Detail` 导出图片能力泛化：移除 API 与前端对 `sourceMode === DIRECT` 的限制，所有可见明细均可调用 `export-pic` 渲染规范导出图 ✅ 2026-05-05

- [x] 全局匹配内核与收据/明细后续能力收口：新增 `order-name-kernel` 统一处理忽略空格规范化、`ORDER NO -> ORDER_NAME` 前缀提取与 alias 去重；`Customer` 新增 `normalizedMark`，并引入 `CustomerOrderName` 子表支持一客户维护多个独立 `ORDER_NAME`；`customer-matching / invoice-read-service / invoice-service / excel-ml-service / customer-scope` 统一改为走 alias + ignore-space 规则，批量导入、创建、改单、rematch、收据 OCR/直建、签名收据订单上下文全部共用同一套匹配核；同时支持 `Invoice` 订单编辑修改 `INV NO` 并事务化迁移订单分组、同步关联收据 `invNo`；`Receipts` 列表新增 `Balance` 列；`Upload Receipt` OCR 在识别出 `ORDER NO` 后优先用数据库订单/客户信息整套回填；`Payment Detail` 手工直建记录新增 `Export Pic` PNG 导出；`Generate Signed Receipt` 新增 `Mode de paiement(Cash/Transfer)` 并渲染到 `RESTE A PAYER` 同行右侧；补齐 `order-name-kernel / customer-order-name-service / customer-matching / invoice-read-service / invoice-service / receipt-balance / detail-export-image / receipt-generator-*` 单测与全量 `test:ci` 验证 ✅ 2026-05-05

- [x] 修复 `Upload Payment Detail` OCR 确认创建 payload 解析错层：移动端前端提交 `action=confirm + data={date,items}`，后端 `/api/detail` 旧实现错误按顶层 `requestData` 走 `detailPayloadSchema`，导致 `items` 缺失并报 `Invalid input: expected array, received undefined`；现已新增 `parseDetailCreatePayload()` 同时兼容顶层 payload 与嵌套 `data` payload，并补 `route.test.ts` 红绿测试及 `85-uploaded-asset-cleanup` isolated API 回归，真实确认创建链路恢复 ✅ 2026-05-05
- [x] 付款明细与 SWIFT 修改审批流落地：新增 `DetailEditRequest / SwiftEditRequest` 持久化与 `PENDING / APPROVED / REJECTED` 状态、`pendingDetailId / pendingSwiftId` 唯一约束防重复待审批；`detail-edit-request-service / swift-edit-request-service` 事务化实现申请/审批/列表逻辑，`/api/detail` 与 `/api/swift` 新增 `request-edit / review-edit / list-edit-requests`；前端在付款明细页和 SWIFT 页新增编辑弹窗、待审批列表和管理员审批动作；`SALES` 走审批流、`ADMIN` 直接修改，字段白名单与可编辑状态严格限定为 `Detail(Waiting_SWIFT|ERROR)` 与 `Swift(ERROR|Bank_Transfer)`；补齐 route/service/hook/UI/unit/isolated API 回归，并新增 isolated harness 限流重置入口避免测试间的登录桶污染 ✅ 2026-05-05
- [x] 收据修改审批流落地：新增 `ReceiptEditRequest` 持久化与 `PENDING / APPROVED / REJECTED` 状态、`pendingReceiptId` 唯一约束防重复待审批、`receipt-edit-request-service` 事务化申请/审批/列表逻辑；`/api/receipt` 新增 `request-edit / review-edit / list-edit-requests`，收据页新增编辑弹窗、待审批列表和管理员审批动作；`SALES` 走审批流、`ADMIN` 直接修改，字段白名单限定为 `receiptNo / date / invNo / customerMark / payer / tel`；补齐 route/service/hook/UI/unit/isolated API 回归并修复 reviewer 指出的 ISO 日期编辑和 nested payload 契约问题 ✅ 2026-05-05

- [x] 上传资产清理闭环落地：新增 `UploadedAsset` 生命周期台账（`STAGED -> ATTACHED -> DELETED`），把 `Create Receipt Directly`、收据/明细/SWIFT OCR、签名收据 finalize 的图片写入统一纳管；新增内部维护路由 `/api/internal/maintenance/uploaded-assets` 和 Docker maintenance 服务定时调用，24h 清理孤儿 staged 文件、72h 取消 stale `SIGNING_PENDING` 签名会话并删除其占位收据；本阶段明确“不回填历史文件”，只管理新注册进台账的上传资产，并补齐 unit + isolated API 覆盖 ✅ 2026-04-30
- [x] `Create Receipt Directly` 选图确认页落地：新增前端待确认图片状态与 `receipt-direct-image-confirm-dialog`，移动端 `拍照 / 从相册选择` 返回后先进入项目内大图确认页，用户点击“确认上传”才触发既有压缩 + `apiUploadCall` 进度/超时链路；补齐 `use-receipt-actions / receipt-direct-image-confirm-dialog` 自动化并重新跑通 `build + test:ci` ✅ 2026-04-30
- [x] 收据管理弱网上传二次增强：`apiUploadCall` 升级为基于 `XMLHttpRequest` 的 multipart 上传器，支持真实百分比进度、`15s` 空闲超时、`120s` 总时长兜底与 `uploading -> saving` 分段回调；`Create Receipt Directly` 弹窗新增进度条、`saving` 阶段与更细的错误映射，签名收据 `finalize` 也切到同一套上传器；补齐 `client / use-receipt-actions / receipt-direct-create-dialog / signing-view` 回归并重新跑通整套 `test:ci` ✅ 2026-04-30
- [x] 收据管理 `Create Receipt Directly` 上传链路弱网增强：新增前端保守压缩（质量下限 `0.30`、文字可读优先）、移动端 `拍照 / 从相册选择` 双入口、弹窗内明确的压缩/上传/成功/失败状态；`ORDER NO` 上下文扩展自动建议回填 `INV NO / MARK / PHONE / PAYER`（`payer = companyName || name`）；`/api/upload-image` 细化 `UPLOAD_ABORTED` 分类，前端映射“上传中断，请在更稳定的网络下重试”，并补齐 image-compression / use-receipt-actions / client / invoice-read-service 回归与全量 `test:ci` ✅ 2026-04-30
- [x] Excel ML token API 落地：新增 `ExcelApiToken` 持久化表（hash-only）、`/api/excel/token` 设置页管理、`/api/excel/ml` 单值纯文本/JSON 查询、`/api/excel/ml/batch` 批量查询；ORDER NO 先按现有订单/alias 匹配，失败后按最右 `-` 左半部分匹配客户 `ORDER_NAME`，字段 2 按 `companyName || Customer.name` 回退；新增服务单测、设置页 hook/card 测试和 `90-excel-ml-token` isolated API 回归 ✅ 2026-04-28
- [x] 修复移动端签名收据跳转时序：`Generate Signed Receipt` 创建 session 后，手机同标签页跳转分支立即结束当前页逻辑，不再继续执行 `resetGeneratorState()` 和 `loadReceipts()`；同时新增 hook 单测与隔离 Playwright 断言，覆盖三星类浏览器“点击 Continue to signing 后又回到 receipts”的回归场景 ✅ 2026-04-28
- [x] 签名收据预览与导出彻底统一：`receipt-canvas` 预览层不再维护第二套 DOM 模板，直接显示最终导出 canvas；`Tel` 固定对齐在 `Date` 正下方并按每行最多 `14` 个字符覆盖换行；桌面签字页右侧签字区收成固定宽度与更低的签字高度，避免真实浏览器里继续横向失控 ✅ 2026-04-28
- [x] 收据管理新增“生成签名收据”流程：在项目内先录入 `ORDER NO + USD Amount`，创建一条 `SIGNING_PENDING` 收据并原子分配真实 `receiptNo`，再进入桌面新窗口/手机全屏签名页完成双签名；最终自动生成 PNG、写入 NAS、下载到本地，并把图片挂回同一条收据记录 ✅ 2026-04-27
- [x] 新增 `ReceiptGeneratorSession + SystemCounter` 数据模型，并把 `Receipt.receiptNo` 升级为全局唯一、从 `0001000` 递增的后端原子编号 ✅ 2026-04-27
- [x] `SIGNING_PENDING` 业务隔离落地：未完成签名的收据不能进入正常 receipt/detail/swift/mark-received 链路；新增 `receipt-generator` read/write service、API、签名页与 isolated API 回归 ✅ 2026-04-27
- [x] 修复隔离测试脚本在 macOS 上的 `mktemp` 模板兼容性问题，恢复 `test:ci` 中 API/E2E 串联执行稳定性 ✅ 2026-04-27
- [x] 签名收据模板正式对齐 DMD HTML：冻结 logo / watermark / 版式几何参数，替换旧简化 canvas，桌面和导出 PNG 改用正式模板壳；手机端签字切为同页单签字框全屏白底模式，增加浅灰英文方向水印与左上角全屏/横屏辅助入口；Playwright 新增桌面弹窗签字与手机同页签字闭环 ✅ 2026-04-28
- [x] 收口签名收据剩余版式问题：`Tel:` 固定标签区改为每行最多 14 字符且不推动后续布局；导出前按签名字迹边界裁切，消除最终收据里的“虚线/发虚”笔迹；手机签字页进一步改成无滚动的全屏白底签字模式，背景提示直接落在签字区，底部 `Complete` 固定可见；同步补齐 `receipt-canvas / signing-view / receipt-generator.spec.ts` 回归并重新跑通 `test:ci` ✅ 2026-04-28

- [x] `INV` 页面权限收敛：`SALES` 改为账单页整页只读，前端隐藏新建/导入/rematch/改日期/加单/改单/删单，后端 `POST/PUT/DELETE /api/invoice` 统一改为 `ADMIN` only ✅ 2026-04-27
- [x] 账单客户解析双阶段兜底：`resolveCustomer(...)` 新增 `customerOrderNo + ownerIds`，账单创建/导入/改单/加单/rematch 在 `MARK` 精确匹配失败后，改为按 `ORDER_NO` 左半部分精确匹配客户 `ORDER_NAME`，并受当前权限树可见范围约束 ✅ 2026-04-27
- [x] 收据管理 `INV NO` 建议增强：直接创建与 OCR 确认创建在输入 `ORDER` 后，优先使用数据库里的精确 `ORDER` 命中发票；若同一 `ORDER` 命中多条发票，则自动选最新一条并标红提醒人工核对；仅在数据库无结果时才回退 OCR 的 `INV NO` ✅ 2026-04-27
- [x] 设置页 `OCR_API_KEY` 输入框改为非密码管理器字段，增加显示/隐藏切换并抑制 Chrome“是否保存密码”的误提示 ✅ 2026-04-27

- [x] 收据管理“完成/签收”权限与状态机收敛：仅 `ADMIN` 可执行 `mark-received`；不再要求先进入 `Bank_Transfer`；管理员可直接确认单条收据完成，同时保留“若某 `Detail` 下挂多条收据，则必须全部收据完成后才推进 `Detail/SWIFT -> RECEIVED`”的链路规则 ✅ 2026-04-27
- [x] 补齐回归：新增 `receipt-service` 单测与 `receipt-detail-swift-lifecycle` isolated API 断言，覆盖 `SALES` 禁止完成、管理员提前完成单条收据、单收据链路直接收口、多收据链路延后收口 ✅ 2026-04-27

- [x] 账单管理 `REMATCH` 新增“单条需修复订单重新解析”：对 `customerId = null && needsCustomerFix = true` 的可见订单，rematch 末尾会重新执行一次 `resolveCustomer(...)` 并只更新当前订单本身 ✅ 2026-04-27
- [x] 补齐回归：新增 `invoice-service` 单测与 `invoice-ledger-flow` isolated API 断言，覆盖“先建订单、后建客户、再 rematch 自动补客户”链路 ✅ 2026-04-27
- [x] 收据管理“直接创建收据”新增上传图片入口：复用受保护的 `/api/upload-image` 上传链路，图片按 `receipt-direct -> receipts/direct` 分类写入 NAS 挂载目录，并在 `direct-create` 创建时关联到收据记录 ✅ 2026-04-27
- [x] Docker 上传目录切换到 NAS bind mount：`/app/upload` 从 Docker named volume 改为宿主机 `UPLOAD_HOST_DIR`，默认指向 `/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload`，并保留历史图片迁移步骤 ✅ 2026-04-27
- [x] 收据管理“直接创建收据”弹窗字段顺序调整为 `ORDERNO -> INVNO -> 客户MARK -> 付款金额USD`，并补齐组件/Hook/API 回归测试 ✅ 2026-04-27

- [x] 修复 GitHub Actions 中发票归属分配 Playwright 用例的原生 alert 脆弱性：改为注入 alert 捕获并断言文案，隔离 E2E 重新通过 ✅ 2026-03-30

- [x] 继续扫清客户手机号冲突提示的 i18n 漏点：`customer` API 的嵌套 `phoneConflictMessage` 现在也按请求语言本地化，隔离 API 新增英文断言 ✅ 2026-03-30
- [x] 修复客户手机号冲突提示 i18n 漏洞：英文界面下客户列表 tooltip、客户编辑弹窗和保存后 alert 不再直接显示服务端中文文案，而是统一走前端当前语言文案 ✅ 2026-03-30
- [x] 客户手机号规则收敛：允许手机号重复，不再把 `PHONE` 作为硬冲突；仅保留 `MARK + NAME` 为客户硬重复规则，并在创建/编辑/导入/修复链路统一生效 ✅ 2026-03-30
- [x] 客户管理冲突可视化：客户列表与客户编辑弹窗对同绑定池手机号冲突做红色提示，前端对保存异常补齐显式提示，不再只在浏览器控制台暴露 ✅ 2026-03-30
- [x] Playwright 闭环补齐：新增“账单分配给分支 ADMIN”前端回归，以及 Dashboard 报表导出成功摘要断言 ✅ 2026-03-30
- [x] 账单管理新增发票归属分配：支持 ADMIN 将某个发票及其全部订单直接重分配给下级分支 ADMIN，归属更新在同一事务内完成并写入审计 ✅ 2026-03-30
- [x] 修复 SALES 对绑定客户的业务数据可见性：`invoice/receipt/detail/swift/report` 改为按 `customer.ownerId` 判断客户绑定，不再错误依赖 `customer.createdBy` ✅ 2026-03-30
- [x] 账单管理前端新增 ADMIN 专用分配入口：使用现有用户树推导当前管理员的下级 ADMIN 候选，并提交 `assignBranchAdmin` 动作 ✅ 2026-03-30
- [x] isolated API 回归补齐：新增“发票分配到分支 ADMIN + SALES 查看绑定客户账单/收据/明细/SWIFT”链路断言 ✅ 2026-03-30

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
- [x] 增加请求体大小限制（Next.js + Caddy 双层，防 DoS）✅ 2026-03-30
- [x] 对高风险写接口增加速率限制（登录、上传、删除审批）✅ 2026-03-30

### v1.0.108（2026-04-30）
- `UploadedAsset` 现在是上传文件生命周期的唯一台账：服务端成功写入 NAS 后立即登记为 `STAGED`，业务最终确认时提升为 `ATTACHED`，维护任务删除后标为 `DELETED`。
- 新增 `/api/internal/maintenance/uploaded-assets` 内部维护路由，使用 `x-maintenance-token` 鉴权；Docker maintenance 服务按 24h 周期调用它，避免依赖宿主机 cron 或进程内定时器。
- 维护任务拆成两段策略：一段只清理过期 `STAGED` 资产并删 NAS 文件，另一段只处理超过 72h 的 `SIGNING_PENDING` 签名会话，先把会话标成 `CANCELLED`，再删除仍未进入正常业务状态的占位收据。
- 本次没有做历史文件回填；维护任务只会处理已经登记到 `UploadedAsset` 的新资产，避免对老数据做不安全的猜测式删除。

### v1.0.109（2026-04-30）
- 修复 Excel ML token 生成/校验协议中的分隔歧义。旧实现把 `_` 同时用作分隔符和 base64url 内容字符，导致极少数 token 在 `/api/excel/ml` 校验时会错误拆出 `tokenPrefix`，进而返回 `EXCEL_TOKEN_INVALID`。
- 新 token 改为十六进制编码，仍沿用 `ml_<prefix>_<secret>` 结构但不再产生 `_` 内容；`verifyExcelApiTokenFromHeader()` 同时兼容旧版 11/43 长度的 base64url token，避免让已发出的 token 失效。
- 针对这条问题补了最小回归：`excel-token-service` 单测新增“legacy secret contains underscores”覆盖，主仓重新跑通 `test:ci + build` 后再推送。

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
- [x] 为核心写接口补事务边界审计（create/update/delete 全链路）✅ 2026-03-11
- [x] 为关键读接口补统一 service 边界与读审计基线（用户/客户/客户修复/账单/报表/设置）✅ 2026-03-12
- [x] 统一 API 错误码与错误结构（`code/message/detail`），完成剩余前端字符串消费与旧路由改造 ✅ 2026-03-11
- [x] 将关键阈值配置化（如 SWIFT 容差 ±5/±50）并纳入 `/api/settings` ✅ 2026-03-11
- [x] 补充配置变更审计日志（记录配置前后值 + 操作人，敏感值脱敏）✅ 2026-03-11
- [x] 多语言二期：API 错误与核心成功消息统一下沉到服务端字典，前端不再依赖原始字符串映射 ✅ 2026-03-11
- [x] 成功消息三期：继续把读接口/模板下载/批处理导出摘要下沉到服务端字典（customer/invoice/settings/report）✅ 2026-03-11
- [x] 配置审计补齐独立导出历史：记录导出操作者、筛选条件、导出条数、服务端上限、是否截断 ✅ 2026-03-11

### 测试覆盖
- [x] 覆盖 `deletion` 审批分支单测（RECEIPT/DETAIL/SWIFT 关键申请/审批/回退分支）✅ 2026-03-11
- [x] 覆盖 `swift` 金额容差分支单测（正常/警告/拒绝）✅ 2026-03-11
- [x] 增加 Playwright API 驱动用例（优先 API，不依赖手工 UI 点击）✅ 2026-03-10
- [x] 设置审计导出历史补齐 service/hook/API 回归，并将 `use-invoice-actions / use-customer-actions` 再纳入更高一轮 coverage 门禁 ✅ 2026-03-11
- [x] `use-invoice-actions / use-customer-actions` 再补一轮失败/早退/空结果分支测试，并把两项局部门禁继续小步上调 ✅ 2026-03-12
- [x] `settings` 页面级读模型继续收口，补齐 `use-settings-actions / customer-read-service / invoice-read-service` 边界分支并继续小步上调门禁 ✅ 2026-03-12
- [x] 继续补齐读路径与审计导出边界：`settings-read-service` 新增 clamp/异常 metadata/负数导出上限边界测试，`report-service` 新增 PDF/Excel 导出审计回归，并将 `settings-read-service` 与 global 门禁再小步上调 ✅ 2026-03-12
- [x] 继续补齐 `settings-write-service / report-service` 边界与报表导出 UI 闭环：新增清库参数校验/无变更/非法数值/合法布尔值更新、Excel fallback/PDF 截断/导出摘要、Dashboard 导出下载与成功提示 Playwright 回归，并抬高两项局部门禁 ✅ 2026-03-12

## P2（持续迭代）

### 功能增强
- [ ] 通知系统（删除审批、异常金额、签收完成）
- [ ] 报表增强（按客户/时间维度聚合，支持 CSV）
- [ ] 客户信息修复模块支持批量处理
- [ ] 增加数据归档策略（历史数据只读、查询加速）

### 运维与监控
- [ ] 接入 Sentry（前后端异常聚合）
- [ ] 接入 Prometheus + Grafana（接口成功率、耗时、错误率）
- [x] 完成腾讯云 COS 数据库 + NAS 媒体真实恢复演练，使用隔离 MariaDB/应用验证并记录媒体完整性发现项 ✅ 2026-07-17

### 文档与交付
- [ ] 补全 API 文档（可选 OpenAPI）
- [ ] 输出部署手册（开发/预发/生产）
- [ ] 输出故障排查手册（数据库连接、OCR失败、上传失败）
- [ ] 输出 i18n 规范（文案 Key 命名、目录分层、审计基线、提测门禁）

---

## 已完成里程碑摘要

- v1.0.110（2026-05-04）：收据/付款明细图片上传弱网链路统一工程化。新增 `UserPreference` 表与 `user-preference-service`，把图片压缩开关、质量下限、OCR 目标大小做成按账号持久化设置，并在设置页增加独立的用户级压缩卡片；前端新增共享 `business-image-upload` 管线，把 `Create Receipt Directly`、`Upload Receipt`、`Upload Payment Detail` 统一到同一套本地预压缩、上传进度、`15s` 空闲超时、`120s` 总时长兜底与错误映射；收据管理移动端按钮重排为 `Upload Receipt -> Create Directly -> Generate Signed Receipt`，`Create Directly` 选图后改成 sticky 头部 + 有界大图确认页；同时修复 receipt/detail OCR 在 `settings?view=user-preferences` 卡住时会阻塞上传、以及 malformed/empty 2xx OCR payload 会被误判为成功的问题，并通过新增 hook/service/UI 回归把 coverage 与 `test:ci` 一并收回到稳定状态
- v1.0.107（2026-04-30）：`Create Receipt Directly` 图片上传入口从“选图即上传”调整为“两步确认”。新增 `PendingDirectImageSelection` 前端状态与 `receipt-direct-image-confirm-dialog`，用户在拍照/相册返回后先进入项目内大图确认页，点击“确认上传”才触发原有压缩、`XMLHttpRequest` 进度条、`15s` 空闲超时和 `120s` 总时长兜底链路；为此重构 `use-receipt-actions` 中 direct-image 流程，新增待确认图预览、确认上传和失败重试路径的自动化测试，并重新跑通 `build` 与 `test:ci`
- v1.0.101（2026-04-28）：继续修正签名收据模板中段和签字页的约束问题；`receipt-canvas` 预览层中部正文盒移除错误的 `flex: 1`，防止收据预览在弹窗/窄布局下把中段和签名区异常拉高；`signing-view` 的桌面两列改为 `items-start` + 右侧签字列 `self-start`，避免签字列跟随左侧预览列被拉伸；手机签字模式继续压缩为固定矮白色签字带，黑色非签字区域与固定顶部/底部操作栏保持不滚动；同时新增回归测试校验金额标签间距、正文值起始位置和桌面签字列不被拉伸，整套 `build`、`test:ci`、isolated API 与 isolated Playwright 再次跑通
- v1.0.100（2026-04-28）：继续对齐签名收据模板的中段与移动签字页体验；`receipt-canvas` 头部电话区改为固定 `Tel:` 标签 + 固定高度内容盒，内容按每行 14 字符硬切分且只向下覆盖，不再影响标题、金额区和正文；导出层正文不再按全局最大标签列对齐，改成每一行的值都从自身标头的 `: ` 后开始，`Motif` 靠左、`Frais : Paid` 继续固定到右侧；手机签字页改成黑底 + 居中窄白签字带布局，非签字区域全部黑底，顶部控制与底部 `Complete` 全程固定可见；同时调高签字线宽并保留 alpha 裁切，改善最终收据中笔迹发虚/虚线感；整套 `test:ci`、isolated API 与 isolated Playwright 重新跑通
- v1.0.99（2026-04-28）：继续收口签名收据模板与手机签字体验；`receipt-canvas` 的 `Tel:` 头部改为固定 `Tel:` 标签 + 每行最多 14 字符的固定高度内容区，长号码只向下覆盖、不再推动标题、金额框和正文表格；正文 `Motif` 行改为值紧跟 `: ` 开始，`Frais : Paid` 始终吸附在行最右端；签名导出前增加按 alpha 边界裁切，消除最终 PNG 里笔迹因整张透明画布缩放而出现的虚线/发虚问题；手机签字页改为真正无滚动的全屏白底专用布局，提示水印直接作为签字背景层，底部 `Complete` 固定可见；同时修正桌面签字弹窗 Playwright 的稳定点击方式，重新跑通 `test:e2e:isolated` 与 `test:ci`
- v1.0.98（2026-04-28）：继续收口手机签字页与收据头部排版；移动端签字模式改成真正的全屏白底专用界面，顶部只保留 `Back / Fullscreen / Clear`，底部固定 `Complete`，并在用户未确认返回时保留本地签字草稿，下次进入可继续签；`receipt-canvas` 的 `Tel:` 头部改为固定标签 + 可在空格、斜杠、长数字串中强制断行的内容区，避免长电话号码把头部布局顶坏；同步补齐 `signing-view` 和 `receipt-canvas` 回归，并重新跑通 `test:ci`
- v1.0.97（2026-04-28）：继续修正签名收据模板与手机签字细节；`receipt-canvas` 改为按内容动态扩展详情区与签字区高度，导出 PNG 不再截断收款方/付款方签名；删除签名页多余旋转控件，右上电话信息改为自动换行，手机竖屏预览改成整张收据按比例缩放而非压缩内部元素；`signing-view` 终态提交改为显式 `data:` URL 转 Blob，修复微信/移动端浏览器卡在 `GENERATING...` 的问题；`Reçu de M./Mme.` 现在优先显示 `COMPANY_NAME + "MARK"`，为空时回退 `CUSTOMER_NAME + "MARK"`；签名板导出透明 PNG，不再以白底遮挡收据正文；补齐 `receipt-generator-layout / receipt-generator-read-service / receipt-generator-service / receipt-canvas / signing-view / data-url` 回归测试并重新跑通 `test:ci`
- v1.0.96（2026-04-28）：签名收据模板正式切换到 DMD HTML 固定样式，冻结左右 logo、底部水印和版式几何；替换旧简化 `receipt-canvas` 预览/导出壳，补齐收据编号橙色与签字下划线细节；手机端签字改为同页单签字框白底全屏模式，新增浅灰英文方向水印、左上角全屏/横屏辅助入口，并移除过时的旋转按钮提示；Playwright 增加桌面弹窗签字和手机同页签字闭环，`receipt-generator` E2E 扩展到双端真实流程
- v1.0.95（2026-04-27）：修复隔离测试脚本的跨平台 `mktemp` 用法，将 API/E2E 隔离脚本统一改为同时兼容 macOS 与 Linux 的临时文件模板，恢复 GitHub Actions 中 `test:ci` 的稳定性；同步更新 README / 里程碑 / 工程流水版本号
- v1.0.94（2026-04-27）：收据管理新增“生成签名收据”完整链路：新增 `SIGNING_PENDING` 收据状态、`ReceiptGeneratorSession` 会话表与 `SystemCounter(RECEIPT_NO)` 原子编号器，`Receipt.receiptNo` 改为真实后端唯一号并从 `0001000` 递增；新增 `/api/receipt-generator` 读写接口与 `/receipt-generator/[sessionId]` 签名页，桌面端用新窗口、手机端用全屏签名页完成双签名；签名前先创建收据记录，签名完成后自动生成 PNG、写入 NAS 的 `receipts/generated/YYYY/MM` 目录、下载到本地，并将最终图片挂回收据记录；同时对 `SIGNING_PENDING` 收据加业务隔离，阻止其提前进入 receipt/detail/swift/mark-received 链路；新增 `receipt-number / receipt-generator-layout / receipt-generator-read-service / receipt-generator-service` 单测和 `receipt-generator-flow` isolated API 闭环

- v1.0.93（2026-04-27）：`INV` 管理对 `SALES` 改为整页只读，并把账单所有写接口统一收紧到 `ADMIN`；`resolveCustomer(...)` 新增 `customerOrderNo + ownerIds`，账单创建/导入/改单/加单/rematch 在 `MARK` 匹配失败后会再按 `ORDER_NO` 左半部分精确匹配客户 `ORDER_NAME`；新增 `invoice-read-service` 的 `action=order-context`，收据管理在直接创建与 OCR 确认创建时输入 `ORDER` 后可优先得到数据库中的 `INV NO` 建议，多命中时自动选最新一条并标红提醒；同时将设置页 `OCR_API_KEY` 输入改为非密码管理器字段，消除 Chrome 保存密码误提示；补齐 `use-invoice-order-forms / use-receipt-forms / system-config-card / invoice-service / invoice-write / invoice-read-service / client` 回归与 `invoice-ledger-flow` isolated API 断言
- v1.0.91（2026-04-27）：账单管理 `REMATCH` 增加“单条需修复订单重新解析”；对 `customerId = null && needsCustomerFix = true` 的订单，在 rematch 末尾重新执行一次客户解析并仅回填当前订单；新增 `invoice-service` 单测与 `invoice-ledger-flow` isolated API 断言，覆盖“先建订单、后建客户、再 rematch 自动补客户”的真实链路
- v1.0.89（2026-03-30）：补齐当前版本基线剩余的两项安全硬化：新增 Next.js + Caddy 双层请求体大小限制，防止超大 JSON/上传请求直接压垮应用；对登录、上传识别、删除申请/审批加入统一速率限制，并把 `REQUEST_TOO_LARGE / RATE_LIMITED` 纳入错误码目录、系统配置、单测、isolated API 回归与本地 Docker/Caddy 验证链路
- v1.0.87（2026-03-30）：继续做同类多语言风险扫尾；`customer` API 的嵌套 `phoneConflictMessage` 现在也通过 `localizeApiSuccessMessage` 按请求语言本地化，`customer-import-and-scope` isolated API case 新增英文 locale 断言，确认外部 API 调用拿到的冲突提示不再固定中文
- v1.0.86（2026-03-30）：修复客户手机号冲突提示的 i18n 回退问题；客户列表 tooltip 不再读取服务端中文 `phoneConflictMessage` 直接展示，`use-customer-actions` 在保存后对手机号冲突也改为使用当前语言的前端文案；补齐英文界面的 `customer-form-dialog` 和 `use-customer-actions` 回归测试，并重新验证构建通过
- v1.0.85（2026-03-30）：客户手机号规则继续收敛；后端与导入/修复链路允许手机号重复，仅 `(MARK + NAME)` 继续作为硬冲突；客户列表与编辑弹窗新增手机号冲突红色提示与悬浮说明，`use-customer-actions` 补齐保存异常提示，避免仅在控制台暴露；新增 `customer-scope / customer-read-service / customer-form-dialog / use-customer-actions` 回归测试、`invoice-branch-assignment.spec.ts` Playwright 闭环，以及报表导出成功摘要前端断言；本地与隔离回归均通过
- v1.0.82（2026-03-13）：修复 workspace 路由别名冲突导致的设置页重复点击卡住问题；`/settings` 不再被误判为 `users` 视图，侧边栏同页点击增加 path 级短路保护；新增 `routes.test.ts` 覆盖 `/settings -> settings` 的回归断言

- v1.0.81（2026-03-12）：将 `todolist.md` 正式拆分为“用户可读里程碑”与“纯工程内部流水”两层文档；新增 `ENGINEERING_LOG.md` 保存详细技术变更、测试门禁、服务分层与模块拆分记录；README 文档入口同步调整，主文档继续仅保留用户应阅读内容

- v1.0.77（2026-03-12）：继续补齐 `settings-write-service` 与 `report-service` 边界，新增非管理员全库清空拒绝、缺少目标账号/密码、空模块集、目标账号不存在、无变更、非法数值与合法布尔值更新等分支；`report-service` 新增 Excel fallback 字段为空、PDF 多行收据分页截断、导出计数审计回归；新增 `dashboard-report.spec.ts`，稳定验证 Dashboard 报表导出下载与成功摘要弹窗；coverage threshold 第二十五次提升，将 `settings-write-service` 提升到 `65/80/75/75`，并将 `report-service` 首次纳入 `80/100/90/90`；Jest 扩展到 `38 suites / 290 tests`

- v1.0.76（2026-03-12）：继续补齐 `settings-read-service` 的审计导出边界，新增“审计能力最小值 clamp、负数 exportLimit 回退为 1 并触发 truncated、导出历史异常 metadata 归一化”等测试；`report-service` 新增 PDF 导出计数审计与 Excel 可见范围/汇总回归；coverage threshold 第二十四次提升到 `64/84/82/80`，并将 `settings-read-service` 提升到 `80/97/95/90`；Jest 扩展到 `38 suites / 279 tests`

- v1.0.75（2026-03-12）：`settings` 继续新增 `page-view-model.ts`，把页面标题、版本号、告警态、用户管理可见性与审计展示模型统一收口；`use-settings-actions` 补齐设置加载失败、审计/导出历史加载失败、导出失败/summary 回退、保存配置失败、OCR 成功/失败、密码字段不完整/后端失败等分支；`customer-read-service / invoice-read-service` 分别补 sales 扩展字段可见与普通 INV 创建时间降序排序分支；coverage threshold 第二十三次提升到 `63/84/81/79`，其中 `use-settings-actions` 提升到 `55/98/80/80`、`customer-read-service` 提升到 `80/100/97/97`、`invoice-read-service` 提升到 `85/100/97/97`，并新增 `page-view-model` 的满额局部门禁；Jest 扩展到 `38 suites / 274 tests`

- v1.0.74（2026-03-12）：`settings` 审计前端继续分层，新增 `view-model.ts` 统一生成审计摘要、导出历史摘要、导出选项与行级展示文本，`settings-audit-card.tsx` 不再直接拼接原始 API 行结构；设置审计筛选表单补齐 `htmlFor + id + data-testid` 可访问性；新增稳定 Playwright 闭环，覆盖“设置筛选 + 加载更多 + 导出 CSV + 导出历史”；继续补齐 `use-invoice-actions / use-customer-actions` 的失败、早退、空结果回退分支测试，并把两项门禁提升到 `75/90/85/85` 与 `60/81/70/70`；Jest 扩展到 `37 suites / 258 tests`

- v1.0.73（2026-03-12）：`settings` 前端读路径继续收口，新增 `read-model.ts` 统一处理审计元信息、默认筛选、分页/导出上限 clamp 与 bootstrap/audit/export-history 响应归一化，减少设置页对混合响应结构的直接依赖；继续补齐 `use-settings-actions` 的改密码异常、清库未选模块、清库请求异常分支测试，以及 `settings-service / customer-read-service / invoice-read-service` 的关键读路径边界测试；coverage threshold 第二十一次提升到 `62/84/80/78`，其中 `use-settings-actions` 提升到 `50/95/72/72`、`customer-read-service` 提升到 `75/100/95/95`、`invoice-read-service` 提升到 `80/100/95/95`

- v1.0.80（2026-03-12）：README 重写为用户手册首页，移除大段技术栈、API、数据库、工程流水和细粒度更新日志，只保留角色、模块、日常流程、启动方式、配置审计说明和版本入口；技术变更记录继续保留在 `todolist.md`，工程规范继续保留在 `CHANGE_CHECKLIST.md`

- v1.0.79（2026-03-12）：新增根目录工程变更清单 `CHANGE_CHECKLIST.md`，按“改业务逻辑、加模块、改页面、改接口、改配置、改数据库、纯文档变更”分别给出必须同步做的测试、文档、版本、git、CI 和本地服务动作；`README.md` 已补齐入口，后续流程不再依赖口头约定

- v1.0.78（2026-03-12）：workspace 切页体验继续优化，侧边栏新增 `router.prefetch + API 数据预热`，高频模块默认首屏数据改为“先吃热缓存、再后台刷新”；侧边栏按钮补齐即时 pending 动效与 `Opening` 文案，workspace 主内容区顶部新增进度条，右侧 loading fallback 改为 skeleton，避免“空白转圈”观感；新增 `client.ts` 预热缓存单测、`settings/read-model` 单测，并补齐 `use-invoice-view-state / use-deletion-actions / use-settings-actions` 的 cached 分支回归，Jest 扩展到 `39 suites / 299 tests`

- v1.0.72（2026-03-12）：继续补齐设置读接口的关键分支与审计闭环；`settings-read-service` 新增无权限、非法日期、导出历史过滤/游标等测试，`settings-and-report` isolated API case 新增审计分页元信息、过滤结果与导出头校验；`customer-read-service / invoice-read-service` 分支回归继续覆盖非 manager 拒绝、精确 MARK 过滤、admin 搜扩展字段、alias 命中但订单不存在、账单余额计算与特殊 INV 排序；coverage threshold 第二十次提升到 `61/83/79/77`，其中 `settings-read-service` 提升到 `70/96/90/90`、`customer-read-service` 提升到 `70/100/90/90`、`invoice-read-service` 提升到 `75/100/95/95`

- v1.0.71（2026-03-12）：移除页面底部永久悬浮版本号，版本信息只保留在设置页顶部；修复设置页“配置变更审计”因 effect 依赖循环导致的持续刷新；新增 `settings-read-service / settings-write-service`，将 `/api/settings` 继续拆成明确读写边界；补齐 `customer-read-service / invoice-read-service` 分支回归与设置页 Playwright 可视回归，coverage threshold 第十九次提升到 `60/82/78/76`，其中 `customer-read-service` 提升到 `60/100/85/85`、`invoice-read-service` 提升到 `60/58/85/85`、`settings-write-service` 提升到 `55/70/65/65`
- v1.0.70（2026-03-12）：`settings` 关键读接口补齐读审计基线，`listSettings / listSystemSettingsAuditLogs / listSystemSettingsAuditExportLogs` 开始区分记录配置总览、审计列表和导出历史列表读取；继续补齐 `use-customer-actions` 与 `customer-fix-service` 分支回归，覆盖非管理员删除短路、取消确认、`issueRows` 回退导入、跨 sales 修复拒绝、命中既有客户走 update、异常事务错误映射等场景；coverage threshold 第十八次提升到 `58/81/76/74`，其中 `use-customer-actions` 提升到 `55/80/60/60`、`customer-fix-service` 提升到 `55/80/80/80`
- v1.0.69（2026-03-12）：关键读接口开始统一分层，新增 `auth-read-service / customer-read-service / customer-fix-read-service / invoice-read-service / report-service`；`/api/auth /api/customer /api/customer/fixes /api/invoice /api/report` 的关键查询改为路由薄层 + read service，补齐用户列表/上级候选、客户列表/归属候选、客户修复队列、账单列表/订单候选/订单收据、报表导出的读审计基线；同时补齐 `customer-service / invoice-service` 分支回归与新增 read service 单测，coverage threshold 第十七次提升到 `57/80/75/73`，其中 `customer-service` 提升到 `50/55/65/65`、`invoice-service` 提升到 `50/55/60/60`
- v1.0.68（2026-03-11）：补完核心写接口全链路事务边界审计；新增 `auth-service / customer-service / customer-fix-service / init-service`，并将 `/api/auth /api/customer /api/customer/fixes /api/init` 收敛为薄路由；低层写路径继续补事务化，`matching / receipt-service / detail-service / invoice-service(rematch)` 统一支持在事务客户端内写入；新增 `auth-service / customer-service / customer-fix-service / init-service / invoice-service(rematch)` 单测与 `customer-fix-flow` isolated API case，coverage threshold 第十六次提升到 `56/79/74/72`
- v1.0.67（2026-03-11）：本地运行容器直接更新到远端最新代码并验证容器内版本已切到 `1.0.67`；服务端成功摘要继续扩到 `customer/invoice` 的读接口与模板下载；设置审计新增游标分页状态展示、独立导出历史查询与前端历史表格，并在导出时记录操作者/筛选条件/导出规模；`settings-service / use-settings-actions / use-invoice-actions / use-customer-actions / api-success-catalog / settings-and-report isolated API case` 回归补齐，coverage threshold 第十五次提升到 `55/79/73/71`，其中 `use-invoice-actions` 提升到 `70/88/80/80`、`use-customer-actions` 提升到 `45/70/55/53`
- v1.0.66（2026-03-11）：设置页最上方新增当前版本号展示，版本仍以 `package.json#version` 为唯一来源；服务端成功消息继续扩展到 `auth` 用户管理查询/创建动作、配置审计列表与 CSV 导出、报表导出摘要；设置页前端新增配置审计导出摘要/超限提示展示；补齐 `invoice-service / use-settings-actions / use-user-actions / api-success-catalog` 回归，coverage threshold 第十四次提升到 `54/78/72/70`，其中 `invoice-service` 提升到 `45/50/52/50`、`use-settings-actions` 提升到 `45/93/70/70`
- v1.0.65（2026-03-11）：前端底部版本号改为直接显示 `package.json#version`，登录页与 workspace 页面统一可见；服务端成功消息继续扩展到客户导入/账单导入/重匹配/余额转移/OCR 配置测试等批处理提示；设置页配置审计新增服务端 `auditCapabilities` 元信息、`SETTINGS_AUDIT_MAX_PAGE_SIZE / SETTINGS_AUDIT_EXPORT_MAX_ROWS` 配置化与 `exportLimit` 导出控制；新增 `invoice-write` 与 `settings-service` 关键分支回归，coverage threshold 第十三次提升到 `53/77/71/69`，其中 `invoice-write` 提升到 `60/90/80/80`、`settings-service` 提升到 `45/60/55/55`
- v1.0.64（2026-03-11）：服务端成功消息开始统一字典化，新增 `api-success-catalog + api-success-response + api-response-locale`，并将 `auth/init/settings/invoice/deletion/customer-fixes/receipt/detail/swift` 这批成功响应接入请求级本地化；设置页配置审计新增分页大小与 CSV 导出；新增 `api-success-catalog.test.ts` 与 `settings-service / use-settings-actions / use-invoice-actions / invoice-service / invoice-write` 回归，coverage threshold 第十二次提升到 `52/76/70/68`，其中 `use-invoice-actions` 提升到 `60/80/65/65`、`invoice-service` 提升到 `42/40/49/46`
- v1.0.63（2026-03-11）：服务端错误字典继续下沉到 `api-error-catalog + api-error-response`，后端开始按 `NEXT_LOCALE / Accept-Language` 直接返回本地化错误；设置页配置审计新增按操作者/配置键/时间范围筛选；前端 workspace API client 改为优先保留服务端详细错误，再用错误码兜底；新增 `api-error-catalog.test.ts` 与更多 `settings-service / use-settings-actions / use-customer-actions / invoice-service` 回归，coverage threshold 第十一次提升到 `50/75/69/67`，其中 `customer-actions` 提升到 `40/65/50/50`、`invoice-service` 提升到 `39/38/47/44`
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
- 前端版本号统一读取 `package.json#version`，并仅在设置页顶部展示；不要再恢复永久悬浮页脚/底栏版本号。
- 新需求先判断是否需要配置化，能配置的优先进入系统设置。
- 需要人工验证的流程优先封装成 API 脚本或自动化用例再交付。
