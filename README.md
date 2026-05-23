# 收汇管理系统

一个面向外贸收款流程的业务系统，用来管理：
- 账单与订单
- Orders 业务订单跟踪
- 收据
- 付款明细
- SWIFT 水单
- 删除审批
- 客户与用户

README 现在只保留用户应该看的内容。
技术实现、工程规范、开发计划，请看：
- [todolist.md](./todolist.md)
- [ENGINEERING_LOG.md](./ENGINEERING_LOG.md)
- [CHANGE_CHECKLIST.md](./CHANGE_CHECKLIST.md)

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/5408577a-9709-40e8-8398-812934a6cedf" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/089de920-4857-44c2-bc40-40daac98a87d" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/9ffb773e-8b7e-4671-b588-19b2277d9f24" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/10cc0ec7-245b-4837-95a1-df15319540b6" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/8e8e06fd-04e7-49fa-8598-5bb748f98faf" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/3dd0716a-57dc-4cc7-b053-bebd31afc02b" />

<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/5d2e4355-aaee-4dc9-9567-ada6b889b159" />

<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/bd7faddd-e47d-4bad-ac42-4f625ae5a0c9" />



## 最近更新

- 当前版本：`1.0.152`
- 本次更新：`Generate Signed Receipt` 弹窗新增可编辑 `Receipt No.`；打开弹窗时默认使用最近登记的 10 条收据中最大数字 + 1。
- 同批修复：保存收据时如果 `Receipt No.` 重复，现在会提示“收据号已存在，请换一个编号”，不再泛化成 `Server error`。
- 上一版本：`Payment Detail Management -> Create Payment Detail Directly` 的 `Receipts available to add` 列表已精简为只显示 `ORDER NO` 和收据金额。
- 上一版本：可加入收据列表的搜索框改为按 `ORDER NO` 搜索，手机和桌面端继续保留可滚动选择区。
- 上一版本：`Payment Detail Management -> Create Payment Detail Directly` 保留手动录入模式，并新增可勾选 `SR_Received` 收据直接加入同一张 Payment Detail。
- 上一版本：勾选加入的收据行只读，提交时后端会再次校验收据仍为 `SR_Received`，避免弱网或多人操作时把已流转收据重复加入付款明细。
- 上一版本：直接创建付款明细弹窗已适配手机和桌面，收据列表可搜索、可滚动，底部操作按钮不会被长列表挤出屏幕。
- 上一版本：`Receipt Management` 右上角动作按钮顺序调整为 `Create Directly -> Generate Signed Receipt -> Upload Receipt`，仅调整视觉顺序，不改变权限与布局逻辑。
- 本次更新：`Approval / 审批` 页面默认只显示待处理申请，每个审批模块每页 `5` 条；勾选 `ALL` 并点击“查询”后可查看该模块全部历史申请。
- 同批更新：审批页 `Requested Values` 现在只显示实际被修改字段的“修改前 → 修改后”，不再把未变化字段整块堆出来。
- 同批修复：`Payment Detail Edit Requests` 审批时如果快照里的旧 `receiptId` 已失效，会自动按 `ORDER NO + AMOUNT` 重新匹配或创建关联收据，避免管理员点击确认返回 `400 Bad Request`。
- 同批更新：`Dashboard` 的待审批卡片改为统计删除、收据修改、付款明细修改、SWIFT 修改四类待审批总数。
- 同批更新：`Receipt / Payment Detail / SWIFT` 三个页面的金额筛选由最小/最大范围改为单个准确金额筛选框。
- 同批优化：`Customer Management` 的 `ORDER_NAME History` 桌面弹窗改为自适应宽度与自动换行；`COMPANY_NAME` 超过 `35` 个字符时与 `CONSIGNEE` 一样截断显示，点击可看完整内容。
- 上一版本：`Orders / 订单管理` 中 `SALES` 修改普通 `STATUS / REMARK` 时不再误提交 `PI STATUS / SYSTEM NOTED`，避免被上级管理员权限校验拦截。
- 上一版本：`Orders` 新建时如果输入的是可见财务订单号，即使前端没有传 `CUSTOMER`，后端也会从对应财务 `ORDER NO` 自动推断客户，并保存到 Orders 记录。
- 上一版本：`Orders` 记录新增可选财务订单关联字段，创建自财务订单号时会持久关联对应财务 `ORDER`，但仍不参与余额查重或财务匹配逻辑。
- 上一版本：`Orders / 订单管理` 允许创建与 `Invoice Management` 已有财务订单号相同的独立业务跟踪记录；但 `Orders` 页面内部仍会阻止重复 `ORDER NO`。
- 上一版本：`Receipt Management` 修改收据时不再自动覆盖已有 `ORDER NO / INV NO / MARK / PAYER / PHONE`，只有匹配到可采纳建议且当前内容不一致时，才显示“采纳匹配建议”按钮供用户主动套用。
- 上一版本：`RECEIVED` 状态收据的修改和删除入口只对 `ADMIN` 及以上账户显示，低权限账号不再看到相关按钮。
- 上一版本：`Customer Fix Queue` 支持在修复弹窗内搜索并关联已有客户；如果报错源已经能按现有规则正确匹配，系统会自动清除过期的“请修复客户信息”状态。
- 上一版本：`Dashboard` 的 `Pending Receipts` 卡片右侧新增待处理收据总金额，统计口径固定为 `SR_Received` 状态。
- 上一版本：新增 `GET /api/sync/customers?since=<cursor>` 客户增量同步接口，返回可见范围内新增/修改客户、删除标记、停用标记占位和下一次同步游标。
- 上一版本：客户同步接口使用不透明 `nextCursor`，外部系统只需要保存并在下次请求原样传回；`USER` 角色不可调用，`ADMIN / SALES` 仍按现有客户可见范围隔离。
- 上一版本：`Orders / 订单管理` 页面移除了面向工程说明的提示文字，用户进入页面后只看到业务可操作内容。
- 上一版本：`Orders / 订单管理` 页面菜单、标题、按钮、表头、状态和弹窗字段已补齐中文显示；超长客户名称在新建弹窗和列表中会截断显示，鼠标悬停可查看完整内容，避免撑宽弹窗。
- 上一版本：`Orders` 页面新建 `ORDER` 时复用全局订单建议/客户匹配逻辑，输入类似 `PIKIN-23` 会自动回填可见客户信息。
- 上一版本：`Orders` 创建弹窗不再显示 `SYSTEM NOTED`；该字段只在记录创建后，由有权限的上级 `ADMIN` 在编辑中维护。
- 上一版本：新增独立 `Orders` 子页面，用于维护业务订单跟踪表：`ORDER / STATUS / PI STATUS / REMARK / SYSTEM NOTED / DEPOSIT`。
- 上一版本：`Orders` 页面新建 `ORDER` 时独立于财务订单余额逻辑；同一个 `ORDER NO` 可以同时存在于 `Invoice Management` 和 `Orders`，但不能在 `Orders` 页面重复创建。
- 上一版本：`DEPOSIT` 会自动按对应收据/定金池汇总显示；`PI STATUS / SYSTEM NOTED` 仅上级 `ADMIN` 可维护，普通状态和备注按可见范围维护。
- 上一版本：`Receipt Management` 中 `RECEIVED` 状态收据现在可以通过修改功能重新绑定 `ORDER NO / INV NO`，用于修正已完成收据误挂订单的情况。
- 上一版本：完成态收据重绑后会同步更新关联 `Payment Detail` 明细行的 `ORDER NO / MARK`，并重算旧订单与新订单余额；`Detail / SWIFT` 的已完成状态不会被回退。
- 上一版本：网页标签栏图标已替换为新的 MU 红蓝 SVG 图标，并显式声明为 `image/svg+xml` favicon。
- 上一版本：新增“数据文件与存储位置”，集中说明数据库、NAS 上传目录、Docker 卷、模板资源和测试临时数据。
- 上一版本：`Payment Detail -> Export Pic` 的 TYPE 判断改为按真实发票订单的当前余额判断，余额小于等于 `$5` 的订单直接显示 `Final`；`DEPOSIT_POOL / Un_Associated` 池子不会被误判为 `Final`。
- 上一版本：`Payment Detail -> Export Pic` 导出图样式调整，表头、订单号、类型、总计蓝条和底部付款公司/笔数文字按最新视觉要求加黑、加粗或放大。
- 上一版本：`SWIFT Management` 的 PDF 小眼睛预览在手机端可以在弹窗内上下滑动查看多页内容，第二页及后续页面不再被外层弹窗截断。
- 上一版本：所有美元金额显示统一为英文/国际千分位格式，例如 `$51,386`；展示端不再显示小数，输入框在失焦后也按同一规则显示。
- 同批更新：`Customer Management` 及相关页面的 `ORDER_NAME / ORDER NO` 展示统一为大写英文，减少大小写混用带来的识别成本。
- 同批更新：`Dashboard` 新增“已放单未结清发票”和“客户欠款排行”两块列表，均由后端首屏汇总返回，不依赖先进入其它页面加载数据。
- 同批修复：`SWIFT Management` 的 PDF 预览弹窗针对手机浏览器优化，长文件名和多页 PDF 不再溢出屏幕边框。
- 上一版本：网页登录页不再默认展示或自动填充管理员账号密码，邮箱和密码输入框打开时保持空白。
- 上一版本：`SWIFT Management` 的 PDF 附件现在可以像图片一样预览；上传弹窗内可直接查看 PDF，列表中已上传 PDF 的“小眼睛”也会打开多页 PDF 预览。
- 上一版本：`Receipt / Payment Detail / SWIFT` 三个页面在手机端把筛选区收纳起来，顶部只保留搜索框和“筛选”按钮；`Receipt` 额外保留外部“查询”按钮，桌面端布局保持原样。
- 同批更新：`Customer Management` 的每个 `ORDER_NAME` 现在可以点击查看历史订单、发票号、金额、未收金额；桌面端弹窗右侧同步显示该客户最近收据和状态，手机端自动单列显示。
- 同批修复：`Create Invoice` 弹窗把“添加订单 / Cancel / Create”统一放到底部操作区，并优化手机端订单输入行，避免底部背景遮挡信息或 Add 按钮。
- 上一版本：工程安全规则已补充：日常更新优先只重建 app 容器，不用会删除数据的 Docker volume / 数据库 reset 命令；如涉及数据库结构变更，必须先说明迁移、回滚和数据风险。
- 上一版本：`SWIFT Management -> Upload SWIFT Record` 支持上传 PDF 文件识别；PDF 可多页，系统会先联合解析整份 PDF，再回填金额、日期、付款人、付款人地址、收款人和收款账号。
- 同批更新：SWIFT 上传入口现在同时支持图片和 PDF；PDF 会作为 SWIFT 附件暂存在 NAS 挂载目录，确认创建后再正式关联到对应 SWIFT 记录。
- 上一版本：`Upload Receipt` 上传到 `100%` 后会继续显示“AI 正在识别 / AI 已回传 / 正在整理字段 / 请核对后创建”的分阶段提示，避免弱网或 OCR 等待时误以为页面卡死。
- 同批更新：`Generate Signed Receipt` 的订单上下文客户显示已统一为 `COMPANY_NAME + "MARK"`，公司名为空时回退 `NAME + "MARK"`；收据创建、订单建议填充和签名收据模板共用同一显示规则。
- 上一版本：收据录入命中复合订单时会回填并入库完整 `ORDER NO`。例如识别到 `AB-13B`，系统实际订单是 `AB-13B/AB-12B` 时，表单和收据记录都会使用完整订单号，避免只存单段后匹配不到发票。
- 同批更新：兼容旧的空格复合订单写法，例如 `AB-13B AB-12B` 可按任一分段命中；但 `OUMAR LAH-01 / SUPER DT2-10` 这类单订单名中的空格不会被误拆。
- 上一版本：修复 `Upload Receipt` 在 OCR / `Motif` 同时包含 `INV NO + ORDER NO` 时只回填 `ORDER NO` 的问题；数据库没有发票建议时，不再清空 OCR 已识别出的 `INV NO`。
- 同批更新：OCR 识别提示和标准化解析补强，可从 `Payment for L25MH060523 Big Alpha-07` 这类 `Motif` 中分别拆出 `INV NO=L25MH060523` 与 `ORDER NO=Big Alpha-07`；如果只有订单号则继续只回填订单号。
- 上一版本：修复 `Upload Receipt` 对手写 `Initial payment for Rahim-11` 这类收据的识别：系统会从 `Motif / Payment for ...` 兜底提取 `ORDER NO`，并且 `Initial payment` 不再被误判为 `DEPOSIT`。
- 同批更新：`Upload Receipt` 的 `DEPOSIT` 始终默认不勾选，需要用户手动确认；OCR 日志新增标准化字段摘要，便于后续排查。
- 上一版本：`Upload Receipt` 的 AI 识别结果会继续保留识别出的 `ORDER NO`；只有当系统找不到对应订单时，`INV NO` 才会留空等待管理员补录。
- 同批更新：`Upload Receipt` 的 `DEPOSIT` 默认不再勾选；`Receipt Management` 的 `Rows per page` 已移到底部分页区旁边。
- 同批更新：`SWIFT Management` 为管理员恢复/新增 `SWIFT` 签收入口，签收后会把关联 `Payment Detail / Receipt / SWIFT` 一起推进到 `RECEIVED`；`SALES` 无权签收。
- 同批优化：`Approval` 页面中删除申请、收据修改申请、付款明细修改申请、SWIFT 修改申请都改为每页 `5` 条分页展示。
- 上一版本：`Receipt Management` 的收据图片预览改为显示已绑定 `ORDER NO`、已绑定 `INV NO` 和创建者，不再误把收据号当成订单绑定信息。
- 同批更新：收据修改现在可修改 `ORDER NO`；`SALES` 提交后继续走上级可见管理员审批，`ADMIN` 及以上直接生效。保存或审批通过时会重新绑定到正确订单和发票。
- 同批修复：如果收据原来落在 `Un_Associated / DEPOSIT_POOL` 临时池，管理员补录真实 `INV NO` 后，系统会把对应订单迁到目标发票下，避免一直停留在未匹配池。
- 上一版本：`Receipt Management` 的未登记订单收据匹配规则收紧，只保留精确 `ORDER NO` 与 `/` 复合订单分段匹配；未登记订单不再误挂到同前缀旧订单，非定金进入 `Un_Associated`，定金进入 `DEPOSIT_POOL`。
- 同批修复：未登记订单创建收据时，即使 OCR 识别出 `INV NO` 也会留空等待管理员后续补录；`PAYER` 统一按 `COMPANY_NAME + "MARK"`，没有公司名时按 `NAME + "MARK"` 显示。
- 同批优化：收据图片预览不再显示上传文件名；顶部 `Status Filter` 改为下拉菜单，并通过“查询”按钮应用筛选结果。
- 上一版本：继续修正 `Payment Detail -> Export Pic` 的 `TYPE` 计算规则：所属 detail 的 SWIFT 进入 `Bank_Transfer / RECEIVED` 且订单余额 `<= 5` 时显示 `Final`，并且“第一笔也是最后一笔”优先显示 `Final` 而不是 `Initial`。
- 同批修复：`Edit Payment Detail` 在 `Bank_Transfer` 状态下也可修改，直到 `RECEIVED` 才禁止；修改订单时会优先匹配已有流程内收据，不再误提示“保存后将创建新收据”。
- 同批优化：`Payment Agent Management` 弹窗已改为桌面和手机都能完整显示，内容区滚动、底部操作固定可见。
- 同批更新：`Payment Detail -> Export Pic` 改为更适合手机竖屏查看的 720px 宽模板，字号和列距同步放大；`Edit Payment Detail` 现在可修改 `AGENT`，导出图片底部的代理名称会跟随更新。
- 同批更新：系统会在付款代理列表中自动补齐默认 `Mitty Group`，避免新环境或空账号范围内没有可选代理。
- 同批更新：`Payment Detail -> Export Pic` 的导出字体改为项目内置 `Arial / Arial Bold`，Docker 内也会显式加载同一套字体，修复导出图只剩 logo、线条和空白表格的问题。
- 同批修复：`Export Pic` 生成图中的文字现在随镜像一起打包，不再依赖运行环境是否安装 Arial；日期、表格、footer 与模板样式统一按项目内置资源渲染，避免主机和容器导出结果不一致。
- 同批更新：`Payment Detail -> Export Pic` 改为导出模板化 JPG，整体版式按标准 `payment_details.html` 收口；`Edit Payment Detail` 不再暴露原始 `receiptId` 这类内部标识，而是改成人类可读的关联收据标签。
- 同批更新：`SWIFT` OCR 改为按报文 `Block 4` 业务字段解析，`Sender Name / Sender Address / Receiver Name / Receiver Account` 都会进入识别窗口；同时修复了 `Confirm Create` 的数值解析错误和移动端弹窗底部按钮超窗问题。
- 同批更新：`Settings` 页面改成折叠式设置面板，`修改密码 / Excel Token / 图片压缩 / 用户管理 / 分支清库 / 系统配置 / 设置审计` 默认按模块折叠展开，避免长页堆满所有配置项。
- 同批更新：`Receipt Management` 现在支持状态多选筛选，默认只看未完成收据（不默认勾选 `RECEIVED`）；列表每页默认 `30` 条，并可切换到 `50 / 100 / 200`。
- 同批更新：`Invoice Management` 列表默认排序调整为“未完成发票在前、已完成发票在后”，且每个分组内 `shipDate` 为空的发票置顶，其余发票按 `shipDate` 从早到晚排序。
- `Detail` 在 `RECEIVED` 前允许修改 `date / AGENT` 与每行的 `mark / orderNo / amount / receiptId`；`Swift` 仅允许在 `ERROR / Bank_Transfer` 状态下修改 `date / amount / senderName / senderAddress / receiverName / receiverAccount`。已完成链路的记录不会开放修改。
- 同一条收据、付款明细或 SWIFT 在待审批期间都不能重复提交新的修改申请；审批通过后才会正式写回数据。
- 上一批更新已完成收据管理移动端体验优化：顶部操作按钮在窄屏下会自动换行/纵向堆叠；直接上传图片确认页改为固定返回/确认头部，超长图片会在预览区内按可视高度缩放并独立滚动，避免确认按钮被挤出屏幕。
- 设置接口已增加用户级图片压缩偏好持久化能力，图片压缩开关、质量下限、OCR 目标大小按当前登录账号单独保存，不影响系统级配置审计。
- 收据/明细业务图片上传已抽出共享浏览器预压缩管道：上传前统一转 JPEG、按目标大小搜索合适质量，并复用上传进度与超时错误分类，便于后续 OCR 录入流程共用。
- 付款明细 OCR 上传现已接入共享图片上传管线：会优先读取当前账号的压缩偏好，失败时自动回退默认压缩策略；上传阶段、进度和失败提示会直接显示在上传弹窗中，便于移动端重试。
- 前端版本号位置：`设置` 页面最上方

## 系统适合谁

适合以下角色使用：
- 管理员：管理配置、审批删除、查看全局数据、管理账号
- 销售：管理自己权限范围内的客户与业务数据
- 普通用户：录入、上传、查询自己可见范围内的数据

## 七大业务模块

### 1. 账单管理
用于创建和维护 `INV NO / ORDER`。

主要用途：
- 新建账单与订单
- 编辑订单金额、放货日期、出货日期
- 查看未收金额
- 批量导入账单
- 刷新匹配
- 处理重复订单或冲突订单

### 2. Orders
用于维护不参与财务余额逻辑的业务订单跟踪。

主要用途：
- 新建客户关联的业务 ORDER
- 维护订单状态
- 由管理员维护 PI 状态和系统备注
- 查看该 ORDER 已产生的定金金额
- 避免与财务订单重复创建

### 3. 收据管理
用于录入客户收据。

主要用途：
- 上传收据图片识别
- 直接创建收据
- 生成签名收据
- 查看收据图片
- 管理员确认完成
- 发起删除申请

### 4. 付款明细
用于录入付款明细并与收据衔接。

主要用途：
- 上传付款明细图片识别
- 直接创建付款明细
- 查看图片
- 发起删除申请

### 5. SWIFT 水单
用于录入银行 SWIFT 信息并完成银行转账链路。

主要用途：
- 上传 SWIFT 图片或 PDF 识别
- 直接创建 SWIFT
- 查看图片或 PDF 附件
- 检查金额差异
- 发起删除或直接删除错误 SWIFT

### 6. 审批
用于集中处理删除审批和修改审批。

主要用途：
- 查看删除申请
- 查看收据修改申请
- 查看付款明细修改申请
- 查看 SWIFT 修改申请
- 审批通过
- 审批拒绝

### 7. 设置
用于系统级管理。

主要用途：
- 修改密码
- 管理当前账号的图片压缩偏好
- 用户管理
- Excel ML 令牌
- 系统配置
- 配置变更审计
- 分支业务清库
- 查看当前系统版本

## Excel ML API

Excel 查询使用 `设置 -> Excel ML 令牌` 中生成的账号 token。token 只显示一次，后端只保存哈希；查询时使用 `Authorization: Bearer <token>`，权限沿用生成 token 的账号。

单值查询：

```bash
GET /api/excel/ml?orderNo=GANDO-10&field=2
```

默认返回纯文本，适合 Excel 自定义函数读取；加 `format=json` 会返回匹配方式、字段名、客户 ID 等诊断信息。批量查询使用：

```bash
POST /api/excel/ml/batch
```

字段编号：

1. `ORDER NAME`
2. `COMPANY NAME`，为空时回退网页客户管理的 `NAME`
3. `MARK`
4. `CUSTOMER NAME`
5. `COMPANY NAME`
6. `PHONE`
7. `CITY`
8. `CONSIGNEE`
9. `COMPANY ADDRESS`
10. `CREDIT`
11. `CUSTOMER ID`

## 日常业务流程

推荐按下面顺序使用：

1. 先录入客户
2. 创建账单与订单
3. 上传或创建收据
4. 上传或创建付款明细
5. 上传或创建 SWIFT
6. 最后由管理员确认收款完成

如果中途有异常：
- 客户信息不完整：去 `客户管理` 修复
- 删除数据：走 `删除审批`
- 金额不一致：先检查订单、收据、明细、SWIFT 是否匹配正确

## 权限说明

### ADMIN
- 可查看所有数据
- 可修改系统配置
- 可审批删除
- 可管理账号

### SALES
- 可查看自己权限树内的数据
- 可管理自己权限范围内的客户和业务
- 不可审批删除
- 不可修改系统级配置

### USER
- 只能查看自己权限范围内的数据
- 不能创建账号
- 不能做系统级管理

## 首次启动

如果你只是使用系统，优先用 Docker。

### Docker 启动

```bash
docker compose up -d --build
```

启动后访问：
- 本地 HTTPS：[https://localhost](https://localhost)

如果是线上部署，请先按 `.env.example` 配置环境变量后再启动。

## 数据文件与存储位置

系统的数据分为两类：
- 业务结构化数据：存在 MySQL 里。
- 上传或生成的文件：存在 NAS 挂载目录里。

不要把 MySQL 数据目录、NAS 上传目录或 Docker volume 当成临时文件删除。

### 1. MySQL 业务数据库

项目通过 `DATABASE_URL` 连接 MySQL。

默认连接示例：

```bash
mysql://muledger:replace-with-your-password@192.168.1.3:3306/trading_ledger
```

这里保存的是核心业务数据：
- 用户、角色、权限树
- 客户资料、客户多个 `ORDER_NAME`
- 发票、订单、订单余额
- 收据、付款明细、SWIFT 水单
- 删除审批、修改审批
- 系统配置、配置审计、操作审计
- Excel ML token 哈希
- 上传资产台账 `UploadedAsset`
- 签名收据会话与收据编号计数器
- Payment Agent 资料与文件索引

注意：
- MySQL 数据文件不在本项目 Git 仓库里。
- MySQL 数据文件也不在本项目 `docker-compose.yml` 里创建的 app 容器里。
- 备份数据库时应备份 `trading_ledger` 这个业务库，而不是只备份项目代码。

### 2. NAS 上传文件目录

Docker 会把宿主机 NAS 目录挂载到容器内：

```bash
${UPLOAD_HOST_DIR}:/app/upload
```

默认宿主机目录：

```bash
/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload
```

应用默认把业务文件写到容器内：

```bash
/app/upload/images
```

所以默认对应的宿主机真实目录是：

```bash
/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload/images
```

网页和数据库里保存的是受保护访问路径：

```bash
/upload/images/...
```

文件读取统一走：

```bash
GET /api/upload-image?path=/upload/images/...
```

这样可以先检查登录状态和数据可见权限，再返回图片或 PDF。

### 3. NAS 目录结构

当前业务文件主要落在这些目录：

| 目录 | 来源 | 说明 |
|---|---|---|
| `/upload/images/receipts/direct` | `Receipt Management -> Create Receipt Directly` | 直接创建收据时上传的收据关联图片 |
| `/upload/images/receipts/ocr` | `Receipt Management -> Upload Receipt` | 收据 OCR 上传图片 |
| `/upload/images/details/ocr` | `Payment Detail -> Upload Payment Detail` | 付款明细 OCR 上传图片 |
| `/upload/images/swifts/ocr` | `SWIFT Management -> Upload SWIFT Record` | SWIFT 图片或 PDF 附件 |
| `/upload/images/receipts/generated/YYYY/MM` | `Generate Signed Receipt` | 最终生成的签名收据图片 |
| `/upload/images/receipts/generated/YYYY/MM/signatures` | `Generate Signed Receipt` | 收款方和付款方透明签名图片 |
| `/upload/images/agents/files` | `Payment Agent Management` | 付款代理公司附件 |
| `/upload/images/<file>` | 旧入口或未分类上传 | 兼容历史上传路径，不建议新功能继续使用 |

实际宿主机路径是在 `${UPLOAD_HOST_DIR}/images/...` 下。

例如网页路径：

```bash
/upload/images/swifts/ocr/example.pdf
```

默认对应宿主机路径：

```bash
/Volumes/团队文件-DAINTY_SHIPMENT/docker/trading-ledger-system/upload/images/swifts/ocr/example.pdf
```

### 4. 上传文件支持类型

普通业务图片上传支持：
- JPG / JPEG
- PNG
- WEBP
- HEIC / HEIF

SWIFT 和 Payment Agent 附件额外支持：
- PDF
- DOC / DOCX
- XLS / XLSX
- TXT

系统会检查文件扩展名和文件内容是否匹配，避免把错误文件伪装成图片或 PDF。

### 5. 上传资产台账与清理规则

系统用数据库表 `UploadedAsset` 记录上传文件生命周期：
- `STAGED`：文件已写入 NAS，但还没有被业务记录确认使用。
- `ATTACHED`：文件已经绑定到收据、付款明细、SWIFT、签名收据或 Payment Agent。
- `DELETED`：过期暂存文件已被维护任务清理。

默认清理规则：
- 暂存文件超过 `UPLOADED_ASSET_STAGED_TTL_HOURS`，默认 `24` 小时，会被清理。
- 未完成签名的 `SIGNING_PENDING` 收据会话超过 `SIGNING_PENDING_TTL_HOURS`，默认 `72` 小时，会被取消并删除占位收据。

维护任务由 Docker 里的 `maintenance` 服务定时调用：

```bash
POST /api/internal/maintenance/uploaded-assets
```

鉴权使用：

```bash
MAINTENANCE_JOB_TOKEN
```

### 6. Docker 运行卷

项目还使用两个 Docker named volumes 给 Caddy 保存运行状态：

| Docker volume | 用途 |
|---|---|
| `caddy_data` | Caddy 证书、TLS、站点运行数据 |
| `caddy_config` | Caddy 运行配置缓存 |

这两个不是业务收款数据，但线上 HTTPS 访问会依赖它们。

不要随意执行：

```bash
docker compose down -v
docker volume rm ...
```

这些命令可能删除 Caddy 运行卷；如果未来数据库也改成 Docker volume，还可能删除数据库数据。

### 7. 项目内置模板资源

这些文件跟随 Git 和 Docker 镜像发布，不是用户上传数据：

| 文件 | 用途 |
|---|---|
| `public/detail-export/payment-detail-logo.png` | `Payment Detail -> Export Pic` 的 MU Group logo |
| `public/detail-export/arial.ttf` | 导出图片使用的 Arial 字体 |
| `public/detail-export/arial-bold.ttf` | 导出图片使用的 Arial Bold 字体 |
| `public/logo.svg` | 项目静态 logo |
| `public/robots.txt` | 搜索引擎爬虫规则 |

不要把用户业务图片放进 `public/`。业务图片应进入 NAS 上传目录。

### 8. 临时下载文件

这些文件是请求时临时生成并直接下载给浏览器，不会长期落盘：
- Dashboard 报表 Excel / PDF
- Invoice 批量导入模板
- Customer 批量导入模板
- Settings 审计 CSV
- Payment Detail `Export Pic` 下载图

如果用户下载后保存在本地，那是用户本机文件，不属于服务器托管数据。

### 9. 测试临时数据

自动化测试不会使用正式业务库：
- API isolated 测试使用 `trading_ledger_test`
- E2E isolated 测试使用 `trading_ledger_test`
- 测试上传目录使用 `/tmp` 下的临时目录

测试脚本结束后会清理自己的临时上传目录，不应影响 NAS 正式目录。

## 常用操作建议

### 批量导入前
先确认：
- 模板使用的是最新模板
- 数据列名没有被改动
- 客户、订单、金额格式正确

### 弱网上传前
如果网络较慢，建议先去 `设置` 调整当前账号自己的图片压缩设置。

现在这些入口都会优先走同一套压缩与弱网保护逻辑：
- `Receipt Management -> Upload Receipt`
- `Receipt Management -> Create Directly`
- `Payment Detail -> Upload Payment Detail`

手机端在 `Create Directly` 选图后，会先进入项目内的大图确认页，只有点 `Confirm Upload` 后才会真正开始上传。

### 修改系统阈值前
建议先在 `设置 -> 系统配置` 中修改，不要直接改代码。

### 页面没更新时
如果你本地正在跑 Docker 服务，而代码已经更新：

```bash
docker compose up -d --build
```

## 配置变更审计是什么

`设置 -> 配置变更审计` 显示的是：
- 谁修改了系统配置
- 修改时间
- 修改了哪些配置项
- 修改前后的值
- 审计导出历史

这个区域主要给管理员用，不是普通业务录入页面。

## 版本号在哪里看

系统当前版本号固定显示在：
- `设置` 页面最上方

版本号以 `package.json#version` 为唯一来源，不再使用页面底部悬浮版本号。

## 更多文档

如果你要看后续计划或技术规范：
- [todolist.md](./todolist.md)：用户看得懂的版本里程碑与后续计划
- [ENGINEERING_LOG.md](./ENGINEERING_LOG.md)：纯工程内部流水、详细版本记录与测试门禁
- [CHANGE_CHECKLIST.md](./CHANGE_CHECKLIST.md)：以后每类改动必须同步做哪些动作
