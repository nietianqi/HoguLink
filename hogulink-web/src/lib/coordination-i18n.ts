import type { Locale } from '@hogulink/contracts';
const words = {
  assign: [
    '请店铺先分配符合项目、语言与时段要求的技师，再由本人确认。',
    'サービス・言語・時間の条件に合うスタッフを店舗で割り当て、本人が確認します。',
    'The shop assigns a therapist who meets service, language and schedule requirements, then the therapist confirms.',
  ],
  missingOrder: [
    '指定订单不存在或当前账号无权查看，请从列表重新选择。',
    '指定の予約がないか、このアカウントでは表示できません。一覧から選び直してください。',
    'This order is unavailable to this account. Select an order from the list.',
  ],
  customerMessages: ['联系顾客', 'お客様に連絡', 'Contact customer'],
  proposed: ['拟改派技师', '変更候補のスタッフ', 'Proposed therapist'],
  withdraw: ['撤回当前替代人选', '現在の変更候補を取り下げる', 'Withdraw current candidate'],
  withdrawHelp: [
    '释放该人选的占用，重新选择替代技师；原响应期限不延长，也不会默认同意改派或恢复原技师履约。',
    '候補の時間確保を解除して再選択します。回答期限は延長せず、同意や元担当者の再開にはなりません。',
    'Release this candidate and choose again. The existing deadline stays. This neither implies customer consent nor resumes the original therapist.',
  ],
  REPLACEMENT_WITHDRAWN: [
    '店铺重新选择替代技师',
    '店舗が変更候補を再選択',
    'Shop is reviewing a replacement',
  ],
  title: ['订单协作', '予約の連携', 'Order coordination'],
  completionPending: [
    '服务已提交结束，等待用户核实并确认。确认前尚未扣款。',
    '終了申請済みです。お客様の確認まで請求しません。',
    'Service end submitted. Payment waits for explicit customer confirmation.',
  ],
  completionReview: [
    '服务完成确认存在异常，暂停扣款，由店铺和平台核实。',
    '完了確認に問題があり、請求保留で店舗・運営が対応します。',
    'Completion needs shop and platform review. Charges remain on hold.',
  ],
  next: ['当前处理事项', '次の対応', 'Next action'],
  accept: [
    '店铺受理后，技师才可确认任务。',
    '店舗受付後、スタッフが担当を確認します。',
    'The shop accepts before the therapist confirms the task.',
  ],
  consent: [
    '等待顾客明确同意改派；原技师不能继续履约。',
    '変更はお客様の同意待ちです。元の担当者は進められません。',
    'Await explicit customer consent. The original therapist cannot continue.',
  ],
  arrange: [
    '请店铺选择合格替代技师，或按店铺原因免费取消。',
    '店舗で適任者を選ぶか、店舗都合で無料キャンセルしてください。',
    'The shop should arrange an eligible replacement or cancel without a customer fee.',
  ],
  confirm: [
    '等待获派技师确认。受理不等于预约已确认。',
    '担当スタッフの確認待ちです。店舗受付のみでは確定しません。',
    'Await the assigned therapist. Shop acceptance alone does not confirm the visit.',
  ],
  visit: [
    '技师按出发、到达、开始、完成依次留痕。',
    '出発・到着・開始・完了の順に記録します。',
    'Record departure, arrival, start and completion in order.',
  ],
  closed: [
    '预约已结束，售后与退款继续从原订单处理。',
    '予約終了後も、この予約で相談・返金を扱います。',
    'The visit is closed. Continue care and refunds on the original order.',
  ],
  deadline: ['响应截止', '回答期限', 'Response due'],
  history: ['查看订单进程', '予約の履歴を見る', 'View order history'],
  internal: ['店内协作', '店舗内の連携', 'Shop cooperation'],
  privacy: [
    '仅本店和对应技师可见。顾客沟通、取消与退款须从原订单或工单单独处理。',
    '店舗と対象スタッフだけに共有します。お客様への連絡・キャンセル・返金は元の予約や相談で行ってください。',
    'Private to this shop and the assigned recipient. Customer communication, cancellation and refunds remain separate order or case actions.',
  ],
  report: ['向店铺报告履约情况', '店舗に状況を報告', 'Report visit facts to shop'],
  request: ['请技师补充售后事实', 'スタッフに事実確認を依頼', 'Request therapist facts'],
  topic: ['协作类型', '連携の種類', 'Cooperation topic'],
  VISIT_NOTE: ['履约备注', '訪問メモ', 'Visit notes'],
  SERVICE_ISSUE: ['服务问题', 'サービスの問題', 'Service issue'],
  AFTERCARE_FACTS: ['售后事实核对', 'アフターケアの事実確認', 'Aftercare fact check'],
  WAITING_STAFF: ['待技师补充', 'スタッフ回答待ち', 'Awaiting therapist'],
  WAITING_SHOP: ['待店铺处理', '店舗対応待ち', 'Awaiting shop'],
  RESOLVED: ['已记录处理结果', '対応結果を記録済み', 'Outcome recorded'],
  facts: ['情况说明', '状況の説明', 'Facts and explanation'],
  hint: [
    '至少10个字，请勿填写无关隐私信息。',
    '10文字以上。無関係な個人情報を含めないでください。',
    'At least 10 characters. Omit unrelated private information.',
  ],
  send: ['提交协作', '連携を送信', 'Send cooperation'],
  reply: ['补充说明', '説明を追加', 'Add explanation'],
  resolve: ['记录处理结果', '対応結果を記録', 'Record outcome'],
  reopen: ['重新跟进', '再度フォロー', 'Reopen'],
  cancel: ['返回修改', '修正に戻る', 'Back to edit'],
  resolveTitle: ['确认记录处理结果', '対応結果を確認', 'Confirm outcome'],
  resolveHelp: [
    '只结束这条店内协作，不会关闭顾客工单、改变订单状态或执行退款。',
    'この店舗内連携のみを終了します。お客様の相談・予約・返金は変更しません。',
    'This closes only the internal cooperation. It does not close a customer case, change the booking or refund money.',
  ],
  cases: ['关联顾客售后', '関連するお客様相談', 'Linked customer care'],
  pendingRefund: ['待决定退款', '返金判断待ち', 'Refund decision pending'],
  noCases: [
    '当前没有对本店可见的顾客工单。',
    '店舗に共有された相談はありません。',
    'No customer cases shared with this shop.',
  ],
  noHandoffs: ['暂无店内协作记录', '店舗内の連携はまだありません', 'No cooperation yet'],
  inbox: ['店铺协作待办', '店舗との連携', 'Shop cooperation inbox'],
  inboxHelp: [
    '改派后的原任务事实仍可在这里补充，顾客地址与私有工单不会带入。',
    '担当変更後も元の対応の事実を回答できます。住所やお客様の非公開相談は表示しません。',
    'Respond about your original task even after reassignment. Customer addresses and private cases are excluded.',
  ],
  refresh: ['刷新状态', '最新情報を取得', 'Refresh'],
  error: [
    '处理未成功，请核对状态后重试。',
    '処理できませんでした。状態を更新して再試行してください。',
    'Unable to process. Refresh the state and try again.',
  ],
  stale: [
    '记录已变化，已刷新。请重新核对后提交。',
    '記録が更新されました。内容を再確認して送信してください。',
    'The record changed and was refreshed. Review it before submitting again.',
  ],
  limit: [
    '协作记录已达上限，请先处理现有记录。',
    '連携の上限です。既存の連携を処理してください。',
    'Cooperation limit reached. Handle an existing record first.',
  ],
  saved: ['已保存协作记录', '連携を保存しました', 'Cooperation saved'],
  therapist: ['技师', 'スタッフ', 'Therapist'],
  shop: ['店铺', '店舗', 'Shop'],
  BOOKING_CREATED: ['顾客提交预约', 'お客様が予約を申込み', 'Booking submitted'],
  MERCHANT_ACCEPTED: ['店铺已受理', '店舗が受付', 'Shop accepted'],
  STAFF_ASSIGNED: ['店铺已分配任务', '店舗が担当を割当て', 'Task assigned'],
  REPLACEMENT_PROPOSED: ['店铺发起改派征询', '担当変更の同意を依頼', 'Replacement proposed'],
  REPLACEMENT_APPROVED: ['顾客同意改派', 'お客様が担当変更に同意', 'Customer approved replacement'],
  REPLACEMENT_DECLINED: [
    '顾客拒绝改派，免费取消',
    '担当変更を辞退・無料キャンセル',
    'Replacement declined, no-fee cancellation',
  ],
  STAFF_ACKNOWLEDGED: ['技师确认任务', 'スタッフが担当を確認', 'Therapist confirmed task'],
  STAFF_UNAVAILABLE: [
    '技师无法履约，等待店铺处理',
    '担当できず店舗が再手配',
    'Therapist unavailable; shop to arrange',
  ],
  STAFF_EN_ROUTE: ['技师已出发', 'スタッフが出発', 'Therapist departed'],
  STAFF_ARRIVED: ['技师已到达', 'スタッフが到着', 'Therapist arrived'],
  STAFF_START: ['服务开始', 'サービス開始', 'Service started'],
  STAFF_COMPLETE: [
    '技师提交服务结束，等待用户确认（未扣款）',
    '担当者が終了申請・お客様確認待ち（未請求）',
    'Therapist submitted service end; awaiting customer (not charged)',
  ],
  BOOKING_CANCELLED: ['预约已取消', '予約キャンセル', 'Booking cancelled'],
  BOOKING_EXPIRED: [
    '响应超时，预约结束',
    '回答期限切れ・予約終了',
    'Response expired; booking closed',
  ],
  DEMO_REFUND_SUCCEEDED: ['演示退款已记录', 'デモ返金を記録', 'Demo refund recorded'],
  ARRIVAL_DELAY_REPORTED: ['到达预计已更新', '到着見込みを更新', 'Arrival estimate updated'],
} as const;
export type CoordinationText = keyof typeof words;
export const ot = (l: Locale, k: CoordinationText) =>
  words[k][l === 'zh-cn' ? 0 : l === 'ja' ? 1 : 2];
export const coordinationError = (l: Locale, e: unknown) =>
  ot(
    l,
    (e as { code?: string })?.code === 'VERSION_CONFLICT'
      ? 'stale'
      : (e as { code?: string })?.code === 'HANDOFF_LIMIT'
        ? 'limit'
        : 'error',
  );
