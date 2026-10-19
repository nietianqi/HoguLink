import type { Locale } from '@hogulink/contracts';
const words = {
  journey: ['订单进程', '予約の進行', 'Order progress'],
  switchOrder: ['切换或查找订单', '予約を切り替え・検索', 'Switch or find an order'],
  receive: ['店铺受理', '店舗受付', 'Shop acceptance'],
  dispatch: ['接单与调度', '担当の調整', 'Acceptance & dispatch'],
  confirm: ['技师确认', '担当確認', 'Therapist confirmation'],
  visit: ['上门履约', '訪問サービス', 'Service visit'],
  approval: ['用户验收', 'お客様の確認', 'Customer approval'],
  finished: ['服务结束', 'サービス終了', 'Visit closed'],
  current: ['当前处理', '次の対応', 'Next action'],
  booked: ['预约时间 · JST', '予約日時 · JST', 'Appointment · JST'],
  service: ['已购服务', '予約したサービス', 'Purchased service'],
  area: ['上门地区', '訪問エリア', 'Visit area'],
  fulfillment: ['履约与验收', 'サービスと完了確認', 'Visit & approval'],
  cooperation: ['售后与协作', 'アフターケアと連携', 'Care & cooperation'],
  overview: ['订单与费用', '予約と料金', 'Order & charges'],
  candidate: ['可调度技师', '割り当て可能な担当者', 'Eligible therapists'],
  nominatedHelp: [
    '指定技师变更须经用户明确同意；同意后由替代技师重新确认，免收本单指名费。',
    '指名変更にはお客様の同意と変更後の担当確認が必要です。この予約の指名料は免除されます。',
    'A nominated replacement needs customer consent, then a new therapist confirmation. This order’s nomination fee is waived.',
  ],
  freeHelp: [
    '候选人已按服务、语言和时段筛选；分配后仍需技师本人确认。',
    'サービス・言語・時間帯を満たす候補です。割り当て後に担当者本人が確認します。',
    'Candidates meet service, language and schedule requirements. The assigned therapist still needs to confirm.',
  ],
  pending: [
    '已提交改派，等待用户同意后才能履约。可在售后与协作中撤回当前人选。',
    '変更提案は同意待ちです。連携欄から候補を取り下げられます。',
    'Replacement proposed. Wait for customer consent before the visit. Withdraw the candidate in cooperation if needed.',
  ],
  noDispatch: [
    '当前阶段无需重新调度。请按订单进程处理履约、验收或原订单售后。',
    '現在は担当調整の段階ではありません。サービス・完了確認・元の予約の相談を進めてください。',
    'No dispatch action is available at this stage. Continue the visit, approval or care on this order.',
  ],
  exceptions: ['订单例外处理', '予約の例外対応', 'Order exceptions'],
  exceptionHelp: [
    '取消与退款需单独核对原因和金额；用户售后从关联工单继续处理。',
    'キャンセル・返金は理由と金額を個別に確認します。お客様の相談は関連チケットで対応します。',
    'Review cancellation reasons and refund amounts separately. Continue customer care in the linked case.',
  ],
  messages: ['联系顾客', 'お客様に連絡', 'Contact customer'],
  contact: ['沟通与安全', '連絡と安全', 'Contact & safety'],
  taskHelp: [
    '按出发、到达、开始和提交结束依次记录。达到购买时长后仍需用户验收，验收前不会扣款。',
    '出発・到着・開始・終了申請の順に記録します。予約時間を満たしてもお客様の確認前は請求しません。',
    'Record departure, arrival, start and service end in order. Meeting the purchased duration still requires customer approval before capture.',
  ],
  loading: ['正在同步订单协作…', '予約の連携を更新中…', 'Syncing order cooperation…'],
  loadingOrder: ['正在读取预约…', '予約を読み込み中…', 'Loading the order…'],
  retry: ['重新加载', '再読み込み', 'Try again'],
  cancelled: [
    '此订单已关闭，保留原始记录和售后入口。',
    'この予約は終了しました。元の記録と相談は引き続き利用できます。',
    'This order is closed. Original records and care remain available.',
  ],
} as const;
export const pf = (l: Locale, key: keyof typeof words) =>
  words[key][l === 'zh-cn' ? 0 : l === 'ja' ? 1 : 2];
