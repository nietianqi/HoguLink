import type { DiscoveryArticle, Localized } from '@hogulink/contracts';
const text = (zh: string, ja: string, en: string): Localized => ({ 'zh-cn': zh, ja, en });
// Authored booking guidance, never presented as customer posts, medical advice or verified provider stories.
export const discoveryArticles: DiscoveryArticle[] = [
  {
    slug: 'choose-your-visit',
    category: 'planning',
    title: text(
      '先选一段属于自己的时间',
      '自分のための時間を選ぶ',
      'Make a little time for yourself',
    ),
    summary: text(
      '从时长、地区和服务语言开始，让预约更适合你的日常。',
      '時間・エリア・対応言語から、暮らしに合う予約へ。',
      'Start with a duration, area and language that fit your day.',
    ),
    sections: [
      {
        heading: text('先看时长与总价', '時間と合計料金を確認', 'Start with duration and total'),
        text: text(
          '项目页可按60、90或120分钟筛选。比较时一起查看服务费、交通费和指名费；项目起价不代表所选时段已被保留。',
          'メニューは60・90・120分で絞り込めます。サービス料・交通費・指名料を含めて比較してください。最低料金の表示だけでは日時は確保されません。',
          'Filter services by 60, 90 or 120 minutes. Compare service, travel and nomination fees together. A listed starting price does not reserve a time.',
        ),
      },
      {
        heading: text(
          '把条件带到预约页',
          '条件を予約画面へ',
          'Carry your preferences into booking',
        ),
        text: text(
          '选择服务地区与语言，再查看店铺和合适的技师。预约页会重新核对当前价格、资格和时段；建立有效保留后，才能继续提交预约。',
          '対応エリアと言語を選び、店舗とスタッフを確認します。予約画面では現在の料金・資格・空き時間を再確認し、有効な仮確保後に予約を送信します。',
          'Choose an area and language, then review the shop and therapists. Booking checks current prices, eligibility and times again; a valid hold is needed before submitting.',
        ),
      },
    ],
  },
  {
    slug: 'nomination-and-shop-assignment',
    category: 'planning',
    title: text(
      '指定技师，还是由店铺安排？',
      '指名とおまかせ、どう違う？',
      'Choose a therapist, or let the shop assign?',
    ),
    summary: text(
      '两种选择，都保留明确的服务责任与费用说明。',
      'どちらも、提供事業者と料金を明確に確認できます。',
      'Both options keep the provider and fees clear.',
    ),
    sections: [
      {
        heading: text('喜欢某位技师时', 'スタッフを指名する場合', 'When you have someone in mind'),
        text: text(
          '指定预约会展示指名费。所选技师需要确认任务；如需更换，店铺会提出方案，由你明确同意。未经同意不会把指定预约直接改为另一位技师。',
          '指名予約には指名料が表示されます。担当者による確認が必要です。変更が必要な場合、店舗が提案し、お客様の明示的な同意を得ます。',
          'A nominated booking shows a nomination fee and needs the therapist’s confirmation. If a change is needed, the shop proposes it for your explicit approval.',
        ),
      },
      {
        heading: text(
          '更在意项目与时间时',
          'メニューと時間を優先する場合',
          'When the service and time matter most',
        ),
        text: text(
          '选择由店铺安排，不收指名费。店铺只可安排同店符合资格且满足已选语言等条件的人员；无法安排时不会用无关店铺或不合格人员替代。',
          'おまかせは指名料なし。同じ店舗の有資格で、選択した言語などの条件に合うスタッフを手配します。他店舗や条件を満たさない人で代替しません。',
          'Shop assignment has no nomination fee. The shop assigns eligible members of its own team who match required preferences such as language. It cannot substitute another shop or an ineligible person.',
        ),
      },
    ],
  },
  {
    slug: 'a-considered-first-visit',
    category: 'safety',
    title: text(
      '第一次预约，把安心放在前面',
      '初めての予約、安心を大切に',
      'A considered first visit',
    ),
    summary: text(
      '确认提供方、地址使用范围，以及需要帮助时的入口。',
      '提供事業者、住所の扱い、困ったときの連絡先を確認。',
      'Know your provider, address privacy and where to ask for help.',
    ),
    sections: [
      {
        heading: text(
          '认清服务提供方',
          'サービス提供事業者を確認',
          'Know who provides the service',
        ),
        text: text(
          '店铺负责服务合同、定价、履约与退款。下单前请核对店铺法定信息、费用和取消规则。HoguLink 上的放松项目不属于医疗诊断或治疗。',
          '契約・料金設定・サービス提供・返金は店舗の事業者が担当します。予約前に法定表示、料金、キャンセル条件を確認してください。リラクゼーションは診断・治療ではありません。',
          'The shop is responsible for the contract, pricing, delivery and refunds. Check its business information, fees and cancellation rules before booking. Relaxation services are not medical diagnosis or treatment.',
        ),
      },
      {
        heading: text('沟通与求助', '連絡とサポート', 'Communication and help'),
        text: text(
          '完整地址仅在任务所需期间向已确认的履约技师显示。通过订单内消息沟通；服务问题可从对应订单发起售后。骚扰与性服务被禁止，涉及隐私或安全的工单仅平台处理。紧急情况请联系当地紧急服务。',
          '詳しい住所は、業務に必要な期間だけ確認済みの担当者に表示されます。連絡は予約内メッセージへ。問題があれば該当予約からお問い合わせください。ハラスメント・性的サービスは禁止です。プライバシー・安全案件は運営のみが対応します。緊急時は地域の緊急窓口へ。',
          'The full address is shown only to the confirmed therapist while needed for the task. Use booking messages to communicate and open a support case for a service issue. Harassment and sexual services are prohibited. Privacy and safety cases are handled only by the platform. Use local emergency services in an emergency.',
        ),
      },
    ],
  },
];
