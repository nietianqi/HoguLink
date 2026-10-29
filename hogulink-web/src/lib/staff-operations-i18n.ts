import type { Locale } from '@hogulink/contracts';
const words = {
  workspace: ['技師ワークスペース', 'Therapist workspace', '技师工作台'],
  pending: ['返答が必要です', 'Tasks need your reply', '有任务等待回应'],
  respond: ['タスクを確認', 'Review task', '查看待回应任务'],
  due: ['返答期限まで', 'Reply within', '距回应截止'],
  minutes: ['分', 'min', '分钟'],
  hours: ['時間', 'h', '小时'],
  today: ['今日', 'Today', '今天'],
  tomorrow: ['明日', 'Tomorrow', '明天'],
  yesterday: ['昨日', 'Yesterday', '昨天'],
  startsIn: ['開始まで', 'Starts in', '距开始还有'],
  scheduled: ['予約時刻を迎えました', 'Scheduled time reached', '已到预约时间'],
  working: ['対応中', 'In progress', '正在履约'],
  next: ['次の操作', 'Next action', '下一步操作'],
  details: ['タスクの詳細', 'Task details', '任务详情'],
  order: ['予約番号', 'Booking reference', '预约编号'],
  arrivalWindow: [
    '出発・到着の記録は予約の90分前から可能です。',
    'Departure and arrival records open 90 minutes before the appointment.',
    '预约前90分钟可记录出发和到达。',
  ],
  travelWait: ['出発・到着の記録開始', 'Travel records open at', '出发／到达记录开放时间'],
  TRAVEL_TOO_EARLY: [
    '出発・到着は予約の90分前から記録できます。',
    'You can record departure and arrival from 90 minutes before the appointment.',
    '请在预约前90分钟内记录出发或到达。',
  ],
  place: ['サービス場所', 'Service location', '服务地点'],
  prepareVenue: ['店舗での準備', 'Prepare at the venue', '到店服务准备'],
  prepareVenueHelp: [
    '店舗の場所・担当ベッド・お客様の来店確認をご確認ください。',
    'Check the venue, assigned space and customer check-in.',
    '确认门店、接待位置及顾客到店核销情况。',
  ],
  scheduleHelp: [
    '訪問は移動時間、来店は店舗の準備時間も確保します。',
    'Home visits reserve travel time; in-store visits reserve venue preparation time.',
    '上门预留交通时间，到店预留门店清场时间。',
  ],
  turnover: ['店舗の準備時間を確保', 'Venue turnaround time reserved', '已预留门店清场时间'],
  noRequests: ['休みの申請はまだありません。', 'No time off requests yet.', '暂无休息申请。'],
  standbyUnavailable: ['即時予約は受付停止中', 'Instant bookings unavailable', '即时单暂未开放'],
  paused: [
    '店舗は新規予約の受付を停止中です。既存のタスクは引き続き対応してください。',
    'Your shop has paused new bookings. Existing tasks still need your attention.',
    '店铺已暂停接受新预约，已有任务仍需处理。',
  ],
  standbyHelp: [
    '待機は即時予約のみが対象です。日時指定の予約は出勤シフトで管理します。',
    'Standby affects instant bookings only. Scheduled bookings follow your working shifts.',
    '待机只影响即时单；指定时间预约按出勤班次安排。',
  ],
  shifts: ['出勤シフトを確認', 'Check working shifts', '查看出勤班次'],
  quickMessages: ['定型メッセージ', 'Quick messages', '快捷消息'],
  quickDeparting: ['出発の連絡', 'Departing', '已出发'],
  quickArrived: ['到着の連絡', 'Arrived', '已到达'],
  quickVenueReady: ['来店の案内', 'Check-in reminder', '到店提醒'],
  quickVenueContact: ['遅刻の確認', 'Late arrival', '迟到联系'],
  quickConfirmTime: ['予約の確認', 'Confirm appointment', '确认预约'],
  departing: [
    'これから出発します。到着後、予約メッセージでご連絡します。',
    'I am leaving for your appointment and will message you when I arrive.',
    '您好，我已出发，到达后会通过订单消息联系您。',
  ],
  arrived: [
    '到着しました。予約メッセージからご連絡ください。',
    'I have arrived. Please contact me through this booking.',
    '您好，我已到达，请通过订单消息与我联系。',
  ],
  venueReady: [
    '店舗でお待ちしています。ご来店の際は受付コードをご提示ください。',
    'We are ready at the venue. Please show your check-in code when you arrive.',
    '您好，门店已准备好接待您，到店后请出示核销码。',
  ],
  venueContact: [
    'ご来店予定時刻になりました。遅れる場合は予約メッセージでご連絡ください。',
    'It is time for your appointment. Please message us if you are running late.',
    '您好，已到预约时间，如需晚到请通过订单消息与我们联系。',
  ],
  confirmTime: [
    'ご予約の時間にお伺いします。変更のご相談は予約メッセージからお願いします。',
    'Your appointment is scheduled as shown. Please message us to discuss any change.',
    '您好，将按预约时间提供服务，如需调整请通过订单消息联系。',
  ],
  offline: [
    '接続がありません。操作は送信されていません。接続後に内容を確認して再送してください。',
    'You are offline. Your action was not sent. Review and retry after reconnecting.',
    '当前网络未连接，操作尚未提交。恢复网络后请核对并重试。',
  ],
  syncing: ['最新のタスクを確認中', 'Checking latest tasks', '正在同步最新任务'],
  synced: ['最新のタスクを表示しています', 'Showing latest tasks', '已同步最新任务'],
  alerts: ['タスク通知', 'Task alerts', '任务提醒'],
  enableAlerts: ['通知を有効にする', 'Enable alerts', '开启任务提醒'],
  disableAlerts: ['通知をオフにする', 'Disable alerts', '关闭任务提醒'],
  alertsOn: ['通知オン', 'Alerts on', '提醒已开启'],
  alertsHelp: [
    'ページを開いている間の音・振動と、対応ブラウザーの通知です。画面を閉じた時やロック中の配信は保証されません。',
    'Sound, supported-device vibration and browser alerts work while this page is open. Delivery after closing or locking the screen is not guaranteed.',
    '开启后可使用声音、设备支持的震动和浏览器提醒。需保持页面打开，关闭网页或锁屏后不能保证收到。',
  ],
  pageOnly: [
    'ブラウザー通知は利用できません。ページ内の案内は引き続き表示します。',
    'Browser notifications are unavailable. On-page reminders still work.',
    '浏览器通知暂不可用，仍可查看网页内提醒。',
  ],
  newWork: [
    '担当タスクを確認してください',
    'Please review your assigned tasks',
    '请及时处理获派任务',
  ],
  public: ['公開プロフィール', 'Public profile', '公开资料'],
  media: ['写真・動画', 'Photos & video', '照片视频'],
  settings: ['サービス設定', 'Service settings', '服务设置'],
  performance: ['実績・評価', 'Work & reviews', '业绩与评价'],
  month: ['今月の実績', 'This month’s work', '本月服务业绩'],
  completed: ['完了した予約', 'Completed bookings', '已完成预约'],
  serviceMinutes: ['購入されたサービス時間', 'Purchased service minutes', '已完成服务时长'],
  performanceHelp: [
    '予約日（日本時間）が今月で、完了したサービスのみ集計します。',
    'Completed services whose appointment date falls in this month, using Japan time.',
    '按日本时间的预约日期统计本月已完成服务。',
  ],
  incomeHelp: [
    '報酬・精算は所属店舗にご確認ください。予約金額を個人報酬として表示しません。',
    'Your shop confirms your pay and settlement. Booking totals are not shown as personal earnings.',
    '个人报酬和结算由所属店铺确认，订单金额不作为个人收入展示。',
  ],
  reviews: ['自分への公開評価', 'My published reviews', '我的公开评价'],
  reviewsHelp: [
    '審査済みの評価のみ表示します。お客様の氏名・連絡先は表示しません。',
    'Only moderated reviews are shown, without customer names or contact details.',
    '仅展示审核通过的评价，不显示顾客姓名和联系方式。',
  ],
  reviewsFailed: [
    '評価を読み込めませんでした。再読み込みしてください。',
    'Reviews could not load. Please retry.',
    '评价加载失败，请重试。',
  ],
  reviewCount: ['公開評価', 'Published reviews', '条公开评价'],
  safetyRecorded: ['安全上の問題を記録しました', 'Safety concern recorded', '安全事项已记录'],
  safetyAction: ['緊急時の連絡・現在地共有', 'Emergency help & location', '紧急帮助与位置分享'],
  safetyFollowUp: ['安全対応の状況', 'Safety follow-up', '安全事项处理进度'],
  safetyPending: ['店舗・運営の対応待ち', 'Awaiting shop/platform follow-up', '等待店铺／平台跟进'],
  safetyContacted: [
    '店舗が連絡対応を記録しました',
    'Shop follow-up recorded',
    '店铺已记录联系跟进',
  ],
  safetyHandling: [
    '運営の安全担当が対応中',
    'Platform safety team is following up',
    '平台安全团队正在跟进',
  ],
  notification_PENDING: ['通知は送信待ちです', 'Notification is queued', '通知等待发送'],
  notification_SENT: [
    '通知サービスが受け付けました。開封・救援到着を示すものではありません。',
    'The notification service accepted the message. This does not confirm it was read or that help has arrived.',
    '通知服务已受理，不代表收件人已阅读或救援已到达。',
  ],
  notification_PARTIAL: [
    '一部の通知を受け付けました。残りは再送待ちです。',
    'Some notifications were accepted; others are awaiting retry.',
    '部分通知已受理，其余等待重试。',
  ],
  notification_FAILED: [
    '通知が届いていない可能性があります。緊急連絡先へ直接ご連絡ください。',
    'Notification delivery may have failed. Contact emergency support directly.',
    '通知可能未成功发送，请直接联系紧急联系人。',
  ],
  notification_NOT_CONFIGURED: [
    '外部通知は未接続です。緊急連絡先へ直接ご連絡ください。',
    'External alerts are not connected. Contact emergency support directly.',
    '外部通知尚未接通，请直接联系紧急联系人。',
  ],
} as const;
export type StaffOperationText = keyof typeof words;
export function staffCountdown(l: Locale, milliseconds: number) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60000));
  return minutes < 60
    ? `${minutes} ${so(l, 'minutes')}`
    : `${Math.floor(minutes / 60)} ${so(l, 'hours')}${minutes % 60 ? ` ${minutes % 60} ${so(l, 'minutes')}` : ''}`;
}
export const so = (l: Locale, key: StaffOperationText) =>
  words[key][l === 'ja' ? 0 : l === 'en' ? 1 : 2];
