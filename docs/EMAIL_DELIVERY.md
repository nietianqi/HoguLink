# 注册验证邮件与 Gmail 发信

现有注册流程使用 30 分钟有效的一次性验证链接，找回密码链接有效 15 分钟。此接入不改为六位验证码，也不修改支付流程。

## Gmail / SMTP 配置

将设置放在被 Git 忽略的 `hogulink-api/.env` 中。示例只含占位值，禁止将真实应用密码写入源码、文档或版本库。

```dotenv
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-mailbox@gmail.com
SMTP_PASSWORD_FILE=../secrets/gmail-smtp-app-password
EMAIL_FROM="HoguLink <your-mailbox@gmail.com>"
NOTIFICATION_EMAIL_SCOPE=customer-auth
PUBLIC_WEB_URL=http://localhost:3000
WEB_ORIGIN=http://localhost:3000
RUN_BACKGROUND_JOBS=1
```

在根目录 `secrets/gmail-smtp-app-password` 文件中只写应用专用密码。也可使用 `SMTP_PASSWORD` 环境变量；两种方式二选一。Gmail 展示的分组空格会自动移除。应用密码必须属于 `SMTP_USER` 对应的账号。

- 465：连接即 TLS。
- 587：强制 STARTTLS，升级失败则停止，不回退明文认证。
- 验证服务器证书，关闭 SMTP 协议日志；邮件内容不允许从文件或远程 URL 读取。
- 配置由 API 与工作进程启动时读取，修改后需要重新启动相关进程。
- 本地验证链接只能在能访问这台电脑的网站环境中打开；正式部署时将两个 URL 改成同一个正式 HTTPS 域名。

## 先验证登录，再启用发信

在项目根目录运行：

```powershell
npm run smtp:verify -w @hogulink/api
```

成功返回 `smtp=authenticated` 和 `emailSent=false`：只验证服务器连接和账号认证，不发送邮件、不领取队列。它不代表邮件已经到达收件箱。

核对无误后设定 `EMAIL_PROVIDER=smtp`，启动 API（内置后台任务默认开启），或关闭 API 内置后台任务后单独启动 worker。注册、重发、找回密码均复用原有加密队列、重试及过期判断。

## 发信范围与历史演示队列

首次接入推荐 `NOTIFICATION_EMAIL_SCOPE=customer-auth`，仅发送 `CUSTOMER_VERIFY`、`CUSTOMER_RESET`。订单、员工邀请、技师邀请、安全和售后通知仍保留原状态，不会因为接入 Gmail 自动发出历史演示邮件。此限制同样覆盖重试与已过期的处理租约。

以后需要发送全部业务通知时，可改为 `NOTIFICATION_EMAIL_SCOPE=all`；切换前应审核历史待发送队列。平台通知快照中的 `deliveryScope` 显示当前范围。默认不设置时保留原有全部通知行为。

SMTP 成功必须同时满足服务器接受目标收件人及返回 2xx 最终响应，之后才记录 `PROVIDER_ACCEPTED`。这表示发件服务器受理，不等于收件箱送达。重试使用稳定 Message-ID；SMTP 无法保证断线等不确定情况下绝不重复发送。

## 验收

1. 在注册页面使用自己控制的邮箱注册。
2. 确认收到邮件，点击验证链接，然后登录。
3. 验证已使用链接、过期链接、重发后的旧链接失效。
4. 验证找回密码邮件仍使用独立用途和有效期。
5. 检查退信/垃圾邮件及额度限制，避免把“服务商受理”显示为“用户已收到”。

自动化测试不连接真实 Gmail、不发送外部邮件；真实服务器认证另用上面的只读连接检查。

参考：[Google 应用专用密码](https://support.google.com/accounts/answer/185833?hl=zh-Hans)、[Google SMTP](https://developers.google.com/workspace/gmail/imap/imap-smtp)、[Nodemailer SMTP](https://nodemailer.com/smtp)。
