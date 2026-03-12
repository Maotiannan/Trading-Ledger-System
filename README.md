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
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/5408577a-9709-40e8-8398-812934a6cedf" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/089de920-4857-44c2-bc40-40daac98a87d" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/089de920-4857-44c2-bc40-40daac98a87d" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/9ffb773e-8b7e-4671-b588-19b2277d9f24" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/9ffb773e-8b7e-4671-b588-19b2277d9f24" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/10cc0ec7-245b-4837-95a1-df15319540b6" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/10cc0ec7-245b-4837-95a1-df15319540b6" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/8e8e06fd-04e7-49fa-8598-5bb748f98faf" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/8e8e06fd-04e7-49fa-8598-5bb748f98faf" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/3dd0716a-57dc-4cc7-b053-bebd31afc02b" />
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/3dd0716a-57dc-4cc7-b053-bebd31afc02b" />
<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/5d2e4355-aaee-4dc9-9567-ada6b889b159" />
<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/5d2e4355-aaee-4dc9-9567-ada6b889b159" />
<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/bd7faddd-e47d-4bad-ac42-4f625ae5a0c9" />
<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/bd7faddd-e47d-4bad-ac42-4f625ae5a0c9" />


## 最近更新

- 当前版本：`1.0.81`
- 本次更新：`todolist.md` 已收敛为用户里程碑，详细技术流水已拆分到 `ENGINEERING_LOG.md`。
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
- 查看收据图片
- 标记签收
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

### 5. 删除审批
用于处理收据、付款明细、SWIFT 的删除审批。

主要用途：
- 查看删除申请
- 审批通过
- 审批拒绝

### 6. 设置
用于系统级管理。

主要用途：
- 修改密码
- 用户管理
- 系统配置
- 配置变更审计
- 分支业务清库
- 查看当前系统版本

## 日常业务流程

推荐按下面顺序使用：

1. 先录入客户
2. 创建账单与订单
3. 上传或创建收据
4. 上传或创建付款明细
5. 上传或创建 SWIFT
6. 最后签收归档

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
