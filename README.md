# 收汇管理系统

一个面向外贸收款流程的业务系统，用来管理：
- 账单与订单
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

- 当前版本：`1.0.120`
- 本次更新：`Payment Detail -> Export Pic` 的导出字体改为项目内置 `Arial / Arial Bold`，Docker 内也会显式加载同一套字体，修复导出图只剩 logo、线条和空白表格的问题。
- 同批修复：`Export Pic` 生成图中的文字现在随镜像一起打包，不再依赖运行环境是否安装 Arial；日期、表格、footer 与模板样式统一按项目内置资源渲染，避免主机和容器导出结果不一致。
- 同批更新：`Payment Detail -> Export Pic` 改为导出模板化 JPG，整体版式按标准 `payment_details.html` 收口；`Edit Payment Detail` 不再暴露原始 `receiptId` 这类内部标识，而是改成人类可读的关联收据标签。
- 同批更新：`SWIFT` OCR 改为按报文 `Block 4` 业务字段解析，`Sender Name / Sender Address / Receiver Name / Receiver Account` 都会进入识别窗口；同时修复了 `Confirm Create` 的数值解析错误和移动端弹窗底部按钮超窗问题。
- 同批更新：`Settings` 页面改成折叠式设置面板，`修改密码 / Excel Token / 图片压缩 / 用户管理 / 分支清库 / 系统配置 / 设置审计` 默认按模块折叠展开，避免长页堆满所有配置项。
- 同批更新：`Receipt Management` 现在支持状态多选筛选，默认只看未完成收据（不默认勾选 `RECEIVED`）；列表每页默认 `30` 条，并可切换到 `50 / 100 / 200`。
- 同批更新：`Invoice Management` 列表默认排序调整为“未完成发票在前、已完成发票在后”，且每个分组内 `shipDate` 为空的发票置顶，其余发票按 `shipDate` 从早到晚排序。
- `Detail` 仅允许在 `Waiting_SWIFT / ERROR` 状态下修改 `date` 与每行的 `mark / orderNo / amount / receiptId`；`Swift` 仅允许在 `ERROR / Bank_Transfer` 状态下修改 `date / amount / senderName / senderAddress / receiverName / receiverAccount`。已完成链路的记录不会开放修改。
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

## 六大业务模块

### 1. 账单管理
用于创建和维护 `INV NO / ORDER`。

主要用途：
- 新建账单与订单
- 编辑订单金额、放货日期、出货日期
- 查看未收金额
- 批量导入账单
- 刷新匹配
- 处理重复订单或冲突订单

### 2. 收据管理
用于录入客户收据。

主要用途：
- 上传收据图片识别
- 直接创建收据
- 生成签名收据
- 查看收据图片
- 管理员确认完成
- 发起删除申请

### 3. 付款明细
用于录入付款明细并与收据衔接。

主要用途：
- 上传付款明细图片识别
- 直接创建付款明细
- 查看图片
- 发起删除申请

### 4. SWIFT 水单
用于录入银行 SWIFT 信息并完成银行转账链路。

主要用途：
- 上传 SWIFT 图片识别
- 直接创建 SWIFT
- 查看图片
- 检查金额差异
- 发起删除或直接删除错误 SWIFT

### 5. 审批
用于集中处理删除审批和修改审批。

主要用途：
- 查看删除申请
- 查看收据修改申请
- 查看付款明细修改申请
- 查看 SWIFT 修改申请
- 审批通过
- 审批拒绝

### 6. 设置
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
