# API 开发基线

## 店铺品牌主页（2026-10-27）

| 方法 | 路径（省略 /v1） | 说明 |
| --- | --- | --- |
| GET | /merchant/storefront | 本店草稿、公开版、图片库、可选项目与团队、真实收藏/评价/近90天完成数 |
| PUT | /merchant/storefront | `{version, content}` 保存本店草稿；待审内容须先撤回 |
| POST | /merchant/storefront/images | `{mime, data}` 上传 JPEG/PNG，350 KB以内；服务端重编码、去元数据、加密保存 |
| DELETE | /merchant/storefront/images/{id} | 删除本店未使用图片；草稿、待审稿或当前公开版引用时409，不允许破坏在用素材 |
| POST | /merchant/storefront/submit | `{version}` 提交审核；三语介绍各至少8字符 |
| POST | /merchant/storefront/withdraw | `{version}` 撤回当前待审稿，原公开版继续展示 |
| GET | /admin/storefronts | supply.read；待审内容、引用图片、项目和团队资料 |
| POST | /admin/storefronts/{storeId}/review | supply.write；`{version, approved, note}`；意见至少4字符 |
| GET | /public/shop-assets/{id} | 当前公开版引用的品牌图片；其余仅本店及有审核权限的员工可预览，未授权404 |

`content` 包括三语 `tagline/about`，`logoId/coverId`，最多12张 `photoIds`，最多6项 `featuredOfferingIds` 和最多30人的 `teamListingIds`。引用必须属于本店，提交与通过时重新校验公开资格。图片库最多50张；本轮不增加套餐收费或付费排序。公开 `PublicStore.storefront` 只包含审核通过的发布快照，不含草稿、审核意见、内部存储信息。待审期间保留原公开版；版本冲突409，非法跨店引用400，角色无权403。发布品牌内容不改变交易规则版本，不使已有报价/保留失效。产品边界见 [店铺主页方案](SHOP_STOREFRONT_PLAN.md)。

## 技师照片与介绍视频（2026-10-27）

公开资料 `public/staff-listings` 的技师新增 `media`（已公开的相册照片与介绍视频，按展示顺序，不含已设为主照片的那张）；H5 列表 `public/h5/therapists` 每项新增 `serviceNames`（最多两项主要项目）。上门服务要求真实主照片：没有时 `listingSupports(listing, 'HOME_VISIT')` 为假，上门报价返回 `INVALID_OFFERING`，店铺开启上门返回 `MAIN_PHOTO_REQUIRED`。

| 方法 | 路径                                      | 角色                | 说明                                                                                                 |
| ---- | ----------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| GET  | `media?listingId=`                        | 技师 / 店铺         | 本人或本店技师的照片与视频（含状态、原因、是否主照片、举报数）；店铺不传 `listingId` 时返回全店      |
| POST | `media/photos`                            | 技师 / 店铺         | `{listingId?, mime, data, consent?}`；技师须 `consent: true`，结果为待店铺确认；店铺代传为待本人授权 |
| POST | `media/videos`                            | 技师 / 店铺         | 开始分段上传 `{listingId?, size, consent?}`，返回 `uploadId`、`chunkBytes`、`chunks`；30 分钟内有效  |
| POST | `media/videos/{uploadId}/chunks`          | 上传者本人          | `{index, data}`，每段原始 360,000 字节（末段为剩余）                                                 |
| POST | `media/videos/{uploadId}/finish`          | 上传者本人          | `{durationSeconds, poster:{mime,data}}`；校验 MP4/H.264、60 秒内，清除元数据后保存                   |
| POST | `media/{id}/authorize`                    | 技师                | 本人授权店铺代传的内容 `{version}`                                                                   |
| POST | `media/{id}/confirm`                      | 店铺                | `{version, approved, note?}`；退回须写原因（≥4 字）                                                  |
| POST | `media/{id}/withdraw`                     | 技师                | 撤回授权并立即下架 `{version}`                                                                       |
| POST | `media/{id}/remove`                       | 店铺 / 平台         | 下架 `{version, note}`                                                                               |
| POST | `media/{id}/cover`                        | 技师 / 店铺         | 把已公开照片设为主照片 `{version}`                                                                   |
| PUT  | `media/order?listingId=`                  | 技师 / 店铺         | `{ids}`：全部已公开内容的新顺序                                                                      |
| GET  | `admin/listing-media`                     | 平台 `supply.read`  | 待审核内容与被举报的公开内容                                                                         |
| POST | `admin/listing-media/{id}/review`         | 平台 `supply.write` | `{version, approved, note?}`：待审核→公开/退回；被举报→继续展示/下架；否决须写原因                   |
| POST | `customer/listing-media/{id}/report`      | 顾客                | `{reason, detail?}`，同一顾客对同一内容只计一次                                                      |
| GET  | `public/listing-media/{id}`、`.../poster` | 公开（已公开时）    | 文件或视频封面；视频支持 `Range` 分段读取（206）；审核前仅本人、店铺和平台可读，其他人 404           |

错误码：`CONSENT_REQUIRED`、`MEDIA_LIMIT`（照片 8 张 / 视频审核中 1 条）、`INVALID_PHOTO`、`INVALID_VIDEO`、`VIDEO_CODEC`、`VIDEO_TOO_LONG`、`UPLOAD_EXPIRED`、`INVALID_UPLOAD`、`NOTE_REQUIRED`、`INVALID_ORDER`、`INVALID_STATE`、`VERSION_CONFLICT`。业务规则见 [业务逻辑 3.4](BUSINESS_LOGIC.md#34-技师照片与介绍视频)。

## 平台端与技师端完善（2026-10-26）

新增 SOS 位置共享与平台紧急查看服务地点、技师出勤班次与安全接单条件、技师到店核销、平台暂停门店、店铺履约质量与停用善后清单、工单证据照片、门店地址检索，以及平台员工登录二次验证（`activate`/`login` 新增 `code`）。接口、权限与错误码见 [上线准备](LAUNCH_READINESS.md#5-新增接口)。

## 上门与到店预约（2026-10-26）

新增独立 `fulfillmentMode`，旧值缺省为 `HOME_VISIT`，到店为 `IN_STORE`。到店使用审核后的门店、独立价目和人员/接待资源保留，提交联系人而非上门地址；核销后从 `CONFIRMED` 开始服务。新增门店提交/审核、人员服务方式、到店价目、核销和关闭新上门预约等接口，详见 [接口及验证说明](DUAL_SERVICE_MODE_IMPLEMENTATION.md#4-新增与扩展接口)。

完成读取新增 `autoConfirmationEligible`；自动验收须有新政策快照，并检查普通售后及安全事件。无新政策快照的旧单仍走人工复核，避免在旧 24 小时截止时间自动记收。

## 业务规则修订（2026-10-26）

- `PUT /v1/merchant/booking-rules` 新增可选 `businessHours`：`{ startMinute, endMinute }`，日本时间、30 的倍数，`startMinute` 0–1410，`endMinute` 30–1440，`endMinute < startMinute` 表示跨午夜，`0–1440` 为全天；起止不能相同。省略保留现有设置。公开店铺 `bookingRules.businessHours` 仅在已配置时出现，未配置按默认 9:00–22:00。
- 指定时间报价不在店铺营业时间内时返回 422 `OUTSIDE_BOOKING_HOURS`；可约时段列表使用同一规则。
- 新增 `POST /v1/customer/bookings/{id}/payment-guarantee`，仅订单顾客，`{ version }`。用于上门前 48 小时预授权失败后重新认证；仅当 `paymentStatus=FAILED` 且未超过 `paymentActionBy` 时可用，否则 409 `INVALID_STATE`。订单新增可选 `paymentActionBy`（重新认证截止时间）。
- 支付失败未更新时，技师 `EN_ROUTE` 返回 402 `PAYMENT_REQUIRED`；顾客取消费为 0；逾期由后台免费取消，`cancelReason=PAYMENT_GUARANTEE_FAILED`。
- 完成验收确认窗口改为 72 小时；窗口内无确认、无异议的合格订单由后台自动确认并扣款一次，`completion.autoConfirmed=true`，时间线动作 `AUTO_CONFIRMED`。
- 即时单 `START` 只要求已到达，不再要求到达预计开始时间；指定时间预约不变。
- 平台订单监控：技师 SOS 读取正确的安全事件数据源；店铺已受理但尚未安排技师的订单在响应期限前触发 `RESPONSE_DUE` 预警。

## 四端业务一致性（2026-10-23）

统一规则与状态见 [业务逻辑总览](BUSINESS_LOGIC.md)。技师履约事件中的出发、到达、开始在同一事务内按 `assignedStaffId` 检查其他 `EN_ROUTE` / `ARRIVED` / `IN_SERVICE` 订单，包含计划占用已经过期的订单；存在时返回 `409 STAFF_VISIT_IN_PROGRESS`，不修改任一订单或追加成功进程。不会返回其他订单的标识、地址或店铺信息。提交足时结束进入 `AWAITING_COMPLETION` 后不再阻断下一笔出发。

SOLO 一键受理在写入确认前复用当前派单资格检查，包括有效绑定、身份/肖像、公开状态、本店项目、所需语言、酒店条件、即时有效待机与当前审核资格。条件变化返回 `409 INVALID_ASSIGNMENT`，保留原 `REQUESTED` 订单及版本，允许原店通过既有取消入口免费善后。H5/PC 共用中日英恢复提示。

## 地区交通费（2026-10-23）

- `PUT /v1/merchant/booking-rules` 新增可选 `areaTransportFees`：`{ [area]: fee }`，金额 0–20000 整数，地区必须是本店服务地区（否则 `INVALID_AREA`）。省略保留现有表，`{}` 删除。与指名费、取消政策、时段附加费共用 `version`、历史和审计。
- 公开店铺 `bookingRules.areaTransportFees` 仅在已配置时出现。
- `POST /v1/quotes` 的 `transportFee` 改为按报价地区计算：表中地区用表中金额，其他地区用项目交通费；项目交通费为 0 时始终为 0。提交订单时按同一规则复核，旧报价在表变化后返回 `SHOP_RULES_CHANGED`。
- `GET /v1/public/h5/therapists` 的行新增 `transportFee`（按 `area` 计算，未选地区时为项目交通费）；`travel=free` 与 `badges.freeTravel` 按该金额判断。

## 时段附加费（2026-10-23）

- `PUT /v1/merchant/booking-rules` 新增可选 `timeSurcharges`：`[{ startMinute, endMinute, amount }]`，最多 2 段；分钟为日本时间 0–1439 且为 15 的倍数，`endMinute < startMinute` 表示跨午夜，起止不能相同；`amount` 为 100–20000 的整数；各段不能重叠。省略该字段保留现有附加费，`[]` 删除。保存规则与指名费、取消政策共用 `version`、历史和审计。
- `GET /v1/public/staff-listings`、`/v1/public/stores/{slug}` 返回的店铺 `bookingRules.timeSurcharges` 仅在已配置时出现。
- `POST /v1/quotes` 的报价新增可选 `timeSurcharge`（按开始时间计算，已计入 `total`）。订单 `quote` 冻结该字段。
- `GET /v1/public/h5/therapists` 的行新增可选 `timeSurcharge`：`earliestAt` 落在附加费时段时出现，并已计入 `total` / `compareTotal`；`sort=price` 按扣除附加费后的基础价排序。

## 店铺指名费与取消政策（2026-10-19）

新增 `PUT /v1/merchant/booking-rules`，仅本店 MERCHANT：`version`（未配置为 0）、`nominationFee`（0–200000 整数）、`templateId=FLEXIBLE_2H|STANDARD_24H|CUSTOM`，CUSTOM 必须提供 `customPolicy`，其他模板禁止携带。自定义字段为 `freeBeforeMinutes`（30–10080）、`lateFeeBps`、`nearBeforeMinutes`（0 关闭第二档）、`nearFeeBps`、`noShowFeeBps`；费率 0–9900，第二档起点短于免费窗口、费率不降低，爽约不低于取消比例。即时取消及爽约证据保护字段由服务端固定。

店铺工作台增加有效 `bookingRules` 与最近五版 `bookingRulesHistory`；公开店铺增加自己的 `bookingRules`，包含政策及金额，不含操作人。报价增加 `bookingRulesVersion`，完整 `cancellationPolicy` 增加按门槛升序的可选 `scheduledTiers`。旧订单没有 tiers 时仍用旧单档政策。保存更新店铺 ruleVersion，旧未提交报价返回 SHOP_RULES_CHANGED；已提交订单保持冻结。费用修改的并发 version 冲突返回 409。完整规则见 [SHOP_PRICING_CANCELLATION.md](SHOP_PRICING_CANCELLATION.md)。

## 自动受理授权范围（2026-10-19）

`PUT /v1/merchant/settings` 保留 `version`（当前店铺 ruleVersion）、`acceptanceMode`、`emergencyContact`，新增可选 `acceptanceRule` 和 `confirmAuthorization`。仅本店 MERCHANT 可写。规则字段为 `active`、`instantEnabled`、`offeringIds`、`listingIds`、`areas`、`startHour`、`endHour`、`minTotal`、`maxTotal`、`dailyLimit`；未知字段和客户端授权人/时间均拒绝。范围归属与资格、金额/时段上下限、授权勾选、乐观版本由服务端校验。开启或修改有效授权需 `confirmAuthorization=true`，直接暂停不需要。

店铺快照增加 `store.acceptanceRule` 和最近五版 `acceptanceHistory`。服务端写入规则 `version/authorizedBy/authorizedAt` 与 `acceptanceRules` 历史。订单冻结 `acceptanceDecision`（`outcome/reason/evaluatedAt/rule`），只有店铺/平台的订单视图包含完整 rule；公开目录、顾客和技师不返回授权配置/授权人。

普通预约不匹配时设为 MANUAL / REQUESTED / PENDING / NOT_SENT，由店铺继续受理；即时预约不匹配返回 `INSTANT_UNAVAILABLE`，不创建订单或扣款。两个可约性接口增加可选 `area` 查询，前端切换地区重新读取。授权版本变化返回 `SHOP_RULES_CHANGED`；每日计数与提交处于同一事务，幂等重试不重复消耗额度。完整口径与验收见 [AUTO_ACCEPTANCE_RULES.md](AUTO_ACCEPTANCE_RULES.md)。

## 履约时间与用户完成验收（2026-10-18）

新增 `GET/POST /bookings/:id/completion`，覆盖用户确认/异议/授权更新、服务方异常、店铺复核重发和无费用关闭。写入要求重试键及订单版本，用户确认另核对金额；技师 `START` 不可提前开始，`COMPLETE` 仅进入 `AWAITING_COMPLETION`，不再扣款。用户足时验收且授权有效后才原子完成与记账，超时和异常不自动扣款。平台增加 `COMPLETION_REVIEW` 预警，时间线和原售后工单联动。详见[字段、身份与状态条件](SERVICE_COMPLETION_ACCEPTANCE.md#接口)。

## 财务报表、经营分析和快照导出（2026-10-18）

新增 `GET /merchant/reports`、`GET /admin/reports`、`POST /merchant/reports/export`、`POST /admin/reports/export` 和两端 `GET /reports/exports/:id`。以日本日期范围、店铺和汇总粒度生成同口径报表，分离实际发生、订单批次与当前余额。导出绑定来源令牌、重试键和权限，保存固定快照及必要审计；当前 `finance.read` 可读，独立 `finance.export` 仅OWNER/FINANCE可导出，下载也重新检查权限。详见 [报表接口与统计口径](FINANCIAL_REPORTS_ANALYTICS.md#接口)。

## 开票申请、票据与独立审批（2026-10-18）

新增 `GET /merchant/invoicing`、`GET /admin/invoicing`、`POST /merchant/invoicing/:storeId/profile`、`POST /merchant/invoicing/:storeId/requests`、`POST /admin/invoicing/:storeId/requests`（仅退款调整）和 `POST /billing/invoice-requests/:id/actions`。申请冻结抬头、来源和费用，核对版本与重试键；finance.write 复核、另一名 finance.approve 审批，审批人以外的财务开具。退款或对账更正使待开票来源重审，已开票退款追加调整单。auth/demo 可选 adminPersona:FINANCE，只创建固定本地演示财务身份。完整字段和边界见 [开票审批接口](INVOICING_APPROVAL.md#接口与数据)。

## 商户方案、年费与欠费（2026-10-18）

新增 `GET /merchant/subscription`、`GET /admin/subscriptions`、`POST /merchant/subscription/:storeId/actions`、`POST /billing/plan-invoices/:invoiceId/actions`；虚构身份目录 `GET /auth/demo-shops` 与 `GET /auth/demo-staff` 独立于公开曝光。已移除可无账单任意切换的 `merchant/billing/plan-changes`。方案写入校验版本和重试键，付款同时检查方案/账单版本；年费与服务款独立，平台财务不替商户选择方案。`FinanceWorkspace.billing` 显示计费状态、待付和限制摘要。完整字段与边界见 [方案接口](MERCHANT_PLAN_LIFECYCLE.md#接口与数据)。

## 账单、退款对账与结算核验（2026-10-18）

新增 `GET /merchant/billing`、`GET /admin/finance`、`POST /admin/finance/:storeId/entries/:entryId/report`、`POST /merchant/billing/:storeId/statements`、`POST /admin/finance/:storeId/statements`、`POST /admin/finance/:storeId/settlements` 与 `POST /finance/settlements/:batchId/actions`。渠道核对与平台核验写操作要求当前 `finance.write`；原店铺仅查看本店、生成账单、确认/异议。全部新增写接口要求重试键及版本或流水令牌，结果历史不可改写；售后或新退款阻断陈旧确认。接口只记录演示账务，不触发资金转移，完整路径、字段与状态见 [本轮接口](BILLING_RECONCILIATION.md#接口)。

## 平台订单监控与售后复核（2026-10-18）

新增 `GET /admin/order-monitor`、`POST /admin/order-alerts/:id/follow-up`、`GET/POST /support-tickets/:id/decision`、`POST /support-tickets/:id/decision/acknowledgment`。监控遵循订单读取、工单组别及安全权限，只读岗位不返回内部跟进说明；关注不能手工解除实际异常。处理结论核对工单、结论、订单、申请四版本，发布和回执绑定重试内容；平台不移动退款，实际执行与方案不符或重新申诉时阻止结案。订单协作新增按角色与实际条件过滤的最小平台关注提示。详见 [字段与边界](PLATFORM_ORDER_GOVERNANCE.md#接口)。

## 订单协作与改派重选（2026-10-18）

新增 `GET /bookings/:id/coordination`、`POST /bookings/:id/handoffs`、`GET /staff/handoffs`、`POST /work-handoffs/:id/actions` 和 `POST /merchant/bookings/:id/replacement-withdrawal`。订单进程仅返回事件白名单；店内协作不向顾客公开，技师不读取顾客工单与退款，原技师改派后仅能处理自己的事实协作。创建核对订单版本，后续操作核对协作版本，均绑定重试内容；撤回候选保留原期限。字段、权限与边界见 [订单协作接口](ORDER_COORDINATION.md#接口)。

## 常用地址、结算恢复与订单退款（2026-10-18）

新增本人地址簿读写、默认与删除，`GET /booking-holds/:id/submission` 原订单恢复，订单售后摘要、关联退款申请和原店铺决定接口。地址簿核对全簿版本；退款核对申请及订单双版本并限制实际可退余额，创建和决定使用重试键，退款与工单结果原子保存。普通结案不能隐藏待处理退款；平台升级不因退款静默关闭。完整字段和路径见 [本轮接口](MOBILE_CHECKOUT_AND_AFTERCARE.md#接口)。

## 店铺收藏与顾客站内消息（2026-10-18）

新增 `GET /v1/customer/store-favorites`、`GET/PUT /v1/customer/store-favorites/:storeId`、`GET /v1/customer/inbox`、`POST /v1/customer/inbox/read`。仅已验证顾客本人；收藏用版本核对且上限100家，消息分页20条、已读按显示版本确认，陈旧回执保留新回复未读。摘要不包含私密正文、地址、支付路由或技师私有工单。个人中心收藏总数包括技师与店铺。请求、返回和验证见 [本轮业务说明](H5_DISCOVERY_AND_INBOX.md#接口)。

## 顾客个人中心（2026-10-18）

`GET /v1/customer/overview` 仅顾客本人可读；返回待提交保留、进行中、可评价、本人未解决售后、收藏的真实计数，以及最近三笔订单最小摘要。有效保留返回恢复ID及到期；可评价返回本人首个操作目标。可选 `focus` 从本人全部未结束预约中优先选择待同意改派，再选择在途/服务中预约，随后按预约时间；包含原订单ID、状态、项目快照、时间、总价与 `requiresConsent`，不受最近三笔限制。排除地址、顾客标识、支付路由和技师私有工单。规则、验证和设备浏览记录边界见 [H5业务说明](H5_JOURNEY_REFINEMENT.md)。

## 四端体验与履约联动（2026-10-18）

新增公开评价与汇总、本人订单评价/撤回、收藏、当前条件复订、店铺回复/内容申诉、平台内容审核、服务端取消费用预览、技师预计到达和安全签到/店铺联系接口。完整路径、权限、版本、隐私与生产边界见 [四端实现说明](FOUR_PORTAL_EXPERIENCE.md#接口与实现)。新增写操作由服务端推导实际订单归属，不接受伪造顾客、店铺或服务人员身份；平台内容审核要求 supply.write，安全队列和处置要求 safety.write。

## 第十轮 员工账号与权限（2026-10-18）

新增 GET/POST `/admin/members`、PUT `/admin/members/{id}`、POST `/admin/members/{id}/invitation`，仅平台负责人可用；新增 POST `/auth/employee/invitation|activate|login` 实现邀请核验、激活与登录。输入、状态、权限矩阵和生产边界见 [EMPLOYEE_ACCESS.md](EMPLOYEE_ACCESS.md)。工单内部处理支持 `ownership=ASSIGN`、`assigneeId`，服务端检查账号状态、岗位及组别；候选返回 assignees，相关历史姓名返回 people。员工调整使旧会话失效，并原子释放失去处理资格的未结工单。后台聚合、旧入口、工单详情和修改均执行权限检查。

## 第六轮 店铺工作台（2026-10-18）

以下接口均要求 MERCHANT 会话，以会话 storeId 限定本店，写操作仍校验来源。

| 方法   | /v1 路径                                      | 参数与行为                                                                                                                                |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /merchant/workspace                           | 本店主体（不返回 PSP 路由账户）、全部本店服务与人员、有效不可约时间、计费比例、费用明细、同事务财务汇总                                   |
| POST   | /merchant/time-blocks                         | listingId、startAt、endAt、reason=BREAK/TIME_OFF/TRAINING；必需 Idempotency-Key；未来 90 天内开始、最长 14 天；与人员占用区间冲突返回 409 |
| DELETE | /merchant/time-blocks/{id}                    | JSON version；本店及版本校验后释放区间并关闭记录                                                                                          |
| PUT    | /merchant/services/{id}                       | version、price（1000–200000 整数日元）、transportFee（0–20000）、active；仅已审核 RELAXATION 项目；变更增加版本                           |
| PUT    | /merchant/settings                            | version（ruleVersion）、acceptanceMode、emergencyContact（5–120 字）；不能切换 SOLO 经营结构；变更增加 ruleVersion                        |
| GET    | /merchant/bookings/{id}/assignment-candidates | 返回本店满足项目、语言、酒店限制、待机及整个时段缓冲条件的可派人员；其他店铺订单 404                                                      |

报价增加可选 storeRuleVersion，新报价均写入当前版本；规则或项目价格变更后，未提交报价需重新获取。已提交订单仍按原报价和受理快照处理。所有原有资金、派单与售后接口保持原权限校验。完整行为见 [MERCHANT_EXPERIENCE.md](MERCHANT_EXPERIENCE.md)。

接口以 PRD 附录 A.3 为命名依据。该清单只列已实现的部分；`/v1/auth/*`、`/v1/payments/demo-authorizations`、通用读接口是本地演示扩展。未列出的完整 PRD API 尚未实现。

所有写请求要求 `Origin` 为配置的 Web 来源。身份来自 HttpOnly 演示会话，忽略前端自称的角色/商户字段。通过 Web 的 `/v1` 同源代理访问即可；原始 API 默认只监听 127.0.0.1:4000。

| 方法       | 路径（省略 /v1）                                            | 说明                                                                                       |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET        | /health                                                     | 运行模式与生产就绪状态                                                                     |
| POST       | /auth/demo                                                  | role、可选 storeId/staffId；本地演示身份                                                   |
| GET / POST | /auth/session / /auth/logout                                | 会话查询 / 注销                                                                            |
| GET        | /public/staff-listings                                      | area、language、mode 筛选                                                                  |
| GET        | /public/staff-listings/{slug}                               | 展示资料、所属店铺、SKU                                                                    |
| GET        | /public/staff-listings/{id}/availability                    | 可选 offeringId；包含服务时长和路程缓冲；`days` 1–14（默认 3）；已登录顾客按其安全条件过滤 |
| GET        | /public/stores/{slug}                                       | 店铺公开主体和服务                                                                         |
| GET        | /public/stores/{slug}/free-availability                     | offeringId、language；同店可用产能；`days` 与上行相同                                      |
| POST       | /quotes                                                     | listingId、offeringId、bookingMode、nominationType、startAt、area、requiredLanguage        |
| POST       | /booking-holds                                              | quoteId；L1、TTL、配额、全局冲突                                                           |
| GET        | /booking-holds/{holdId}                                     | 本人结算快照和已有支付认证恢复                                                             |
| POST       | /payments/demo-authorizations                               | holdId、challengePassed；不接受卡号                                                        |
| POST       | /bookings                                                   | holdId、quoteId、paymentId、address、termsAccepted、policyVersion；必须有 Idempotency-Key  |
| GET        | /bookings、/bookings/{id}                                   | 当前角色可访问订单；地址按角色/阶段脱敏                                                    |
| POST       | /customer/bookings/{id}/cancel                              | version；使用冻结政策                                                                      |
| POST       | /customer/bookings/{id}/payment-guarantee                   | version；预授权失败后在截止前重新认证                                                      |
| POST       | /customer/bookings/{id}/replacement-consent                 | version、approved                                                                          |
| GET / POST | /customer/bookings/{id}/messages                            | 读取 / 发送 text                                                                           |
| POST       | /merchant/bookings/{id}/accept、/reject、/cancel            | version；SOLO 原子确认                                                                     |
| POST       | /merchant/bookings/{id}/assignments、/replacement-proposals | version、listingId                                                                         |
| POST       | /merchant/bookings/{id}/refunds                             | version、amount，JPY 整数                                                                  |
| GET / POST | /merchant/bookings/{id}/messages                            | 本店订单沟通                                                                               |
| POST       | /merchant/billing/plan-changes                              | plan（演示切换，未收费）                                                                   |
| POST       | /staff/tasks/{id}/ack                                       | version、即时 arrivalMinutes                                                               |
| POST       | /staff/tasks/{id}/decline、/withdraw                        | version、reason                                                                            |
| POST       | /staff/tasks/{id}/events                                    | version、event：EN_ROUTE / ARRIVED / START / COMPLETE                                      |
| GET / POST | /staff/tasks/{id}/messages                                  | 仅已确认且进行中的本人任务                                                                 |
| PUT        | /staff/duty-status                                          | onDuty、可选 expectedAt（上次 dutyUpdatedAt）；4 小时待机失效，开始需资格有效              |
| POST       | /staff/safety-alerts                                        | bookingId、version、type：SOS / SAFETY_TERMINATION                                         |
| POST       | /admin/enforcement-actions                                  | listingId、suspend、reason；演示内容暂停/恢复                                              |
| GET        | /dashboard                                                  | 本店账务/事件或平台审计/安全/待投递数                                                      |

写操作的订单 `version` 不一致返回 409；无身份 401；无权限 403，资源隔离通常返回 404；时段冲突 409；支付保障缺失/失败 402；输入格式 422；频控 429。错误体统一为 `error.code`、`error.message` 和 `requestId`。业务实体使用当前共享 TypeScript 契约中的 camelCase；完整 OpenAPI 生成、snake_case 传输映射和兼容策略尚待固化。

## 管理后台与供给审核

| 方法 | 路径（省略 /v1） | 输入与边界                                                                                                                                 |
| ---- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET  | /admin/workspace | 仅 ADMIN；店铺/技师/服务、最少字段订单、费用明细、安全事件、工单摘要、最近 100 条审核、500 条审计、30 条通知摘要与演示配置                 |
| POST | /admin/reviews   | 仅 ADMIN；targetType=STORE/LISTING/OFFERING、targetId、decision=APPROVE/SUSPEND/REJECT、version、reason（trim 后 10–500 字）；拒绝额外字段 |

Store/Listing 的 `moderationVersion` 对旧数据默认 1，服务使用已有 `version`。审核在事务中检查版本、保存决定与私密依据；审计和通知只带记录引用。旧 enforcement 接口同步增加 Listing 审核版本。店铺审核同时更新 `ruleVersion`，使旧报价失效，不修改已有预约。恢复店铺/技师检查必要资料；LICENSED 服务禁止通过普通审核流程。服务通过审核不改变店铺自己的 active 开关。

快照不返回 PSP 路由；订单视图移除详细地址、顾客标识（含 quote 内字段）、paymentId 和 holdId；工单仅为摘要，详细工单仍受现有权限保护。`system.pending` 是本地待投递记录数，不代表真实发送失败。界面 `/{locale}/admin/support?case={id}` 可在登录后精确打开获授权工单。

## 技师工作台与休息审批

| 方法 | 路径（省略 /v1）                 | 权限与输入                                                                                        |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET  | /staff/workspace                 | 本人资料、所属店铺摘要、服务、有效日程、休息申请和安全摘要；不含支付路由或其他技师                |
| POST | /staff/time-off-requests         | 本人；startAt、endAt（JST 对应时间戳）、reason：BREAK / TIME_OFF / TRAINING；Idempotency-Key 必填 |
| PUT  | /staff/time-off-requests/{id}    | 本人待审批申请；version、decision=WITHDRAWN                                                       |
| PUT  | /merchant/time-off-requests/{id} | 本店待审批申请；version、decision=APPROVED / REJECTED                                             |

申请状态：PENDING / APPROVED / REJECTED / WITHDRAWN / EXPIRED。申请提交不占用时段；批准在事务中再次检查预约、交通缓冲与禁约冲突，成功后写共享忙碌区间。店铺可用已有 time-blocks 删除接口解除批准时段。待审批申请到开始时间自动过期，状态变更均检查版本并审计。storeId、staffId、listingId 从会话推导；请求体不接受这些字段。店铺工作台返回本店 `timeOffRequests`，本人工作台返回自己的 `requests`，均包含所有待审批和最近 100 条历史。

## 第二轮新增 售后与安全

第九轮新增管理员内部处理接口：

| 方法 | 路径（省略 /v1）                     | 权限与输入                                                                 |
| ---- | ------------------------------------ | -------------------------------------------------------------------------- |
| GET  | /admin/support-tickets/{id}/handling | 仅 ADMIN；handling 与内部 history；未处理旧记录默认 version=0              |
| PUT  | /admin/support-tickets/{id}/handling | 仅 ADMIN；ticketVersion、version、team、state、ownership、followUpAt、note |

team 为 CUSTOMER_SUPPORT / MERCHANT_OPERATIONS / TRUST_SAFETY；可写 state 为 TRIAGE / ACTIVE / WAITING_CUSTOMER / WAITING_MERCHANT / WAITING_INTERNAL，DONE 随结案自动同步。ownership 为 KEEP / CLAIM / RELEASE，认领人从会话推导；note 为 10–3000 字，followUpAt 为未来七天内的毫秒时间戳。内部安排不改变原回复期限或共享范围；私密报告不能等待店铺回复；双版本冲突返回 409，未知字段/格式错误返回 422。普通工单读接口不返回内部处理信息，`admin/workspace` 仅增加无正文的 `caseHandling`。详细规则与验收见 [CASE_HANDLING.md](CASE_HANDLING.md)。

| 方法       | 路径（省略 /v1）                       | 权限与输入                                                                                  |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| POST       | /customer/support-tickets              | 顾客；bookingId（普通问题必填）、category、subject、description，Idempotency-Key 必填       |
| GET        | /support-tickets                       | 只返回当前提交人、本店可共享问题或平台可见的问题                                            |
| GET        | /support-tickets/{id}                  | 同上；ticket 与 messages，不附带顾客地址                                                    |
| POST       | /support-tickets/{id}/messages         | 有权参与者；version、text                                                                   |
| POST       | /support-tickets/{id}/actions          | version、action、text；ESCALATE / RESOLVE / CLOSE / REOPEN                                  |
| POST       | /staff/customer-feedback               | 获派技师；bookingId、text；生成私密安全报告并暂停本店新预约                                 |
| GET        | /merchant/customer-blocks              | 仅本店负责人可读内部拒接原因                                                                |
| PUT        | /merchant/customer-blocks/{customerId} | active、reason、version；新记录 version=0；本店有预约关系；安全审核中的记录不能绕过平台解除 |
| GET        | /customer/restrictions                 | 当前顾客有效限制；只返回 id、expiresAt、version                                             |
| GET / POST | /admin/customer-restrictions           | 平台；写入 customerId、active、reason、expiresAt、version；启用期限须在 30 天以内           |
| POST       | /customer/restriction-appeals          | 被限制顾客；version（限制版本）、text；重复提交返回同一待审申诉                             |
| GET        | /safety-events                         | 平台全量、本店或技师本人事件；平台处置正文不会返回给店铺/技师                               |
| POST       | /admin/safety-events/{id}/resolve      | 平台；version、text（至少 10 字）；处理结果与审计                                           |

工单 action 的 `releaseRestriction` 与 `releaseShopBlock` 默认为 false，仅平台 RESOLVE 可使用。前者只用于对应版本的账号限制申诉；后者只用于技师私密安全报告，仍有其他待审报告时不可解除。普通工单结案不触发退款。工单超时升级由定时 sweep 和接口读取时共同触发。

安全、资质、隐私、财务异常与申诉正文属于 PLATFORM_ONLY。普通工单升级平台后，原店铺仍可查阅原共享记录和答复，但不能越过平台直接结案。所有可变记录使用版本校验；过期决定返回 VERSION_CONFLICT 或 RESTRICTION_CHANGED。

## 第四轮 预约上下文与修改

公开目录增加 `bookingRules`，包括指名费与取消规则；两个可约性接口增加 `mode=INSTANT`，FREE 查询按项目与语言匹配同店人员。本人结算快照增加 `visit`，包含项目名、时长、实际保留人员的酒店限制、店铺受理方式；FREE 不展示内部保留人员的姓名/图片。详见 [DETAIL_AND_BOOKING_EXPERIENCE.md](DETAIL_AND_BOOKING_EXPERIENCE.md)。

`DELETE /booking-holds/{holdId}` 仅顾客本人可用，释放未提交的 CHECKOUT_HOLD、人员占用区间和未使用的演示支付保障；重复释放成功返回 `{released:true}`。其他顾客返回 404，非顾客 403，已关联预约或已转换阶段返回 409。它不代替订单取消接口，释放与下单处于同一事务串行化机制。
