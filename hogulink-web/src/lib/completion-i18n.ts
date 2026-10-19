import type { Locale } from '@hogulink/contracts';
const words = {
  title: ['サービスの完了確認', 'Service completion', '服务完成确认'],
  intro: [
    '購入時間を実際の開始時刻から計測します。お客様の確認後にのみ請求します。',
    'Purchased time runs from the actual service start. Payment follows customer confirmation.',
    '从实际开始时间计算购买的服务时长，用户确认完成后才扣款。',
  ],
  scheduled: ['予約開始', 'Booked start', '预约开始'],
  started: ['実際の開始', 'Actual start', '实际开始'],
  eligible: ['最短の終了時刻', 'Earliest service end', '最早可结束时间'],
  ended: ['終了申請時刻', 'Reported service end', '提交结束时间'],
  due: ['確認期限', 'Confirm by', '确认截止'],
  start: ['サービスを開始', 'Start service', '开始服务'],
  request: ['お客様に完了確認を依頼', 'Request customer confirmation', '提交结束，请用户确认'],
  wait: ['残り時間（分）', 'Minutes remaining', '还需服务（分钟）'],
  startWait: [
    '予約時刻まで開始できません。',
    'Service can start at the booked time.',
    '到预约时间后才能开始服务。',
  ],
  PENDING: [
    'お客様の確認待ち・未請求',
    'Awaiting customer · not charged',
    '等待用户确认 · 尚未扣款',
  ],
  DISPUTED: ['異議あり・請求保留', 'Disputed · charge on hold', '存在异议 · 暂停扣款'],
  TIMED_OUT: [
    '確認期限切れ・請求保留',
    'Confirmation overdue · charge on hold',
    '确认超时 · 暂停扣款',
  ],
  PAYMENT_REVIEW: [
    '決済の確認が必要・未請求',
    'Payment review · not charged',
    '支付待核验 · 尚未扣款',
  ],
  CONFIRMED: ['お客様が確認済み', 'Confirmed by customer', '用户已确认完成'],
  VOIDED: ['請求せず終了', 'Closed without charge', '已无费用关闭'],
  confirm: ['サービス完了を確認', 'Confirm service completion', '确认服务已完成'],
  reauthorize: ['デモ決済の与信を更新', 'Renew demo authorization', '更新支付授权（演示）'],
  reauthorizeHelp: [
    '保存済みデモ決済方法の与信を更新します。請求は行いません。更新後もサービス完了の確認が必要です。',
    'Renew the saved demo payment authorization without capture. Service completion still needs confirmation afterward.',
    '更新已保存的演示支付授权，此步骤不扣款。更新后仍须核实并确认服务完成。',
  ],
  confirmHelp: [
    '内容と提供時間を確認してください。確認すると、表示された注文金額を請求します。',
    'Check the service and its duration. Confirming captures the displayed order amount.',
    '请核对服务内容和实际时长。确认后将按下单金额扣款。',
  ],
  amount: ['確認後の請求額', 'Amount to capture', '确认后扣款金额'],
  consent: [
    'サービスの提供と時間を確認しました。',
    'I confirm the service and its duration.',
    '我已核对服务已完成且时长足够',
  ],
  dispute: ['サービスに問題がある', 'Report a service issue', '服务有异议'],
  disputeHelp: [
    '問題の内容をご記入ください。請求を保留して店舗・運営が確認します。店舗の再依頼後も、お客様の完了確認が必要です。記入内容は店舗・運営に共有されます。',
    'Describe the issue for the shop and platform. Charges stay on hold; your completion confirmation is still required after shop review.',
    '请说明具体问题，提交后暂停扣款并交店铺和平台核实；店铺复核后仍需由你确认完成。说明向店铺和平台展示。',
  ],
  stop: ['サービス中止と問題の報告', 'Stop service and report issue', '申请中止并报告问题'],
  stopHelp: [
    'このサービスを中止し、その時点の提供時間を記録します。請求を保留して店舗・運営が確認します。',
    'This ends the visit and records the service time at that point. Charges remain on hold for shop and platform review.',
    '将中止本次服务并固定记录当时的服务时长，暂停扣款，由店铺和平台核实处理。',
  ],
  exception: ['途中終了・異常を報告', 'Report early end or exception', '报告提前结束或异常'],
  exceptionHelp: [
    '短時間で終了した場合は通常の完了処理はできません。請求を保留して店舗・運営に確認を依頼します。',
    'A shortened visit cannot be completed normally. Charges stay on hold for shop and platform review.',
    '提前结束不能按正常完成扣款。报告后暂停扣款，由店铺和平台核实处理。',
  ],
  review: ['事実確認後に再依頼', 'Request confirmation after review', '核实后重新请求用户确认'],
  reviewHelp: [
    '再依頼はお客様への確認依頼です。店舗が代わりに承認・請求することはできません。',
    'This asks the customer again. A shop cannot confirm or capture on the customer’s behalf.',
    '重新请求仍须用户自行确认，店铺不能代替用户确认或扣款。',
  ],
  void: ['請求せず終了', 'Close without charge', '无费用关闭订单'],
  voidHelp: [
    '未請求の与信を解放し、この注文を終了します。',
    'Release the uncaptured authorization and close this order.',
    '释放尚未扣款的授权并关闭订单，不产生取消费。',
  ],
  note: [
    '事実・対応内容（10文字以上）',
    'Facts and handling note (10+ characters)',
    '事实与处理说明（至少10个字）',
  ],
  submit: ['送信する', 'Submit', '确认提交'],
  cancel: ['戻る', 'Back', '返回'],
  case: ['関連するサポートケース', 'Related support case', '查看关联处理工单'],
  reviewOnly: [
    '自動請求は行いません。店舗が事実を確認し、必要に応じて運営が対応します。',
    'No automatic charge. The shop reviews the facts with platform support when needed.',
    '不会自动扣款。店铺核实事实，必要时由平台介入。',
  ],
  short: [
    '提供時間が不足しています。通常の完了確認には戻せません。無費用終了またはサポートで対応してください。',
    'The reported visit was shorter than purchased. Handle without charge or through support.',
    '已报告的服务时长不足，不能恢复正常完成扣款，请无费用关闭或联系平台处理。',
  ],
  history: ['対応記録', 'Handling history', '处理记录'],
  REQUEST: ['担当者が終了を申請', 'Therapist requested confirmation', '技师提交结束'],
  CONFIRM: ['お客様が完了を確認', 'Customer confirmed completion', '用户确认完成'],
  REAUTHORIZE: [
    'お客様がデモ与信を更新',
    'Customer renewed demo authorization',
    '用户更新演示支付授权',
  ],
  DISPUTE: ['お客様が異議を報告', 'Customer reported an issue', '用户提出异议'],
  EXCEPTION: ['提供側が異常を報告', 'Provider reported an exception', '服务方报告异常'],
  REVIEW: ['店舗が確認を再依頼', 'Shop requested confirmation again', '店铺重新请求确认'],
  VOID: ['店舗が無費用で終了', 'Shop closed without charge', '店铺无费用关闭'],
  error: [
    '操作できません。最新情報を再取得してください。',
    'Unable to proceed. Refresh the latest order.',
    '操作未完成，请刷新订单后重试。',
  ],
  SERVICE_TOO_EARLY: [
    '予約開始時刻前です。',
    'The booked start time has not arrived.',
    '尚未到预约开始时间。',
  ],
  SERVICE_TOO_SHORT: [
    '購入した提供時間が不足しています。',
    'The purchased service duration has not elapsed.',
    '购买的服务时长尚未满足，提前结束请报告异常。',
  ],
  COMPLETION_REVIEW_REQUIRED: [
    '店舗の確認が必要です。',
    'Shop review is required before confirmation.',
    '此订单需店铺核实后重新请求确认。',
  ],
  COMPLETION_AMOUNT_CHANGED: [
    '最新の金額を再確認してください。',
    'Review the latest order amount.',
    '订单金额已变更，请重新核对。',
  ],
  VERSION_CONFLICT: [
    '注文が更新されました。再取得してください。',
    'The order changed. Refresh before continuing.',
    '订单已更新，请刷新后重试。',
  ],
} as const;
export type CompletionText = keyof typeof words;
export const cpt = (l: Locale, key: string) =>
  words[key as CompletionText]?.[l === 'ja' ? 0 : l === 'en' ? 1 : 2] ??
  words.error[l === 'ja' ? 0 : l === 'en' ? 1 : 2];
