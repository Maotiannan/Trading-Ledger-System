# mucont 客户身份读取 V1

## 契约与用途

本接口服务于客户体系 V2 的两阶段读取：先分页检索轻量候选，选中后按稳定的 Ledger `Customer.id` 读取最新完整主档。归属变化不影响可见性；客户删除返回 404，不按姓名寻找替代客户。

- 唯一生产方契约：[JSON Schema](mucont-customers-v1.schema.json)。
- 合成联调样本：[Fixtures](mucont-customers-v1.fixtures.json)。
- 成功响应直接返回对象，不使用旧接口的 `success/data` 包裹。
- 全部响应包含 `Cache-Control: no-store`，不对浏览器开放跨域授权。
- `Customer.id` 承担身份；MARK、姓名、公司、ORDER NAME 均可重复或变更。

mucont 后端保存稳定 ID 和当次资料快照。PI、采购、配货等中间流程传递已有身份和文本；发票准备阶段按绑定 ID 再获取一次资料。Ledger 不持续推送或改写下游业务快照。

## 配置与凭证

部署环境 `MUCONT_CUSTOMERS_READ_TOKEN` 配置至少 32 字符的随机凭证。mucont 后端通过 `Authorization: Bearer <credential>` 访问，凭证不进入浏览器、源码、样本或日志。为空或配置不完整时，只有本组接口返回 503；原业务不受影响。

该凭证只允许以下两个 GET 读取固定资料字段，覆盖全部客户，无 owner 或员工账号依赖。它与 Excel Token、MU Contract 反向订单同步 Token 不通用。轮换时同步更新两端配置；旧候选分页游标会失效，重新加载首批即可，已保存的客户 ID 不受影响。

读取复用现有限流基础设施和 `EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS/MAX` 配置，使用独立服务身份限流键。审计采用 `mucont.customer.read` 结构化日志，记录端点类型、HTTP 状态和耗时，不记录搜索文本、完整资料或凭证。GET 不修改业务表或客户更新时间。

## 候选接口

```http
GET /api/integrations/mucont/v1/customers/options?q=&limit=20&cursor=...
Authorization: Bearer <server-only credential>
```

- 空 q：首批客户；默认 20 条，正整数 limit 上限 50，超过上限截断为 50；0、负数、小数等返回 400。
- q：Unicode NFKC、去首尾空白、合并连续空白、小写规范化，最多 200 字符。
- 在全部客户的姓名、公司、MARK、ORDER NAME 和别名中进行大小写不敏感的包含搜索；另复用规范化 MARK/ORDER NAME，支持忽略空格的标识检索。生产和测试 MySQL 使用大小写不敏感 collation。
- SQL 直接查询 Customer 并使用别名关系谓词，不先读取整个目录、不读取地址等详情，也不会按别名产生重复客户。
- 按稳定 Customer.id 升序 keyset 分页，签名 cursor 绑定规范化 q 和排序；换 q 清空 cursor，非法或跨 q 的 cursor 返回 400。
- 列表属于当下的候选集合，分页期间并发新增/删除不冻结目录；删除游标指向的客户仍可继续按 ID 范围读取。
- 末页固定 `nextCursor: null, hasMore: false`，空结果同样如此。

```json
{"items":[{"customerId":"fixture-customer-001","mark":"DEMO","name":"Example Customer","companyName":null}],"nextCursor":null,"hasMore":false}
```

## 详情接口

```http
GET /api/integrations/mucont/v1/customers/{customerId}
Authorization: Bearer <server-only credential>
```

只按 ID 查询，不接受显示值回查。Customer、ORDER NAME 别名和 CONSIGNEE 位于同一个 `RepeatableRead` 数据库事务中，读取一致的已提交状态，不缓存、不回退到候选内容。

响应为 `customerId/capturedAt/completeness/profile`。profile 包含 `name/companyName/companyAddress/phone/city/mark/orderNames/consignee/consignees`。缺值明确返回 null 或空数组；不编造税号或将接口未约定的财务、owner、联系方式设置等字段暴露出去。

- `capturedAt`：本次读取完成的 UTC ISO 时间，不冒充 Customer.updatedAt。
- `completeness: MASTER_FULL`：本接口约定的字段集合完整，不代表每个字段都已有值。
- ORDER NAME 合并主字段和别名，复用现有忽略空格、大小写去重规则。
- CONSIGNEE 优先主收货人，兼容旧主字段和多个选项；过滤 `-` 等空白占位，不写回或修正主表。

## 错误

所有错误为 `{"error":{"code":"...","message":"..."}}`。英文 message 面向集成服务，客户端应按 code 判断。

| HTTP | code | 处理 |
| --- | --- | --- |
| 400 | INVALID_QUERY / INVALID_CURSOR | 修正参数或重新加载首批 |
| 401 | AUTH_REQUIRED / AUTH_INVALID | 核对服务凭证；浏览器会话和 Excel Token 均不替代它 |
| 404 | CUSTOMER_NOT_FOUND | 保留已有身份和历史快照，禁止按名称自动换绑 |
| 429 | RATE_LIMITED | 按 Retry-After 秒数重试；error.retryAfterMs 同时提供毫秒 |
| 503 | SERVICE_UNAVAILABLE | 配置未就绪或后端暂不可读；保留旧快照，不能标为已取得最新资料 |

数据库异常不向客户端泄露 SQL、地址、内部凭证或堆栈。没有新增初始化、修复或批量身份改写端点。

## 旧接口兼容与单独风险

保留 `/api/sync/customers/by-orders`、CONSIGNEE 显式写回、Excel ML 和 MU Contract OrderTracker 反向同步。共享订单查询先匹配完整 raw/canonical 订单，未命中才执行原有组合片段/别名回退；同一完整订单真实关联多客户仍报告冲突，既有人工保护和幂等判断不变。

旧 `/api/sync/customers` 的两项分页风险已经独立核查，本 V1 不依赖该接口，本次不扩大修复：

1. `nextStreamCursor()`：一个流有未消费事件、没有 previous cursor 时，若另一流占满本页，则将其游标推进 highWatermark，可能跳过该流。后续兼容修复需保留未消费流起点，并覆盖混合流首批分页。
2. 删除流先 take 再按 owner 过滤，隐藏删除事件可能耗尽页窗口并误报 hasMore=false，导致可见删除事件遗漏。后续修复应在 SQL 应用可见性或正确遍历过滤窗口。

不为 V1 引入目录同步 worker、outbox、租约、停用状态或 owner 撤销体系。

## 验证与恢复

```sh
npm test -- --runInBand src/lib/integrations/mucont-customer src/lib/order-customer-lookup-service.test.ts
npm run test:api:isolated -- --case 92-mucont-customers-v1
```

隔离 API 测试使用临时 MariaDB、专用数据库和本机合成凭证，覆盖跨 owner 同名客户、53 条分页、别名去重、非法游标、最新资料、归属转移、删除、凭证隔离及旧订单完整匹配。429/503 和日志脱敏由单测验证；CI 继续执行完整既有 API/E2E 流程。

本轮无数据库迁移、持久化表或媒体文件新增。Customer/CustomerOrderName/CustomerConsignee 仍由完整 MySQL 快照覆盖，见[备份与恢复手册](../backup/muledger-local-backup.md)。服务凭证为独立受保护部署配置，恢复时从安全来源配置或重新签发；不写进业务备份文档。
