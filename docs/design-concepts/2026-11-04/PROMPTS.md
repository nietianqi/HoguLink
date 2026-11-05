# HoguLink PC首页图像生成说明

日期：2026-11-04。使用内置图像生成工具。画布为PC首页视口，目标1440×1024；最终输出按生成工具自然比例保存，未拉伸或后期修改图片。

实际展示顺序与文件对应：

1. `pc-home-option-1.png`：Quiet Editorial Split。
2. `pc-home-option-2.png`：Immersive Quiet Retreat。
3. `pc-home-option-3.png`：Reservation First, Calm Precision。

三张图均为未落地的设计方向；网站业务与界面未因这些效果图改变。

## 基线核对

最新提交为de80ad2。PC样式层`hogulink-web/src/app/pc-consumer.css`的最后修改来自该提交；对比当前工作区，PC样式、首页结构、refinement.css及h5-home.css没有新增差异。前一轮调整为本地开发字体加载的来源配置。现有quiet-interior-v1.png已查看并作为影像参考。

演示目录读取为15个项目、6位技师、3家店铺。用户参考图的33／11／5没有作为真实数量沿用。

## 参考图

- `reference-wireframe.png`：用户提供的低保真构图。
- `reference-current-home.jpg`：本次对话此前检查的现有PC首页；代码视觉基线核对后未变，仅作功能连续性参考。
- `../../../hogulink-web/public/images/quiet-interior-v1.png`：已有生成式空间影像，作为情绪与构图参考，不代表实际商家场所。

## 公共提示词

Create a realistic, production-quality HIGH-FIDELITY DESKTOP WEBSITE UI mockup for HoguLink, a Tokyo relaxation-service booking marketplace. This is a refined visual concept, not executable code, not a screenshot of the existing product. Render a single complete primary homepage viewport with impeccable Chinese typography and credible spatial design. Target composition 1440 x 1024 desktop, full-bleed website content only; no device frame, browser frame, presentation border, multiple-screen montage, explanatory callouts or option labels. Current date anchor 2026-11-04 JST; no need to show a date beyond a neutral "选择日期" field.
REFERENCE INPUTS: Image 1 is the user's low-fidelity warm-white / forest-green wireframe, use its restrained mood, booking bar and three browsing entrances as inspiration, but replace all grey placeholders with intentional imagery and correct its inaccurate counts. Image 2 is the existing project's GENERATED conceptual quiet interior; use its sunlit linen, natural timber, towels and Tokyo spatial atmosphere for the hero. It is mood imagery, NOT a real merchant premises. Image 3 is the current website screenshot: use ONLY to understand functional continuity, not its bright mint-heavy style or blurry raster typography. All generated UI text must be crisp and newly typeset.
BUSINESS INVARIANTS: Real local demo catalog counts are 15 projects, 6 therapists, 3 shops. Do not invent 33 projects, 11 therapists, 5 shops, stars, review totals, sales, awards or instant availability. All portrait/service photography is illustrative mock data. Do not imply actual online payment already works. Do not claim "only charged after explicit confirmation" (existing policies also permit eligible automatic confirmation). Use neutral trust microcopy "费用明示 · 店铺提供服务 · 订单内售后". No booking hotel rooms, check-in/out, guest counts, room rates, maps or travel packages. This is booking relaxation appointments, not hotel accommodation. Service mode must be user selected; do not preselect it. Preserve 项目 / 技师 / 店铺 as three clear browse routes. Arrival at a shop vs home visit is independent from appointment time. Exact quote depends on region and time, so show "起" and reference-price scope, NOT a fixed all-inclusive total for unknown conditions.
VISUAL SYSTEM: Warm white #FAF9F5 main surface, crisp white secondary surfaces, forest green #104E43 for primary button and selected state, dark neutral #25322D for text, subdued stone gray #74766F, thin warm-neutral separators #DEDCD3, only muted oxblood #8C4C3B for prices. Never use gold borders, gradients of bright emerald, dense mint panels, bright red discount boxes, neon colors, heavy shadows, excessive pills or glassmorphism. Green is an accent, not a solid giant hero rectangle. A sophisticated Chinese Ming/Song serif only for the hero title, matching clean sans-serif for UI and body. 48-56 px hero headline, 28 px section title, 16 px body, minimum visually readable 13-14 px secondary labels. Generous intentional breathing room; bounded 1200px content width; align all edges. Avoid excessive dead space: appointment action and a first useful result row must remain visible. Use photographic space imagery and differently cropped credible wellness service photographs, never empty gray placeholders. Minimal line icons, no emoji. Restrained 12-16px corner radii, subtle hairline separation, shadows only when needed.
COPY: Brand HoguLink. Header navigation "选项目" "选技师" "选店铺" "发现"; right "中文" and "我的". One central primary CTA label "查找可约". Hero title may read "把放松，\n请到你身边" or a short equally clear Chinese relaxation headline. Small visible product descriptor "东京放松服务预约". Main booking controls "服务方式" with "请选择", "地区" with "东京都心", "日期" with "选择日期", "时长" with "60 分钟". Three browse entries "按项目" / "15 个服务项目 →", "按技师" / "6 位技师 →", "按店铺" / "3 家店铺 →". If project cards are shown use exactly three illustrative offerings: "舒缓放松" / "森 · 东京" / "上门 · 60 分钟" / "¥8,700 起"; "肩颈舒缓" / "森 · 东京" / "上门 · 60 分钟" / "¥9,300 起"; "腿部舒缓" / "森 · 东京" / "上门 · 60 分钟" / "¥9,100 起". Their action is subtle "查看时段 →". A single shared price note "所示为参考起价，实际费用以所选地区、时间及人员报价为准". Don't repeat long fee disclaimers on every card. A tiny page-level caption "设计示意 · 图片为示意素材" is permissible. The homepage should demonstrate one hero task and only one or two supporting areas; leave community, merchant onboarding and full legal footer off-screen rather than cramming a feature inventory. Never mislabel therapist cards as projects. Max one badge on any card. All Chinese must be coherent, natural, legible, accurate and professionally typeset.


## 独立方向说明

Quiet Editorial Split：导航下方43%文字／57%空间摄影左右分栏，明朝体标题“把放松，请到你身边”；四字段预约条跨在主视觉下边界，唯一主按钮“查找可约”。下方用细线分出按项目／技师／店铺及准确数量，再呈现完整三列项目卡与统一参考价说明。轻阴影只用于预约条。

Immersive Quiet Retreat：整幅空间摄影首屏，左侧柔和遮罩上的浅色明朝体标题“为自己，留一段放松时光”；宽预约条位于摄影下方。三个浏览入口、三列编辑式项目图文和底部信任说明依次排列，更多使用留白与细线而非卡片边框。

Reservation First, Calm Precision：左42%为标题“合适的放松，从这里开始”和2×2预约字段，宽主按钮紧随；右58%为独立大幅空间摄影。下方是三入口与三张横向图文项目卡。主任务为快速查找，保持整排结果在画面内。

每张独立生成均采用公共提示词和对应方向的完整布局约束，附同一组三份视觉参考。没有采用命令行或外部图像API。
