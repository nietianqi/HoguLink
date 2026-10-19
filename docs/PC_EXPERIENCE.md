# PC 端业务与视觉完善

2026-10-17。依据 V1.4 第 2、3、48、52、54 章推进现有代码；需求文档中的经营、法律与发布决策仍作为需求记录。

## 行业参考与取舍

查阅官方公开页面的业务结构，未使用同行商标、照片、评论或交易数据。

| 来源                                                                                                            | 可借鉴的体验                                     | 本轮落地                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| [HOGUGU](https://hogugu.com/)                                                                                   | 技师发现、地区入口、明确的服务时长与价格         | 区域/语言/即时与预约搜索，所属店铺入口                                   |
| [Treatwell 按摩列表](https://www.treatwell.co.uk/places/treatment-group-massage/offer-type-local/in-london-uk/) | 服务项目价格、筛选、下一个可预约时间             | 按时长与含费用总价筛选，真实空闲时段预览与直接带入预约                   |
| [Fresha 业务功能](https://www.fresha.com/for-business/features)                                                 | 预约管理、日程、团队协作、客户沟通               | 四角色预约队列、日程视图、选中详情、售后工作区                           |
| [Airbnb 设计参考](design-references/airbnb-DESIGN.md)                                                           | 宽松间距、易读文字、分段搜索、影像主导的信息层级 | 保留 HoguLink 深绿品牌，采用暖白、留白与空间主图，规则见根目录 DESIGN.md |

## 已实现

1. 顾客端：重新设计桌面首页、浮动搜索、左侧筛选、卡片与列表视图；按 60/90/120 分钟、预约日期、含指名费及交通费的预算、店铺受理方式组合筛选。按总价和最近时段排序。
2. 价格：根据技师实际支持的项目展示对应时长的总价，交通费取自该报价，指名费按现有演示规则 ¥500。区分住宅/酒店与仅接酒店的限制。
3. 时段：使用现有预约可用性接口，保留服务时长与时间缓冲逻辑；未来 72 小时内可选；点击时段传递项目、开始时间、区域、语言；预约页再次确认，未把预览当成锁定成功。接口失败时明确提示。
4. 工作台：顾客、店铺、技师、平台共用桌面侧栏；入口均指向已存在页面或实际章节；概览展示当前授权范围的数量、角色待办、履约中数量、扣款减退款的金额，平台安全数只计算未处置事件。
5. 订单：状态、日期、订单号/店铺/技师搜索取交集；列表每页 8 条、日程视图、选择详情；待处理按角色判断；翻页与选择联动。切换身份清除旧列表、草稿和详情，异步结果使用版本保护。
6. 导出：按当前筛选导出 CSV，包括订单号、店铺、技师、日本时间、状态、报价总额和扣款净额；不导出顾客标识与地址；转义引号并防止表格公式注入。
7. 售后：标题/工单号搜索、待处理/优先处理/已解决筛选，选择与详情同步；切换记录时清空旧详情，避免新选择对应旧操作。
8. 三语言：新增功能的日/英/简中标签；1280–1920 桌面适配，窄屏收起侧栏并重排筛选、身份栏与详情；表格在自身区域滚动。

## 验收与边界

- `npm run check`：包含既有 57 项业务测试与新增 5 项 PC 业务规则测试、类型检查、生产构建。
- `npm run smoke` / `npm run smoke:care`：分别 72 / 90 项 HTTP 与 SSR 断言。
- 浏览器检查覆盖筛选交集、时段带入、列表/日程、订单选择、搜索与重置、导出、售后过滤，以及桌面和窄屏页面；最终结果见 QA_REPORT.md。
- 分页与导出针对当前角色已授权的本地订单列表；大规模真实供给上线前需增加服务端分页、查询索引、导出限量与任务机制。
- 当前日期窗口仍为原有 72 小时；没有冒充远期营业日历。工作台净额不是 PSP 结算额或利润。暂无伪造评分、评价与增长趋势。
- 真实身份、PSP、LINE、生产审核与上线工作继续按原开发计划推进，本轮未改变其完成状态。

## 影像资产

模式：使用 imagegen 技能与内置图像生成工具生成新图，无参考图。输出：`hogulink-web/public/images/quiet-interior-v1.png`。用于空间氛围，人物仍为演示插画。

生成提示词：

> Create a premium architectural editorial photograph for HoguLink, a Tokyo at-home relaxation booking platform. Wide landscape 3:2 composition, quiet contemporary Japanese hotel suite living area, warm ivory plaster walls, beautiful walnut wood joinery and low side table, gently rumpled natural linen sofa, neatly folded cream towels on stone tray, one small branch in a ceramic vase, soft late afternoon sunlight through sheer curtains creating elongated shadows. Elegant understated luxury, natural tactile materials, subtle olive detail, warm desaturated color grading, professional medium-format architectural photography, photorealistic, no people, no text, no logo, no spa cliches, no medical equipment. Strong beautiful composed image with generous quiet negative space upper left. For a website hero crop.
