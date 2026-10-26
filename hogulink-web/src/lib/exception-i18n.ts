import type { Locale } from '@hogulink/contracts';
const words = {
  retryTime: ['空き時間を選び直す', 'Choose a new time', '重新选择可约时段'],
  guaranteeTitle: [
    'お支払いの再認証が必要です',
    'Renew your payment guarantee',
    '需要重新认证支付',
  ],
  guaranteeText: [
    '訪問前の与信が承認されませんでした。期限までに決済方法を再認証してください。期限を過ぎると予約は無料でキャンセルされ、時間は解放されます。',
    'The pre-visit authorization was declined. Renew your payment method by the deadline, or the booking is cancelled free of charge and the time released.',
    '上门前的预授权未通过。请在截止前重新认证支付方式，逾期预约将免费取消并释放时段。',
  ],
  guaranteeProvider: [
    'お客様の訪問前与信が未完了です。再認証されるまで出発しないでください。期限を過ぎると無料キャンセルになります。',
    'The customer’s pre-visit authorization failed. Do not depart until it is renewed; after the deadline the booking is cancelled free.',
    '顾客的上门前预授权未通过。重新认证前请勿出发，逾期将免费取消。',
  ],
  guaranteeBy: ['再認証の期限', 'Renew by', '认证截止'],
  guaranteeRenew: ['決済を再認証', 'Renew payment', '重新认证支付'],
  released: [
    '決済認証に失敗したため、仮予約を解除しました。空き時間を確認して再度お進みください。',
    'Payment authentication failed and your time was released. Check availability again before retrying.',
    '支付认证失败，时段已释放。请重新确认可约时间后再试。',
  ],
  waitingShop: [
    '元の担当者が対応できません。店舗が代替担当者を調整中です。無料でキャンセルできます。',
    'Your original therapist is unavailable. The shop is arranging a replacement. You may cancel free of charge.',
    '原技师暂时无法服务，店铺正在安排替代人员。你可以免费取消。',
  ],
  freeCancel: ['無料でキャンセル', 'Cancel free of charge', '免费取消预约'],
  soloHelp: [
    'SOLOの要件を満たさなくなった場合は手動受付に切り替わり、担当者の確認が必要です。',
    'If SOLO eligibility changes, new bookings use manual shop acceptance and separate therapist confirmation.',
    'SOLO 条件失效时，系统切换为店铺人工受理，再由技师确认任务。',
  ],
  title: ['到着後の連絡・不在確認', 'Arrival & contact record', '到达联系与爽约核实'],
  help: [
    '実際のメッセージと待機時間を記録します。料金の確定は店舗が行います。',
    'Contact messages and waiting time are recorded. Your shop reviews any no-show charge.',
    '记录实际发送的订单消息和等待时间，由店铺复核爽约及费用。',
  ],
  contact: ['連絡メッセージを送信', 'Send contact message', '发送联系消息并留痕'],
  contactText: [
    'お約束の場所に到着しました。注文内メッセージでご連絡ください。',
    'I have arrived at the agreed location. Please reply in this booking conversation.',
    '您好，我已到达约定地点，请通过订单消息与我联系。',
  ],
  reportText: [
    '連絡履歴と待機時間に基づき、不在確認を店舗へ依頼します。',
    'Please review this no-show report against the contact record and waiting period.',
    '已按约定联系并等待，请店铺核对联系记录及顾客爽约情况。',
  ],
  noteText: [
    '連絡履歴・待機時間と予約時の規約を確認しました。',
    'I have checked the contact record, waiting period and agreed booking policy.',
    '已核对联系记录、等待时间以及本预约约定的收费条款。',
  ],
  message: ['お客様へのメッセージ', 'Message to the customer', '发给顾客的联系消息'],
  report: ['不在確認を店舗へ依頼', 'Request shop review', '提交爽约核实'],
  confirm: ['不在・料金を確認', 'Review no-show charge', '复核爽约与费用'],
  dismiss: ['不在ではないと判断', 'Dismiss no-show report', '不认定爽约'],
  decisionNote: ['処理理由', 'Review note', '复核说明'],
  noteRequired: [
    '10文字以上で記入してください。',
    'Enter at least 10 characters.',
    '请填写至少 10 个字的说明。',
  ],
  CONTACTING: ['連絡・待機中', 'Contacting & waiting', '联系与等待中'],
  REPORTED: ['店舗が確認中', 'Awaiting shop review', '等待店铺复核'],
  CONFIRMED: ['不在確認・処理済み', 'No-show confirmed', '爽约已核实处理'],
  DISMISSED: ['不在確認は終了しました', 'No-show review closed', '爽约核实已结束'],
  attempts: ['連絡記録', 'Contact attempts', '联系留痕'],
  waitUntil: ['待機期限', 'Wait until', '等待截止'],
  estimate: ['規約に基づく上限額', 'Charge under agreed policy', '按约定条款计算'],
  fee: ['不在料金', 'No-show charge', '爽约费用'],
  notReady: [
    '連絡回数または待機時間が未完了です。',
    'Contact attempts or the waiting period are incomplete.',
    '联系次数或等待期尚未完成，请继续通过订单沟通。',
  ],
  nextContact: ['次の連絡可能時刻', 'Next contact attempt', '下次可记录联系时间'],
  reviewHelp: [
    '担当者の申告だけで課金はしません。履歴とお客様の返信をご確認ください。交通費を除き、プラットフォーム手数料は発生しません。',
    'Reporting alone does not charge the customer. Review the record and any customer reply. Travel is excluded and the platform fee is zero.',
    '提交报告不会直接扣费。请核对联系记录及顾客回应，费用不含交通费，平台服务费为零。',
  ],
  acknowledge: [
    '履歴と規約を確認しました',
    'I have reviewed the evidence and agreed policy',
    '我已核对联系记录、等待期和预约快照条款',
  ],
  charge: ['確認して処理', 'Confirm agreed charge', '确认按约定收费'],
  close: ['閉じる', 'Close', '关闭'],
  legacy: [
    'この予約には不在料金の合意がありません。店舗へご相談ください。',
    'This booking has no agreed no-show policy. Contact the shop.',
    '此预约未约定爽约收费规则，请联系店铺协商处理。',
  ],
  closed: ['お客様不在により終了', 'Closed after confirmed no-show', '顾客爽约，预约已关闭'],
  failed: [
    '操作を完了できませんでした。状態を更新してください。',
    'The action could not be completed. Refresh the booking status.',
    '操作未完成，请刷新预约状态后重试。',
  ],
  responded: [
    'お客様の返信があります。店舗と対応を確認してください。',
    'The customer has replied. Resolve the visit with the shop.',
    '顾客已在订单内回应，请与店铺协调，不可直接认定爽约。',
  ],
  changed: [
    '予約が更新されました。最新の状態をご確認ください。',
    'This booking changed. Review its latest status.',
    '预约已发生变化，请核对最新状态后操作。',
  ],
} as const;
export type ExceptionKey = keyof typeof words;
export const xt = (locale: Locale, key: ExceptionKey) =>
  words[key][locale === 'ja' ? 0 : locale === 'en' ? 1 : 2];
export function exceptionError(locale: Locale, code?: string) {
  return xt(
    locale,
    code === 'CUSTOMER_RESPONDED'
      ? 'responded'
      : ['CONTACT_TOO_SOON', 'NO_SHOW_NOT_READY', 'CONTACTS_REQUIRED'].includes(code ?? '')
        ? 'notReady'
        : code === 'NO_SHOW_POLICY_REQUIRED'
          ? 'legacy'
          : code === 'VERSION_CONFLICT'
            ? 'changed'
            : 'failed',
  );
}
