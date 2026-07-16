# 收汇管理系统

一个面向外贸收款流程的业务系统，用来把客户、发票、收据、付款明细和 SWIFT 水单串成一条可追踪的收款链路。

## 当前版本

- 版本：`1.0.204`
- 最近更新：继续清理未使用依赖，移除没有任何页面或业务代码引用的 React 工具包及其 5 个子依赖；系统功能不变。
- 版本号位置：`设置` 页面顶部。

## 界面预览

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/5408577a-9709-40e8-8398-812934a6cedf" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/089de920-4857-44c2-bc40-40daac98a87d" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/9ffb773e-8b7e-4671-b588-19b2277d9f24" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/10cc0ec7-245b-4837-95a1-df15319540b6" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/8e8e06fd-04e7-49fa-8598-5bb748f98faf" />

<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/3dd0716a-57dc-4cc7-b053-bebd31afc02b" />

<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/5d2e4355-aaee-4dc9-9567-ada6b889b159" />

<img width="1905" height="919" alt="image" src="https://github.com/user-attachments/assets/bd7faddd-e47d-4bad-ac42-4f625ae5a0c9" />

## 主要模块

| 模块 | 用途 |
|---|---|
| Dashboard | 查看业务概览、待处理事项、欠款排行和客户分析；可按 MARK、ORDER_NAME、NAME 或具体 ORDER NO 查询客户历史订单和付款；支持按账号隐藏和排序卡片 |
| Invoice Management | 创建发票、维护订单金额、查看 Outstanding |
| Orders | 维护不参与财务余额的业务订单跟踪，并记录订单确认日期 |
| Receipt Management | 上传收据、直接创建收据、生成签名收据 |
| Payment Detail Management | 上传或创建付款明细，导出付款明细图片；默认聚焦未完成明细 |
| SWIFT Management | 上传图片或 PDF 水单，完成银行转账链路；默认聚焦未完成水单 |
| Approval | 审批删除申请和修改申请 |
| Customer Management | 维护客户、ORDER_NAME、CONSIGNEE、绑定关系和客户公司文件 |
| Settings | 管理账号、系统配置、Dashboard 卡片、图片压缩、Excel Token、审计 |

## 推荐使用流程

1. 先维护客户资料。
2. 创建发票和订单。
3. 上传或创建收据。
4. 上传或创建付款明细。
5. 上传 SWIFT 图片或 PDF。
6. 管理员最终确认收款完成。

如果出现异常，优先检查：

- 客户信息不完整：到 `Customer Management` 修复。
- 订单或发票匹配错误：在对应记录的修改入口重新绑定。
- 金额不一致：检查 Invoice、Receipt、Payment Detail、SWIFT 是否挂到同一个 ORDER。
- 需要删除：走 `Approval` 审批，不直接删数据。

## 权限说明

| 角色 | 权限说明 |
|---|---|
| ADMIN | 可查看全局数据、审批、管理账号、修改系统配置 |
| SALES | 可维护自己权限范围内的客户和业务数据；部分修改需要上级审批 |
| USER | 只能查看和处理自己可见范围内的数据，不能做系统管理 |

## 数据安全

系统业务数据主要分两类：

- MySQL `trading_ledger`：客户、发票、订单、收据、付款明细、SWIFT、审批、配置、审计。
- NAS 上传目录：收据图片、付款明细图片、SWIFT 图片/PDF、签名收据图片、付款代理附件、客户公司文件。

不要随意执行会删除数据的 Docker 命令，例如：

```bash
docker compose down -v
```

完整数据文件、上传目录、清理规则和外部接口说明见：[data-and-integrations.md](docs/data-and-integrations.md)。

腾讯云 COS 备份运行手册见：[muledger-cos-backup.md](docs/backup/muledger-cos-backup.md)。

## 启动与更新

本地日常更新和重建：

```bash
scripts/rebuild-local-app.sh
```

这个脚本只重建 app、刷新维护服务，并检查服务是否可访问；不会删除数据库、Docker volume 或上传目录。

首次启动或需要整体拉起服务时：

```bash
docker compose up -d --build
```

如果涉及数据库迁移、Caddy/证书、生产环境变量、备份路径或上传目录变更，不能只靠一键脚本，需要先按工程清单确认风险。

启动后访问：

- 本地 HTTPS：[https://localhost](https://localhost)

## 更多文档

- [todolist.md](todolist.md)：用户能看懂的版本里程碑和后续计划。
- [ENGINEERING_LOG.md](ENGINEERING_LOG.md)：工程内部流水、测试门禁、技术变更记录。
- [CHANGE_CHECKLIST.md](CHANGE_CHECKLIST.md)：每类改动必须同步检查的事项。
- [API_TESTING.md](docs/API_TESTING.md)：API 自动化测试说明。
- [data-and-integrations.md](docs/data-and-integrations.md)：数据文件、外部接口、上传目录和清理规则。
