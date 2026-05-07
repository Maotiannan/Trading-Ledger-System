# 收汇管理系统里程碑

> 面向用户的版本里程碑与后续计划  
> 当前版本：v1.0.132
> 最后更新：2026-05-07

## 当前状态

系统当前已经稳定覆盖这些核心业务：
- 客户管理与权限隔离
- 账单、收据、付款明细、SWIFT 全链路录入
- 删除审批与配置变更审计
- 批量导入、问题行修复、模板下载
- 设置页版本号、系统配置和分支清库
- 生成签名收据、签名前临时状态隔离、签名后自动挂图
- 临时上传图片的 24h 孤儿清理，以及签名收据 `SIGNING_PENDING` 72h 超时清理
- 收据管理的 `SALES` 修改审批流：销售提交修改申请，管理员在可见范围内审批；管理员可直接修改
- 付款明细与 SWIFT 的 `SALES` 修改审批流：销售提交修改申请，管理员在可见范围内审批；管理员可直接修改
- 工程维护已明确数据安全规则：日常只重建 app 容器，不使用会删除数据库或 Docker volume 的破坏性命令；数据库结构变更前必须先说明迁移、回滚和数据风险

## 已完成的主要里程碑

### 1. 核心业务链路稳定可用
- 账单、收据、付款明细、SWIFT 已形成完整业务闭环
- 订单匹配、余额计算、签收、删除审批等关键流程已修复并稳定
- 图片上传、图片预览、批量导入、问题行重试已可直接在系统内完成

### 2. 权限模型与数据隔离落地
- 已完成 ADMIN / admin / sales / user 分层权限模型
- 同级可见不可管、下级可管、旁支不可管理已生效
- 客户、账单、收据、明细、SWIFT 的可见范围已按权限树和归属规则隔离

### 3. 配置化与审计能力落地
- 关键阈值已进入 `设置 -> 系统配置`
- 配置变更审计已支持查看、筛选、导出、导出历史
- 设置页顶部固定显示当前系统版本号

### 4. 页面结构与切换体验优化
- 前端已完成模块化拆分，不再依赖单一巨型页面
- 菜单切换改为局部加载，不再整页白屏
- 常用页面已增加预取、缓存和 skeleton，切换速度明显改善

### 5. 自动化测试与 CI 已形成基线
- 关键业务流程已有 API 自动化回归
- 关键页面已有稳定的 Playwright 闭环
- GitHub Actions 已接入类型检查、构建、单测、API/E2E 回归

## 当前版本重点

### v1.0.132
- `Receipt Management / Payment Detail Management / SWIFT Management` 手机端筛选区改为收纳式：顶部只保留搜索框和筛选按钮，`Receipt` 额外保留外部查询按钮；桌面端仍保持完整横向筛选布局。
- `Customer Management` 的 `ORDER_NAME` 支持点击查看历史。弹窗会展示该 ORDER_NAME 下的历史订单、发票号、金额和未收金额；桌面端右侧同步展示该客户最近收据与状态，手机端单列滚动展示。
- `Create Invoice` 弹窗底部操作区重排，把 `Add Order / Cancel / Create` 放在同一个底部区域，并优化手机端输入行，避免底部按钮背景遮挡订单信息。

### v1.0.131
- `SWIFT Management -> Upload SWIFT Record` 支持 PDF 识别。多页 PDF 会先由后端联合解析整份文件，再交给 AI 回填金额、日期、付款人、付款人地址、收款人和收款账号。
- SWIFT 上传入口现在同时支持图片和 PDF；PDF 会暂存在 NAS 挂载目录，确认创建后再正式绑定到 SWIFT 记录，未确认的暂存文件继续走 24h 清理。

### v1.0.130
- `Upload Receipt` 上传图片到 `100%` 后，现在会继续展示后端 OCR 的真实阶段：AI 正在识别、AI 已回传内容、正在整理识别字段、识别完成请核对，减少“100% 后一直转圈”的误解。
- 客户/付款人显示规则抽成统一能力：优先 `COMPANY_NAME + "MARK"`，没有公司名时回退 `NAME + "MARK"`。`Generate Signed Receipt` 弹窗、收据创建入库、收据 OCR/直建建议、签名收据模板都使用同一规则。

### v1.0.129
- 收据录入命中复合订单时，会自动回填完整 `ORDER NO`。例如 `AB-13B` 命中系统订单 `AB-13B/AB-12B` 后，`Upload Receipt / Create Receipt Directly / Generate Signed Receipt` 都会继续使用完整订单号。
- 后端入库增加同样保护：即使直接调用 API 只传单段订单号，只要命中复合订单，收据记录也会保存系统完整 `ORDER NO` 并绑定到正确发票订单。
- 兼容旧的空格复合订单写法，如 `AB-13B AB-12B`；普通单订单名里的空格不会被误拆。

### v1.0.128
- `Upload Receipt` 在数据库没有发票建议时，不再清空 OCR 已识别出的 `INV NO`，避免 `Motif` 同时包含发票号和订单号时只剩 `ORDER NO`。
- OCR 识别提示与标准化解析补强：`Payment for L25MH060523 Big Alpha-07` 会拆成 `INV NO=L25MH060523` 和 `ORDER NO=Big Alpha-07`；只有订单号的场景继续只回填订单号。

### v1.0.127
- 修复手写收据 `Initial payment for Rahim-11` 这类场景：`Upload Receipt` 会从 `Motif / Payment for ...` 兜底提取 `ORDER NO`。
- `Initial payment` 不再被当成 `DEPOSIT`；上传识别后的 `DEPOSIT` 默认保持不勾选，必须由用户手动确认。
- 收据 OCR 日志新增标准化字段摘要，后续可直接在容器日志中查看 `receiptNo / orderNo / invNo / usd / isDeposit` 等排查信息。

### v1.0.126
- `Upload Receipt` 的 OCR 识别会保留识别出的 `ORDER NO`，避免未匹配发票时把订单号也一起清空；`INV NO` 仍按现有规则在无系统命中时留空等待管理员补录。
- `Upload Receipt` 的 `DEPOSIT` 默认改为不勾选，减少普通收据误入定金池的风险。
- `Receipt Management` 的每页条数选择移到底部分页区，和常见表格页面保持一致。
- `SWIFT Management` 新增管理员签收入口：管理员签收某条 `SWIFT` 后，关联的 `Payment Detail / Receipt / SWIFT` 会一起进入 `RECEIVED`；销售账号不能执行该动作。
- `Approval` 页面四类审批列表统一分页，每页 `20` 条，避免待审批数据多时页面过长。

### v1.0.125
- 收据图片预览现在显示绑定的 `ORDER NO / INV NO / 创建者`，不再显示文件名，也不再把收据号当作订单绑定信息。
- 收据修改新增 `ORDER NO` 字段：`SALES` 修改继续走审批，`ADMIN` 及以上直接保存；保存或审批通过时会重新绑定到正确订单和发票。
- 对落在 `Un_Associated / DEPOSIT_POOL` 的临时订单，管理员补录真实 `INV NO` 后会自动迁移到目标发票，便于修复未登记收据。

### v1.0.124
- 收据登记的订单匹配规则收紧：只保留精确 `ORDER NO` 和 `/` 复合订单分段匹配，避免 `AB-13B` 被误挂到 `AB-07` 这类同前缀旧订单。
- 未登记订单创建收据时，系统会按定金/非定金进入 `DEPOSIT_POOL / Un_Associated`，并强制清空 OCR 识别出来的 `INV NO`，等待管理员后续补录。
- 收据 `PAYER` 统一显示为 `COMPANY_NAME + "MARK"`，没有公司名时显示 `NAME + "MARK"`。
- `Receipt Management` 的 `Status Filter` 改为下拉菜单，点击“查询”后才刷新列表结果，减少页面顶部占用。

### v1.0.123
- `Payment Detail -> Export Pic` 的 `TYPE` 判断再次按业务语义收口：`Bank_Transfer / RECEIVED` 都视为 SWIFT 已生效，订单余额 `<= 5` 时显示 `Final`；如果第一笔付款同时也是最后一笔，也显示 `Final`。
- `Edit Payment Detail` 在 `RECEIVED` 前均可修改；编辑已有订单号时会匹配流程中的已有收据，不再误提示会新建收据。
- `Payment Agent Management` 弹窗改成桌面和手机都可完整操作的布局。

### v1.0.122
- 修正 `Payment Detail -> Export Pic` 的 `TYPE` 判断：`Final` 必须满足所属 detail 的 SWIFT 已到账且对应订单余额 `<= 5`；`Initial` 改为按该 `ORDER NO` 在系统历史付款里的第一笔有效收据判断；其余统一显示 `Std`。

### v1.0.121
- `Payment Detail -> Export Pic` 导出图片改成手机竖屏更容易阅读的窄版模板，整体宽度收为 `720px`，同时放大表格、金额和汇总区域字号。
- `Edit Payment Detail` 新增 `AGENT` 修改项；管理员直接保存、销售走审批后，明细关联代理会写回数据库，导出图片底部的 `Agent · Disbursement` 名称同步变化。
- 付款代理列表会自动补齐默认 `Mitty Group`，新环境或空权限范围不再需要先手动创建默认代理。

### v1.0.120
- `Payment Detail -> Export Pic` 导出字体改为项目内置 `Arial / Arial Bold`，并让服务端渲染器显式加载这两个字体文件；修复 Docker 环境缺少 Arial 时导出图只剩 logo、线条、色块和空白表格的问题。

### v1.0.119
- `Payment Detail -> Export Pic` 导出字体统一切到 `Arial` 体系，移除此前依赖项目内嵌 `Noto Sans` 字体文件的渲染路径；修复部分运行环境里仍然输出方块字/tofu 的问题，并保持完整 `MU Group` logo、日期、汇总卡、表格和 footer 结构与标准模板一致。

### v1.0.118
- `Payment Detail -> Export Pic` 的导出模板继续收口到标准 `payment_details.html`：左上角改用透明底完整 `MU Group` logo，日期/表格/footer 视觉层级与参考图对齐。
- 导出链路新增项目内置字体资源，不再依赖 Docker 运行环境字体；修复此前在部分环境中导出成小方块字、logo 变形和主机/容器结果不一致的问题。

### v1.0.117
- `Dashboard` 首屏汇总改成直接走后端 summary API，页面不再依赖先进入其他模块才能显示统计内容；`Upload SWIFT` 弹窗现在会在打开时主动加载 `Waiting_SWIFT` 的付款明细选项，不再要求先打开 `Payment Detail` 页面“预热”数据。
- `Payment Detail -> Export Pic` 改为稳定导出模板化 JPG，版式对齐标准 `payment_details.html`；同时 `Edit Payment Detail` 不再展示内部 `receiptId`，改成可读的关联收据标签。
- `SWIFT` OCR 识别逻辑改为按报文 `Block 4` 业务字段回填，新增 `Sender Address / Receiver Account` 字段显示，并修复 `Confirm Create` 的 `NaN` 解析错误与详情/SWIFT 两个移动端弹窗底部按钮超出屏幕的问题。

### v1.0.116
- 八个业务页的手机浏览器观看性继续收口：`Dashboard / Invoice / Receipt / Payment Detail / SWIFT / Customer / Approval / Settings` 的头部操作区、筛选区和表格溢出统一改为窄屏友好布局；`Settings` 进一步改成模块折叠面板，避免长页一次性展开所有设置内容。
- `Receipt Management` 新增状态多选筛选，默认只勾选未完成状态，分页默认 `30` 条并支持 `50 / 100 / 200`；对应 API 已支持重复 `status` 查询参数。
- `Invoice Management` 默认排序重做：未完成发票先显示、已完成发票后显示；每个组内 `shipDate` 为空的发票置顶，其余按最早到最晚排序。

### v1.0.115
- 复合订单匹配规则继续收口：`ORDER NO` 中的 `/` 现在会被视为同一条记录的多个可命中分段，任何一个分段按正常规则命中后都会返回整条记录；这条规则已同步到 `Create Receipt Directly`、收据 OCR、`Invoice` 读取/匹配、Excel ML 等共用匹配链路。
- 审批入口聚合到单页：原 `Deletion Approval` 统一改为 `Approval`，收据修改审批、付款明细修改审批、SWIFT 修改审批与删除审批集中在同一页分栏目展示，各业务页底部不再重复堆待审批表。
- `Payment Detail -> Export Pic` 现在对所有现有明细开放，不再只限手工直建记录；同时修正了全局搜索框的过期请求覆盖问题，输入结束后不会再被旧结果回写成错误数据。

### v1.0.114
- 客户匹配内核统一收口：新增全局 `ORDER_NAME` 规范化匹配层，所有依赖 `ORDER_NAME` 的入口现在都会忽略空格并共用同一套匹配规则；客户主数据新增可维护的多 `ORDER_NAME` 别名，`SUPER DT 2 / SUPERDT2 / S U P E R D T 2` 这类输入会命中同一客户并回填规范 `MARK` 等主数据字段。
- `Invoice -> Bulk Import Invoices`、账单创建/改单/rematch、收据 OCR/直建、签名收据订单上下文等入口已全部提升到同一匹配水平；`Invoice` 订单编辑同时支持修改 `INV NO`，订单会事务化迁移到目标发票组并同步关联收据的 `INV NO`。
- `Receipts` 列表新增 `Balance` 列，显示对应订单在本笔收据入账后的剩余余额；`Upload Receipt` 在 OCR 识别出 `ORDER NO` 后会优先使用数据库命中的订单/客户信息整套回填，只有命不中时才退回 OCR 原始字段。
- `Payment Detail` 手工直建记录新增 `Export Pic`，可导出规范的明细图片；`Generate Signed Receipt` 新增 `Mode de paiement` 下拉与收据显示，支持 `Cash / Transfer`。

### v1.0.112
- 付款明细与 SWIFT 新增“修改审批”能力：`SALES` 及以上权限账号可以对自己可见范围内的记录发起修改；`SALES` 提交后进入待审批状态，`ADMIN` 对自己可见范围内的记录可直接修改。
- `Detail` 仅允许在 `Waiting_SWIFT / ERROR` 状态下修改 `date` 与每行 `mark / orderNo / amount / receiptId`；`Swift` 仅允许在 `ERROR / Bank_Transfer` 状态下修改 `date / amount / senderName / senderAddress / receiverName / receiverAccount`。
- 两条链路都新增待审批列表、审批通过/拒绝动作和 API 自动化回归；同一条记录在 `PENDING` 期间不能重复提交新的修改申请。

### v1.0.113
- 修复 `Upload Payment Detail` 的 OCR 确认创建兼容性问题：移动端 AI 识别成功后，前端提交的是嵌套 `data` payload，后端此前错误按顶层 payload 解析，导致 `Confirm Create` 报 `Invalid input: expected array, received undefined`。
- `/api/detail` 的 `confirm/direct-create` 现在同时兼容顶层 payload 和嵌套 `data` payload；已补 route 单测和真实 isolated API 回归，确认付款明细 OCR 从识别到确认创建再次可用。

### v1.0.111
- 收据管理新增“收据修改审批”能力：`SALES` 及以上权限账号现在都可以对可见收据发起修改；`SALES` 提交后进入待审批状态，同一收据在审批完成前不能重复提交；`ADMIN` 可对自己可见范围内的收据直接修改。
- 可修改字段严格限定为：`Receipt No. / Payment Date / INV NO / MARK / Payer / Phone`。提交后会明确提示“修改已完成”或“成功提交，等待管理员同意”。
- 收据页新增修改入口、待审批列表，以及管理员审批动作；审批通过后会正式写回收据，审批拒绝则保留审计记录但不影响当前生效数据。

### v1.0.110
- 收据与付款明细 OCR 上传统一接入共享业务图片上传管线：上传前按账号偏好预压缩，带进度、`15s` 空闲超时、`120s` 总时长兜底和统一错误映射。
- 设置页新增“用户图片压缩设置”，按账号永久保存图片压缩开关、质量下限和 OCR 目标大小；不影响系统级配置审计。
- `Create Receipt Directly` 的移动端确认页、收据页顶部按钮顺序和窄屏布局进一步优化，避免手机端横向拖动。

### v1.0.109
- 修复 Excel ML token 的解析歧义：旧实现把 `_` 同时用作分隔符和 token 内容字符，GitHub runner 在某些 token 组合下会把前缀拆错并返回 `EXCEL_TOKEN_INVALID`。
- 新生成 token 现在改为不含分隔冲突的安全编码；验证端同时兼容历史旧 token，因此线上已有 token 不需要人工重建。

### v1.0.108
- 新增上传资产生命周期清理：`Create Receipt Directly`、收据/明细/SWIFT OCR 识别这几条“先上传、后确认”的链路，现在会把临时图片纳入统一暂存台账，超时未绑定的孤儿图片由维护任务自动清理。
- `SIGNING_PENDING` 签名收据改为独立的 72h 清理策略：过期未完成的签名会话会被取消，未进入后续业务状态的占位收据会一起清掉，避免这类半成品长期堆积。

### v1.0.106
- `Create Receipt Directly` 上传链路补齐真实百分比进度条，并拆成 `Uploading` 与 `Saving` 两段状态。
- 新增 `15s` 空闲超时与 `120s` 总时长兜底；弱网中断、空闲超时、超长耗时都会给出明确提示，不再只有按钮恢复原状。
- 同类的签名收据 `finalize` multipart 上传也切到同一套上传器；其余 OCR 识别上传入口已审计，当前先保持原实现以避免扩大 OCR 时序回归面。

### v1.0.107
- `Create Receipt Directly` 的图片上传入口改成“两步确认”：手机拍照或相册选图返回后，先进入项目内的大图确认页，只有用户点击“确认上传”后才会触发压缩和上传。
- 这样既保留了弱网压缩、进度条、`15s/120s` 超时和错误提示，也避免了“点缩略图后立刻上传，用户来不及确认是不是这张图片”的问题。

### v1.0.105
- `Create Receipt Directly` 上传链路新增弱网增强：上传前先做保守压缩，质量下限保持在 `30%`，优先保证图片文字可读性并减少几内亚等弱网环境下的大图上传中断。
- 直接创建收据在输入 `ORDER NO` 后，现在会同步建议回填 `INV NO / MARK / PHONE / PAYER`，其中 `payer` 按 `COMPANY_NAME -> NAME` 回退。
- 手机端上传入口改为明确的 `拍照 / 从相册选择` 两个按钮，上传成功或失败也会在弹窗内直接显示，不再只有按钮恢复原状。

### v1.0.104
- 新增 Excel ML 查询 API：每个账号可在设置页生成独立 token，Excel 通过 `ORDER NO` 查询字段
- 查询权限沿用账号当前权限范围，token 后端只保存哈希，支持撤销与重新生成
- 字段覆盖 `ORDER NAME / COMPANY NAME(为空回退 CUSTOMER NAME) / MARK / PHONE / CITY / CONSIGNEE / COMPANY ADDRESS / CREDIT / CUSTOMER ID`
- 新增单值纯文本接口、JSON 诊断接口、批量接口和 isolated API 自动化回归

### v1.0.103
- 修复 `Generate Signed Receipt` 在三星等移动浏览器里点击 `Continue to signing` 后又回到收据页的问题
- 手机同标签页跳转到签字页后，当前页不再继续执行弹窗状态重置或收据列表刷新，避免跳转时序被浏览器打断

### v1.0.102
- 收据预览改为直接显示最终导出 canvas，预览与实际生成 PNG 现在共用同一套布局和坐标，不再分叉
- 桌面签字页右侧签字区收成固定宽度与更低的签字高度，避免签字弹窗里签字区域继续横向失控
- `Tel:` 现在固定对齐在 `Date` 正下方，并按每行最多 `14` 个字符覆盖换行，不再把顶部其他元素顶乱

### v1.0.100
- `Tel:` 头部继续收口为固定标签 + 固定高度内容区，电话号码每行最多显示 `14` 个字符，超出只向下覆盖，不再推动顶部标题、金额框或正文表格
- 中间正文区继续对齐原始 HTML 模板语义：每行填充值紧跟在对应标头的 `: ` 后面开始，`Motif` 内容靠左，`Frais : Paid` 同行吸附到最右侧
- 手机签字页改成黑底 + 居中窄白签字带的真正无滚动模式，灰色英文提示直接作为签字带背景，顶部 `Back / Fullscreen / Clear` 和底部 `Complete` 始终可见
- 签名导出继续保持透明 PNG，并通过笔迹裁切和更厚的签字笔宽修正最终收据中笔迹发虚、虚线化的问题

### v1.0.101
- 桌面签字页继续收紧布局，签字操作列不再跟随左侧收据预览列拉伸，避免新窗口打开后签字区被异常撑高
- 收据预览正文盒移除错误的 `flex: 1` 拉伸，正文区与签名区改回按内容高度自然排布，更接近原始 HTML 模板中段语义
- 手机签字页的白色可签区域进一步压缩为固定矮带，非签字区域保持黑色，顶部 `Back / Fullscreen / Clear` 与底部 `Complete` 在小屏上仍保持固定可见

### v1.0.99
- `Tel:` 头部改成固定标签 + 固定高度内容区；电话号码每行最多显示 14 个字符，超出只向下覆盖，不再推动 `REÇU DE PAIEMENT`、金额框或正文表格
- 中间正文表格的 `Motif` 内容改为紧跟在 `: ` 后方开始，`Frais : Paid` 改成同一行最右侧对齐
- 手机签字页进一步收口为真正无滚动的全屏白底签字模式，提示水印直接落在签字背景层，顶部只保留 `Back / Fullscreen / Clear`，底部 `Complete` 固定可见
- 签名导出前改为按笔迹边界裁切，最终收据里的签名不再因整张透明画布缩放而显得发虚或虚线化

### v1.0.110
- `Receipt Management` 与 `Payment Detail` 的图片上传统一接入共享弱网上传管线，补齐上传前压缩、进度显示、`15s` 空闲超时、`120s` 总时长兜底与可重试失败提示
- 新增“当前账号图片压缩设置”，每个账号都能在设置页单独保存自己的压缩开关、质量下限和 OCR 目标大小
- 修复 `Upload Receipt / Upload Payment Detail / Create Directly` 的移动端上传体验，包括按钮重排、竖屏预览确认页、弱网 `failed to fetch` 恢复，以及 receipt/detail OCR 对 stalled settings fetch 与空/坏 payload 的防御

### v1.0.98
- 手机签字页进一步收口为真正的全屏白底签字模式，顶部只保留 `Back / Fullscreen / Clear`，底部固定 `Complete`
- 手机端未确认返回时会保留当前签字草稿，下次进入可继续签
- `Tel:` 标签固定在收据头部左侧，电话号码内容支持更稳的强制断行

### v1.0.97
- 修正签名收据模板的导出布局，避免收款方与付款方签名被截断
- 签名图片改为透明 PNG，移除多余旋转控件，长电话自动换行
- 手机竖屏下改为整张收据等比缩放预览，并修复手机端签名完成后卡在 `GENERATING...` 的问题
- `Reçu de M./Mme.` 改为优先显示 `COMPANY_NAME + "MARK"`，为空时回退 `CUSTOMER_NAME + "MARK"`

### v1.0.96
- 生成签名收据的最终收据样式切换为正式 DMD 模板，包含固定 logo、水印、签字区与金额/正文版式
- 桌面端继续使用独立签字窗口；手机端改为同页单签字框全屏白底签字模式，支持左上角全屏/横屏辅助入口，竖屏也可正常签字
- Playwright 已补齐桌面弹窗签字与手机同页签字两条稳定闭环，确保最终生成的收据图片会自动挂回收据记录

### v1.0.95
- 修复隔离测试脚本在 macOS 与 Linux 间的 `mktemp` 模板兼容性问题
- 恢复 GitHub Actions 中 `test:ci` 的跨平台稳定性，签名收据功能代码与业务行为保持不变

### v1.0.94
- 收据管理新增“生成签名收据”流程，支持桌面端新窗口签名与手机端全屏签名
- 表单提交后会先创建 `SIGNING_PENDING` 收据并原子分配正式 `receiptNo`，未完成签名的记录不会进入正常业务流程
- 完成两段签名后，系统会自动生成收据 PNG、写入 NAS 挂载目录、下载到本地，并把最终图片自动挂到新生成的收据记录上

### v1.0.92
- 收据管理“完成/签收”改为仅管理员可执行
- 管理员现在可以在收据未完成阶段直接确认这条收据已收到
- 如果某条 `Detail/SWIFT` 关联多条收据，则只有全部收据都完成后，该链路才会进入最终 `RECEIVED`

### v1.0.93
- `INV 管理` 对 `SALES` 改为整页只读，不能新建、导入、刷新匹配、改日期、加单、改单或删单
- 账单客户解析新增双阶段兜底：先按 `MARK` 精确匹配，失败后再按 `ORDER_NO` 左半部分精确匹配客户 `ORDER_NAME`
- 收据管理在“直接创建收据”和 OCR 确认创建时，输入 `ORDER` 后会优先给出数据库内的 `INV NO` 建议；若同一 `ORDER` 命中多条发票，则自动选最新一条并红色提示人工核对

### v1.0.91
- 账单管理 `Rematch` 新增“单条需修复订单重新解析”
- 对 `customerId = null` 且 `needsCustomerFix = true` 的订单，会在 rematch 末尾重新跑一次客户解析
- 修复“先建订单、后建客户，但 rematch 仍不回填客户”的问题

### v1.0.90
- 收据管理“直接创建收据”新增图片上传入口
- 直接创建的收据图片会保存到 NAS 挂载目录下的 `receipts/direct`
- 直接创建收据弹窗字段顺序调整为 `ORDERNO -> INVNO -> 客户唛头 -> 付款金额USD`

### v1.0.89
- 补齐请求体大小限制与高风险写接口限流
- 登录、上传识别、删除申请/审批已进入统一安全基线，并已补到 API 自动化回归

### v1.0.88
- 修复账单分配分支 ADMIN 的 Playwright 回归用例稳定性，消除 CI 中的原生 alert 超时误失败。

### v1.0.87
- 继续扫清客户手机号冲突提示的多语言遗漏
- `customer` API 返回的 `phoneConflictMessage` 现在也会按请求语言本地化，避免外部调用或未来前端路径再次漏出中文

### v1.0.86
- 修复客户手机号冲突提示的英文界面文案
- 客户列表、客户编辑弹窗、保存后的提醒现在都会按当前语言显示手机号冲突提示

### v1.0.85
- 客户管理允许手机号重复，不再因手机号重复阻断新建、编辑、导入和客户修复
- 客户列表与客户编辑弹窗会对冲突手机号做红色提示，并显示“手机号冲突，请修改”
- 补齐账单发票分配给下级分支 ADMIN 的前端闭环回归，以及报表导出成功摘要前端校验

### v1.0.84
- 账单管理新增“发票归属分配给下级分支 ADMIN”能力
- 分配后会直接改发票及其订单归属，目标分支 ADMIN 及其下级获得可见和可管理权限
- 修复 SALES 对自己绑定客户相关账单、收据、付款明细、SWIFT 的可见性，绑定客户业务数据不再依赖客户创建人

### v1.0.83
- 修复 GitHub Actions 中 `settings-and-report` isolated API 用例的时区脆弱性
- 设置审计过滤断言改为基于实际审计记录动态生成本地日期范围，避免本地与 CI 因时区不同出现误失败

### v1.0.82
- 修复设置页重复点击侧边栏 `设置` 标签时一直显示“打开中”的问题
- 根因是 `/settings` 路由被错误识别为 `users` 视图，现已修正并补了回归测试

### v1.0.81
- `todolist.md` 拆分为“用户里程碑”与“纯工程内部流水”两层文档
- 新增 `ENGINEERING_LOG.md` 保存详细技术变更、测试门禁和工程流水
- README 进一步收口，只保留用户应该看的说明与文档入口

### v1.0.80
- README 改为用户手册首页
- 移除大段技术实现说明，只保留角色、模块、流程、启动方式和版本入口

### v1.0.79
- 新增 `CHANGE_CHECKLIST.md`
- 后续改业务逻辑、页面、接口、配置、数据库时，都有统一执行清单

### v1.0.78 - v1.0.71
- 页面切换体验优化
- 设置页审计能力增强
- 成功/错误提示逐步统一
- 前后端服务层、审计、事务与测试体系持续标准化

## 接下来要做的事

### 近期计划
- 通知系统：删除审批、异常金额、签收完成等通知能力
- 报表增强：更多维度汇总与导出
- 客户修复模块支持更高效的批量处理
- 故障排查手册与部署手册继续补齐

### 持续优化
- 运维监控与告警
- 数据归档与查询加速
- 多语言规范与文案治理
- 更细的自动化回归覆盖

## 文档说明

- [README.md](./README.md)：用户手册首页
- [CHANGE_CHECKLIST.md](./CHANGE_CHECKLIST.md)：以后每类改动必须同步做哪些动作
- [ENGINEERING_LOG.md](./ENGINEERING_LOG.md)：纯工程内部流水、详细版本记录、测试门禁与技术拆分记录
