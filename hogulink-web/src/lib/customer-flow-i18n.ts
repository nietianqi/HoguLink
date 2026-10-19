import type { Locale } from '@hogulink/contracts';
const words = {
  orderOverview: ['订单信息', '予約の詳細', 'Visit details'],
  refundProgress: ['退款申请进度', '返金申請の進捗', 'Refund request progress'],
  refundReceived: ['申请已提交', '申請済み', 'Request sent'],
  refundReview: ['店铺审核', '店舗の確認', 'Shop review'],
  refundOutcome: ['处理结果', '対応結果', 'Decision'],
  refundRequestedAmount: ['申请金额', '申請額', 'Requested'],
  refundApprovedAmount: ['本次已退金额', '今回の返金済み額', 'Refunded for this request'],
  refundWaitingHelp: [
    '店铺正在审核，可进入工单补充说明或撤回申请。',
    '店舗が確認中です。相談画面から補足や申請の取下げができます。',
    'The shop is reviewing your request. Open the case to add details or withdraw it.',
  ],
  refundAvailableHelp: [
    '可就剩余可申请金额提交退款诉求，处理进度会记录在此处。',
    '申請可能額の範囲で返金を申請できます。進捗はこちらに表示されます。',
    'You can request a refund up to the remaining amount. Progress will appear here.',
  ],
  refundSettledHelp: [
    '当前已无剩余可申请金额。如有服务问题，仍可联系店铺。',
    '現在、追加申請できる金額はありません。サービスの相談は引き続き可能です。',
    'There is no remaining refundable amount. You can still contact the shop about the service.',
  ],
  refundUnavailableHelp: [
    '服务问题可先联系店铺，退款申请以订单当前状态为准。',
    'まず店舗へサービスについてご相談ください。返金申請の可否は予約状況により異なります。',
    'Contact the shop about service issues. Refund eligibility depends on the current booking status.',
  ],
  viewRefundCase: ['查看退款工单', '返金の相談を開く', 'Open refund case'],
  serviceItem: ['服务项目', 'サービス', 'Service'],
  therapistChoice: ['技师安排', 'スタッフの手配', 'Therapist assignment'],
  requestStep: ['提交申请', '申込み', 'Request'],
  confirmationStep: ['预约确认', '予約確定', 'Confirmation'],
  visitStep: ['上门履约', '訪問サービス', 'Visit'],
  completeStep: ['服务完成', 'サービス完了', 'Completed'],
  addresses: ['常用地址', '登録住所', 'Saved addresses'],
  addressTitle: [
    '熟悉的地方，从容再约',
    'いつもの場所へ、また気軽に',
    'Your places, ready for next time',
  ],
  addressIntro: [
    '保存常用的住宅或酒店地址。房号和酒店入室许可，每次预约单独确认。',
    '自宅やホテルの住所を保存。部屋番号とホテルの入室許可は予約ごとに確認します。',
    'Keep home or hotel addresses. Room numbers and hotel permission are confirmed for each visit.',
  ],
  add: ['添加地址', '住所を追加', 'Add address'],
  edit: ['编辑', '編集', 'Edit'],
  remove: ['删除地址', '住所を削除', 'Remove address'],
  default: ['默认地址', '既定の住所', 'Default address'],
  makeDefault: ['设为默认', '既定にする', 'Make default'],
  label: ['地址名称', '住所の名前', 'Address label'],
  labelHint: ['例如：家、常住酒店', '例：自宅、いつものホテル', 'For example: Home, usual hotel'],
  save: ['保存地址', '住所を保存', 'Save address'],
  cancel: ['返回修改', '修正に戻る', 'Back to edit'],
  empty: ['还没有常用地址', '登録住所はまだありません', 'No saved addresses yet'],
  emptyHelp: [
    '添加后可在下单时快速选择，仍会核对服务地区与上门条件。',
    '登録すると予約時に選択できます。対応エリア・訪問条件はその都度確認します。',
    'Add one for quicker checkout. Service area and visit requirements are always checked.',
  ],
  privacy: [
    '仅本人可管理。修改或删除常用地址，不会改变已提交订单的地址快照。',
    '管理できるのはご本人だけです。変更・削除しても送信済み予約の住所は変わりません。',
    'Only you can manage these. Edits and removals do not change addresses on submitted bookings.',
  ],
  limit: ['最多保存10条地址', '最大10件まで保存できます', 'Save up to 10 addresses'],
  deleteHelp: [
    '确认删除此常用地址？已成立的预约不会被修改。',
    'この登録住所を削除しますか？送信済み予約は変更されません。',
    'Remove this saved address? Submitted bookings will keep their address.',
  ],
  deleteConfirm: ['确认删除', '削除する', 'Remove address'],
  findServices: ['用此地区找服务', 'このエリアで探す', 'Find services in this area'],
  pick: ['选择常用地址', '登録住所から選ぶ', 'Choose a saved address'],
  pickIntro: [
    '仅可选择本次服务地区及上门条件支持的地址。酒店房号与许可不会从地址簿带入。',
    '今回のエリアと訪問条件に合う住所を選択してください。部屋番号と入室許可は引き継ぎません。',
    'Choose an address supported by this area and visit type. Hotel room and permission are never copied.',
  ],
  areaMismatch: [
    '不在本次服务地区，请先修改预约地区',
    '今回のエリア外です。予約エリアを変更してください',
    'Outside this visit area. Change the booking area first.',
  ],
  hotelMismatch: [
    '本次技师仅接受酒店上门',
    'このスタッフはホテル訪問のみです',
    'This visit accepts hotels only.',
  ],
  use: ['使用此地址', 'この住所を使う', 'Use this address'],
  saveCurrent: ['将当前地址保存到地址簿', 'この住所を登録', 'Save this address for later'],
  saved: ['地址已保存', '住所を保存しました', 'Address saved'],
  picked: ['已选常用地址', '登録住所を選択済み', 'Saved address selected'],
  loading: ['正在读取…', '読み込み中…', 'Loading…'],
  refresh: ['刷新', '更新', 'Refresh'],
  stale: [
    '资料已更新，请重新核对后再操作。',
    '情報が更新されました。確認してから再度操作してください。',
    'This changed. Refresh, review and try again.',
  ],
  error: [
    '暂时无法处理，请重试。',
    '処理できませんでした。再試行してください。',
    'Unable to complete this. Please retry.',
  ],
  addressLimit: [
    '地址簿已满，请先删除不再使用的地址。',
    '住所が上限に達しました。不要な住所を削除してください。',
    'Your address book is full. Remove an unused address first.',
  ],
  review: ['核对并提交', '確認して申し込む', 'Review and submit'],
  reviewTitle: ['最后核对这次预约', 'ご予約内容の最終確認', 'One last look at your visit'],
  confirm: ['确认提交预约申请', '予約リクエストを送信', 'Submit booking request'],
  reviewHelp: [
    '请核对地点、服务、费用和店铺。提交后按店铺受理及技师确认流程处理。',
    '訪問先・サービス・料金・店舗を確認してください。送信後に店舗とスタッフが確認します。',
    'Check the location, service, total and shop. Submission is followed by shop and therapist confirmation.',
  ],
  hotelReconfirm: [
    '酒店房号与入室许可仅用于本次预约。',
    '部屋番号と入室許可は今回の予約にのみ使用します。',
    'Hotel room and permission apply to this visit only.',
  ],
  submitted: [
    '正在找回已提交的预约…',
    '送信済み予約を確認中…',
    'Recovering your submitted booking…',
  ],
  aftercare: ['订单售后', 'ご予約のサポート', 'Booking support'],
  aftercareHelp: [
    '费用状态与工单分开记录，退款申请不会自动取消服务或改变扣款。',
    '決済と相談の状態は別に記録します。返金申請だけではキャンセルや請求変更は行いません。',
    'Payment and case statuses are separate. A refund request does not cancel service or change a charge.',
  ],
  charged: ['已扣款', '請求済み', 'Captured'],
  refunded: ['已退金额', '返金済み', 'Refunded'],
  remaining: ['剩余可申请金额', '返金申請可能額', 'Remaining refundable amount'],
  authorizationHelp: [
    '当前是支付授权，不代表已扣款。取消费用请以取消前的服务端核算为准。',
    '与信は請求ではありません。キャンセル料は手続き前の確認額をご覧ください。',
    'An authorization is not a charge. Check the server-calculated fee before cancelling.',
  ],
  help: ['服务问题', 'サービスの相談', 'Service issue'],
  refund: ['申请退款', '返金を相談', 'Request refund'],
  refundTitle: ['向服务店铺申请退款', '提供店舗へ返金を相談', 'Request a refund from the shop'],
  refundIntro: [
    '只可申请已扣款、尚未退款的金额。店铺决定处理结果；如有异议可继续沟通或升级平台。',
    '請求済み・未返金の金額が対象です。店舗が判断し、異議がある場合は相談の継続や運営へのエスカレーションができます。',
    'Request only captured funds that have not been refunded. The shop decides; you can discuss or escalate a dispute.',
  ],
  amount: ['申请金额（日元）', '申請額（円）', 'Requested amount (JPY)'],
  reason: ['说明情况', 'ご相談内容', 'Explain the issue'],
  reasonHint: [
    '请具体说明需要处理的问题，至少10个字符。',
    '状況を10文字以上で具体的に記入してください。',
    'Describe the issue in at least 10 characters.',
  ],
  sendRequest: ['提交退款申请', '返金申請を送る', 'Send refund request'],
  requestSent: ['退款申请已提交', '返金を申請しました', 'Refund request submitted'],
  viewCase: ['查看处理进度', '対応状況を見る', 'View case'],
  noCases: [
    '这笔预约还没有售后工单。',
    'この予約のお問い合わせはまだありません。',
    'No support cases for this booking yet.',
  ],
  refundPending: [
    '退款申请处理中，请在原工单继续跟进。',
    '返金申請を確認中です。同じ相談でご確認ください。',
    'A refund request is pending. Continue in its existing case.',
  ],
  requested: ['申请退款金额', '返金申請額', 'Refund requested'],
  actualRefund: ['本次实际退款', '今回の返金額', 'Amount refunded for this request'],
  pending: ['待店铺处理', '店舗の確認待ち', 'Awaiting shop'],
  approved: ['退款已处理（演示）', '返金処理済み（デモ）', 'Refund processed (demo)'],
  partial: [
    '部分退款已处理（演示）',
    '一部返金処理済み（デモ）',
    'Partial refund processed (demo)',
  ],
  rejected: ['店铺未同意退款', '店舗が返金を承認しませんでした', 'Refund declined by shop'],
  withdrawn: ['申请已撤回', '申請を取り下げました', 'Request withdrawn'],
  withdraw: ['撤回退款申请', '返金申請を取り下げる', 'Withdraw request'],
  withdrawHelp: [
    '撤回后不作退款；仍可按当前余额重新申请，或继续在工单中沟通。',
    '取り下げでは返金しません。現在の残額で再申請するか、相談を続けられます。',
    'Withdrawal makes no refund. You can request again against the current balance or continue the conversation.',
  ],
  withdrawConfirm: ['确认撤回申请', '申請を取り下げる', 'Withdraw this request'],
  approve: ['同意并处理退款（演示）', '承認して返金（デモ）', 'Approve and refund (demo)'],
  approvePartial: [
    '将处理部分退款（演示）',
    '一部返金を実行（デモ）',
    'Process partial refund (demo)',
  ],
  reject: ['拒绝退款并说明原因', '理由を添えて不承認', 'Decline with explanation'],
  approvedAmount: ['本次退款金额（日元）', '今回の返金額（円）', 'Refund amount (JPY)'],
  decision: ['处理说明', '対応内容', 'Decision explanation'],
  decisionConfirm: ['确认本次处理', 'この内容で処理する', 'Confirm decision'],
  decisionHelp: [
    '请核对申请金额与当前余额。少于申请金额时记录为部分处理，不能标为全额退款。',
    '申請額と残額を確認してください。申請額未満の返金は一部処理として記録します。',
    'Check the request and current balance. Refunding less than requested is recorded as partial approval.',
  ],
  demoRefund: [
    '本地演示：记录模拟退款及费用冲回，尚未向真实支付渠道发送退款。',
    'ローカルデモ：返金と手数料調整を模擬記録します。実決済への返金送信は未接続です。',
    'Local demo: records simulated refunds and fee reversals. No refund is sent to a real payment provider.',
  ],
  balanceChanged: [
    '剩余可退金额或订单已变化，请刷新并重新核对金额。',
    '残額または予約が更新されました。更新して金額を再確認してください。',
    'The refundable balance or booking changed. Refresh and review the amount.',
  ],
  cannotClose: [
    '退款申请尚未决定或撤回，暂不能把工单标为已解决。',
    '返金申請の判断または取り下げ前に相談を終了できません。',
    'Decide or withdraw the pending refund before resolving the case.',
  ],
} as const;
export type FlowText = keyof typeof words;
export const af = (l: Locale, k: FlowText) => words[k][l === 'zh-cn' ? 0 : l === 'ja' ? 1 : 2];
export const refundStatus = (l: Locale, status: string) =>
  af(
    l,
    (
      {
        PENDING: 'pending',
        APPROVED: 'approved',
        PARTIALLY_APPROVED: 'partial',
        REJECTED: 'rejected',
        WITHDRAWN: 'withdrawn',
      } as Record<string, FlowText>
    )[status] ?? 'pending',
  );
export function flowError(l: Locale, e: unknown) {
  const code = (e as { code?: string })?.code;
  return af(
    l,
    code === 'ADDRESS_LIMIT'
      ? 'addressLimit'
      : code === 'VERSION_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT'
        ? 'stale'
        : code === 'REFUND_BALANCE_CHANGED'
          ? 'balanceChanged'
          : code === 'REFUND_PENDING'
            ? 'cannotClose'
            : 'error',
  );
}
