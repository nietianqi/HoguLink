import type { Locale } from '@hogulink/contracts';

const words = {
  completed: ['完了', 'Completed', '已完成'],
  closed: ['キャンセル等', 'Cancelled / expired', '取消 / 关闭'],
  review: ['評価待ち', 'To review', '待评价'],
  tasks: ['対応が必要な予約', 'Your next action', '需要你处理'],
  current: ['現在の予約', 'Current booking', '当前预约'],
  guestHelp: [
    'ログインして予約・登録住所・サポートを確認できます。',
    'Sign in to manage bookings, saved addresses and support.',
    '登录后管理预约、常用地址和售后。',
  ],
  guestOrders: [
    'ログイン後、予約の進捗がここに表示されます。',
    'Your booking progress will appear here after you sign in.',
    '登录后，这里会展示你的预约进度。',
  ],
  empty: ['進行中の予約はありません', 'No active bookings', '暂无进行中的预约'],
  emptyHelp: [
    'メニュー・スタッフ・店舗から、次の予約を探せます。',
    'Explore services, therapists and shops for your next booking.',
    '从项目、技师或店铺中，选择下一次服务。',
  ],
  details: ['予約詳細', 'Booking details', '查看预约'],
  consent: ['変更内容を確認', 'Review therapist change', '确认技师改派'],
  consentHelp: [
    '変更内容を確認し、同意するかお選びください。',
    'Review the proposed change before accepting or declining.',
    '店铺提出了技师改派，请查看后自主选择是否同意。',
  ],
  completion: ['サービス完了を確認', 'Review completion', '确认服务完成'],
  completionHelp: [
    'サービス内容を確認してから完了確認へお進みください。',
    'Review your service before confirming completion.',
    '请核对服务情况，再确认完成或提出异议。',
  ],
  waitingHelp: [
    '店舗・スタッフの確認状況は予約詳細で確認できます。',
    'See your booking for the shop and therapist confirmation.',
    '店铺与技师确认进度，请查看预约详情。',
  ],
  storeHelp: [
    '予約日時に店舗へお越しください。経路は予約詳細から確認できます。',
    'Visit the shop at your booked time. Directions are in the booking details.',
    '请按预约时间到店，地址和路线可在预约详情查看。',
  ],
  homeHelp: [
    '予約した場所でお待ちください。到着状況は予約詳細で確認できます。',
    'Be ready at your booked address. Arrival updates are in your booking details.',
    '请在预约地点等候，技师到达进度可在预约详情查看。',
  ],
  liveHelp: [
    'サービスの進捗とお問い合わせは予約詳細へ。',
    'Open your booking for service progress and support.',
    '查看服务进度，或从预约详情联系店铺。',
  ],
  checkedInHelp: [
    '来店受付済みです。店舗のご案内をお待ちください。',
    'You have checked in. The shop will help you get ready.',
    '已完成到店签到，请等待店铺安排开始服务。',
  ],
  arrivedHelp: [
    'スタッフが到着しました。ご不明点は店舗へお問い合わせください。',
    'Your therapist has arrived. Contact the shop if you need help.',
    '技师已到达，如需协助请从预约详情联系店铺。',
  ],
  onWayHelp: [
    'スタッフが向かっています。到着予定は予約詳細で確認できます。',
    'Your therapist is on the way. Check your booking for arrival updates.',
    '技师正在前往预约地点，预计到达时间请查看预约详情。',
  ],
  recent: ['最近の予約', 'Recent bookings', '最近预约'],
  again: ['もう一度予約', 'Book again', '再约一次'],
  againHelp: [
    '最新料金と空き状況で、新しい日時をお選びください。',
    'Choose a new time at current prices and availability.',
    '按最新价格和可约状态重新选择时间。',
  ],
  today: ['今日', 'Today', '今天'],
  tomorrow: ['明日', 'Tomorrow', '明天'],
  soon: ['まもなく開始', 'Starting shortly', '即将开始'],
  due: [
    '予約時刻になりました。最新状況をご確認ください。',
    'Your booked time has arrived. Check the latest progress.',
    '预约时间已到，请查看最新进度。',
  ],
  minutes: ['分後に開始', 'minutes until your visit', '分钟后开始'],
  duration: ['分', 'min', '分钟'],
  hourUnit: ['時間', 'h', '小时'],
  minuteUnit: ['分', 'min', '分钟'],
  startsIn: ['後に開始', 'until your visit', '后开始'],
  place: ['サービス地域', 'Service area', '服务区域'],
  retry: ['再試行', 'Try again', '重新加载'],
  loadUnavailable: [
    '予約情報を読み込めません。再試行してください。',
    'Your booking information could not be loaded. Please try again.',
    '暂时无法读取预约信息，请重新加载。',
  ],
  reviewUnavailable: [
    '評価待ちの予約を取得できません。再試行してください。',
    'Could not load bookings to review. Please try again.',
    '暂时无法获取待评价预约，请重新加载。',
  ],
  noReviews: ['評価待ちの予約はありません', 'No bookings waiting for a review', '暂无待评价预约'],
  browse: ['メニューを見る', 'Explore services', '去选服务'],
  guide: ['予約ガイド', 'Booking guide', '预约指南'],
  help: ['相談・サポート', 'Help & support', '帮助与售后'],
} as const;
export type AccountText = keyof typeof words;
export const at = (locale: Locale, key: AccountText) =>
  words[key][locale === 'ja' ? 0 : locale === 'en' ? 1 : 2];
