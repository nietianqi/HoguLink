# 第三十一轮：支付以外的运行基础

更新：2026-10-19。支付服务接入按用户要求暂缓。本轮完善顾客账号、通知执行、查询性能、私有文件、备份与封闭测试部署；`productionReady` 继续为 `false`。

## 已实现

| 范围       | 行为                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 顾客账号   | 独立随机身份、邮箱注册/验证、密码登录、找回密码、验证邮件重发；姓名/邮箱/地址/订单按本人隔离。密码为异步 scrypt 哈希。测试使用独立临时数据库、文件目录和密钥，默认禁止外部通知。               |
| 验证与恢复 | 邮箱链接有效 30 分钟，密码恢复链接有效 15 分钟；令牌只存哈希、单次使用、重发后旧链接失效。邮件中的令牌使用 URL fragment，同页打开也能识别。                                                    |
| 会话与限流 | 登录轮换会话；密码重设使该顾客全部旧会话失效。Cookie 为 HttpOnly/SameSite=Strict，HTTPS/生产进程增加 Secure。限流持久化到数据库，多个进程共享计数。                                            |
| 演示边界   | `DEMO_ACCESS_ENABLED=0` 禁止演示身份、演示名单和旧演示会话；三端隐藏相应演示入口，保留正式账号登录。默认本地模式仍可显式选择共享示例顾客，仅用于虚构资料。                                     |
| 通知       | Resend 或签名 HTTP 网关；独立工作进程领取队列、租约回收、幂等投递、失败退避和人工重试。账号邮件优先，服务商接受后才记录 `PROVIDER_ACCEPTED`。未配置服务保留待投递，缺少收件人为 `BLOCKED`。    |
| 通知权限   | 订单通知按顾客、店主和仍在店的当前技师选择收件人。受保护的安全/平台私有工单不通知顾客或店铺；运营提醒需配置值守邮箱。正文不附地址、证件、投诉或被拦截会话原文。                                |
| 会话审核   | 中日英规则匹配并标准化常见字符变体；拦截后提交加密安全审核队列，返回未发送状态。仅安全岗位可查看原文并留审核结论，查看留审计，审核不会自动补发消息。                                           |
| 查询与期限 | 公开目录、可约时段走只读查询；通过到期索引判断是否需要补偿清理。历史订单按状态、店铺、顾客和服务日过滤；自动受理额度用数据库计数，取消后仍占已使用额度。                                       |
| 数据库     | 版本化初始化、字段表达式及组合索引、到期投影。PostgreSQL 写事务使用 SERIALIZABLE 和有界整事务重试，取消进程全局队列及全局 advisory lock；只读事务使用独立连接。SQLite 仍使用单连接写入串行化。 |
| 私有数据   | 公开目录与两类收藏统一明确字段白名单，保留公开价格与取消政策。新写入的订单地址、地址簿、顾客/合作账号信息、会话正文、申请草稿和内部审核说明加密；查询所需的状态、归属及时间字段保留索引。      |
| 文件与恢复 | 新证件保存为私有目录中的 AES-256-GCM 加密文件，数据库保存引用；读取继续检查本人/审核权限。备份包含记录、占用区间和证件内容，整体加密；恢复要求空数据库并核验文件。                             |
| 部署基础   | 多阶段容器、独立工作进程、每日加密备份、Caddy HTTPS/访问口令、私有数据库网络、文件型密钥、只读容器、安全头和健康检查；新增 CI 检查及独立 PostgreSQL 验收脚本。                                 |

数据层继续使用 JSON 领域记录配合索引与到期投影。平台大报表及部分历史汇总仍需按生产数据量分页、聚合和容量验收。

## 本轮验证

- 609 项后端测试与 74 项前端规则/会话测试，共 683 项；类型和生产构建通过。
- 原有 1514 项隔离 HTTP/SSR 检查；公开字段收口后重新完成全套检查；另有 33 项独立顾客账号 HTTP 检查，关闭演示入口后验证双账号隔离、会话轮换和密码恢复。
- 三语浏览器注册→验证→登录→返回→退出；密码找回→邮件→重设→新密码登录；拦截会话→平台查看→审核完成。
- 中日英 × 320/390/768/1440：登录、注册、找回、验证、重设、条款/隐私、通知与安全审核，共 108 组布局；另检查关闭演示后的 12 个顾客/合作方/客服入口。未发现横向溢出或浏览器运行错误。
- 浏览器使用现有开发预览，将 API 请求转到独立测试后端；测试注册、订单和邮件未写入主预览。独立前端验收服务的启动被自动审批拦截，工具只返回 `blocked by policy`，采用上述隔离连接完成页面验收。独立生产前端运行、TLS 和容器部署仍需环境验收。
- 依赖审计未报告生产依赖已知漏洞；该结果的范围为依赖审计。

证据：`.qa/nonpayment-check-final.log`、`.qa/nonpayment-smoke-final.log`、`.qa/nonpayment-http-report.json`、`.qa/nonpayment-browser-report.json`、`.qa/nonpayment-benchmark.log`、`.qa/nonpayment-dependency-audit.json`。

### 本地查询复测

SQLite 内存库、完整历史订单、同进程调用，单次列为 5 次平均。网络、真实 PostgreSQL 和服务器容量另行验收。

| 历史订单数 | 公开目录 | 即时目录 | 可约时段 | 20 个并发目录查询合计 |
| ---------- | -------- | -------- | -------- | --------------------- |
| 0          | 0.36 ms  | 0.77 ms  | 1.00 ms  | 10.46 ms              |
| 2,000      | 0.30 ms  | 0.64 ms  | 0.88 ms  | 5.85 ms               |
| 10,000     | 0.50 ms  | 0.79 ms  | 1.06 ms  | 6.86 ms               |
| 30,000     | 0.29 ms  | 0.84 ms  | 0.79 ms  | 7.19 ms               |

## 账号和通知配置

API 设置放在 `hogulink-api/.env`，参考根目录 `.env.example`。默认 `EMAIL_PROVIDER=disabled`，不会发送外部邮件；页面明确显示未接通。可使用以下任一方式：

1. `EMAIL_PROVIDER=resend`，提供 `RESEND_API_KEY`、已验证域名的 `EMAIL_FROM`、`PUBLIC_WEB_URL` 和 `WEB_ORIGIN`。
2. `EMAIL_PROVIDER=webhook`，提供 HTTPS `NOTIFICATION_WEBHOOK_URL` 和至少 32 字符的 `NOTIFICATION_WEBHOOK_SECRET`。仅开发进程允许本机 HTTP 接收端。

网关接收 `{id,email:{to,subject,text}}`。验证 `X-Hogu-Signature = HMAC-SHA256(secret, timestamp + '.' + 原始请求体)`，检查时间窗口，按 `Idempotency-Key` 去重，成功时返回 `{messageId:string}`。`SENT` 表示服务商受理，收件人实际收到/阅读、退信及外部送达回执需再接入。

订单、合作资料、人员邀请和员工邀请可进入邮件执行通道。安全值守还需设置 `OPS_NOTIFICATION_EMAIL` 并落实值守人员。短信、LINE 和真实身份核验尚待选定服务接入；顾客邮箱验证维持 L1，不会模拟提高为 L3。

新增顾客接口均为 POST：

| 路径（前缀 `/v1/auth/customer/`）         | 输入                                            |
| ----------------------------------------- | ----------------------------------------------- |
| `register`                                | `email,password,name,locale,termsAccepted:true` |
| `login`                                   | `email,password`                                |
| `resend-verification` / `forgot-password` | `email,locale?`                                 |
| `verify-email`                            | `token`                                         |
| `reset-password`                          | `token,password`                                |

密码 12–128 字符。重复注册/找回请求返回统一受理结果。API 同源检查与数据库限流共同生效。管理入口为 `/{locale}/account/access`、平台系统状态和 `/{locale}/admin/safety-review`。

## 私有文件与加密备份

共享环境必须设置同一个 `DATA_ENCRYPTION_KEY`：32 个随机字节的标准 base64。开发环境未配置时，在工作目录 `data/.local-encryption-key` 原子生成本地密钥。密钥与密文应分开备份；保留既有密钥才能读取既有数据。本轮未实现自动密钥轮换。

在根目录执行以下工作区命令；环境变量应先指向目标数据库、私有文件目录和对应密钥：

```powershell
npm run maintenance -w @hogulink/api -- migrate
npm run maintenance -w @hogulink/api -- backup ../backups/before-migration.enc
npm run maintenance -w @hogulink/api -- migrate-evidence
npm run maintenance -w @hogulink/api -- migrate-private
```

迁移前停止应用写入并制作备份。新上传已直接使用加密文件；存量 base64 文件需执行 `migrate-evidence`，其余旧私有字段需执行 `migrate-private`。旧数据库页、WAL、历史备份和保留副本需要纳入运营方的留存清理方案。

恢复使用新的空数据库和独立证件目录，保留原密钥，然后执行：

```powershell
npm run maintenance -w @hogulink/api -- restore ../backups/before-migration.enc
```

命令拒绝覆盖非空数据库和不同内容的证件文件。定时备份每 24 小时生成新文件，目录由 `BACKUP_DIRECTORY` 设置；需另行配置离机保存、保留期限、空间告警和恢复演练。当前逻辑快照在内存中组装，大数据量应补充数据库原生备份方案。

技师照片和视频封面随备份保存；技师介绍视频（每个最大 20 MB）不进入加密快照，只保留记录。请把 `EVIDENCE_DIRECTORY` 目录按文件级方式一起离机备份；只恢复快照时，视频记录仍在但文件缺失，播放会返回 404，需要技师重新上传。

## 封闭测试部署

`compose.staging.yaml` 提供 PostgreSQL、API、通知/清理进程、备份进程、前端和 Caddy。仅网关暴露 80/443；演示登录及演示播种关闭，支付明确使用模拟实现，搜索收录维持关闭。

1. 复制 `.env.staging.example` 为 `.env.staging`，填写实际测试域名、证书联系邮箱、发件人和值守邮箱。
2. 在被忽略的 `secrets/` 中提供 `database_password`、`database_url`、`data_encryption_key`、`resend_api_key` 和 `staging_auth`。数据库 URL 指向容器内 `postgres:5432/hogulink`；密码与数据库密码文件一致，特殊字符需作 URL 编码。`staging_auth` 内容为 `测试访问用户名 bcrypt哈希`，可用 Caddy 的 `hash-password` 生成哈希。
3. 检查 DNS、文件权限、备份卷和服务器资源后构建并启动封闭测试环境。配置可先用下列命令验证：

```powershell
docker compose --env-file .env.staging -f compose.staging.yaml config --quiet
```

应用通过 `*_FILE` 读取文件型密钥，密钥不进入构建上下文。前端内部 API 地址及公开站点地址通过构建参数传入。容器构建先生成 Next 路由类型，支持干净环境检查。

首次正式平台账号使用维护命令 `bootstrap-owner`。通过环境或受保护的密码文件提供 `ADMIN_BOOTSTRAP_EMAIL`、16–128 字符的 `ADMIN_BOOTSTRAP_PASSWORD`，命令拒绝覆盖已有正式 OWNER，不输出密码。随后通过平台员工登录和邀请流程管理账号。

`/v1/health` 检查数据库连通；`/v1/health/ready` 检查后台心跳。封闭部署另外开启 `BACKUP_REQUIRED=1`、`NOTIFICATIONS_REQUIRED=1`：备份失败/超过 26 小时、投递失败/缺少收件人或待处理超过 5 分钟，返回 503。外部监控应检查这些状态及容器日志；邮件发送服务异常时仍需独立的运营告警通道。

本机 Docker 引擎不可用，已验证 Compose 配置语法，未运行容器、真实 PostgreSQL、自动证书或部署。`npm run test:postgres` 提供独立验收：需显式配置本地、库名以 `_test` 结尾的 `TEST_DATABASE_URL`；使用随机临时 schema 检查事务重试、重叠约束、队列领取及身份不可变约束。新增 CI 配有独立 PostgreSQL 服务，需推送后实际执行并检查结果。

## 仍需外部条件与正式验收

- 实际邮件域名/密钥和送达回执、LINE/SMS、身份核验、商户/人员资料核验与真实值守。
- 正式运营主体、合同/隐私/留存规则的审定；新增账号条款页面明确标注测试版。
- PostgreSQL/容器实机验证、备份离机恢复、真实设备、负载、权限渗透与安全审查。
- 用户暂缓的支付、真实银行/财务/税务服务；原有模拟支付行为继续保留。
- 人员/SKU 差异指名费、交通和时段附加费等未在本轮扩展。

可继续本地演示和封闭测试准备。正式对外运营仍需完成上述接入和验收。
