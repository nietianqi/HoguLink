import type { Locale } from '@hogulink/contracts';
const words = {
  title: ['担当・フォローアップ', 'Ownership & follow-up', '工单处理与跟进'],
  queue: ['相談の対応キュー', 'Case work queue', '工单跟进队列'],
  private: [
    '管理者のみ・依頼者には表示されません',
    'Administrators only · hidden from requesters',
    '仅管理人员可见 · 不向提交人展示',
  ],
  team: ['担当グループ', 'Handling team', '业务组'],
  CUSTOMER_SUPPORT: ['カスタマーサポート', 'Customer support', '客户支持'],
  MERCHANT_OPERATIONS: ['店舗運営', 'Merchant operations', '商家运营'],
  TRUST_SAFETY: ['信頼・安全', 'Trust & safety', '信任与安全'],
  state: ['次の対応', 'Next action', '处理阶段'],
  TRIAGE: ['受付・振り分け', 'Triage', '待分派'],
  ACTIVE: ['対応中', 'In progress', '处理中'],
  WAITING_CUSTOMER: ['投稿者の返信待ち', 'Waiting for reporter', '等待提交人补充'],
  WAITING_MERCHANT: ['店舗の返信待ち', 'Waiting for shop', '等待店铺回复'],
  WAITING_INTERNAL: ['内部確認待ち', 'Waiting internally', '等待内部核查'],
  DONE: ['対応終了', 'Finished', '已结束'],
  owner: ['担当者', 'Owner', '负责人'],
  unassigned: ['未担当', 'Unassigned', '待认领'],
  mine: ['自分の担当', 'Assigned to me', '我负责的'],
  assigned: ['担当あり', 'Assigned', '已有负责人'],
  ownership: ['担当者の変更', 'Ownership action', '负责人操作'],
  KEEP: ['現在の担当を維持', 'Keep current owner', '保留当前负责人'],
  CLAIM: ['自分が担当する', 'Assign to me', '由我认领'],
  RELEASE: ['担当を解除する', 'Release owner', '释放负责人'],
  followUp: ['次の確認日時（日本時間）', 'Next follow-up (Japan time)', '下次跟进时间（日本时间）'],
  target: ['次の確認', 'Next follow-up', '下次跟进'],
  due: ['回答期限超過', 'Response overdue', '回复已超时'],
  followUpDue: ['フォローアップ期限到来', 'Follow-up due', '跟进已到期'],
  note: [
    '内部メモ（10文字以上）',
    'Internal note (at least 10 characters)',
    '内部备注（至少 10 个字）',
  ],
  notePlaceholder: [
    '判断の理由と次に確認する内容',
    'Record the reason and the next step',
    '记录处理依据和下一步跟进事项',
  ],
  save: ['担当・メモを保存', 'Save handling & note', '保存处理安排与备注'],
  saved: ['内部の対応記録を保存しました。', 'Internal handling saved.', '内部处理记录已保存。'],
  refresh: ['最新状態を確認', 'Refresh case', '核对最新状态'],
  history: ['内部の対応履歴', 'Internal handling history', '内部处理履历'],
  noHistory: [
    '内部の対応記録はまだありません。',
    'No internal handling recorded yet.',
    '尚未记录内部处理安排。',
  ],
  help: [
    '返信は下の返信欄から送信してください。次の確認日時を変更しても、回答期限は延長されません。グループの変更で相談の公開範囲は変わりません。',
    'Send replies using the separate reply area. Follow-up dates do not extend response targets. Changing teams keeps the case visibility unchanged.',
    '请在下方回复区发送对外消息。跟进时间不会延长回复期限，业务组流转也不会改变工单的共享范围。',
  ],
  claimHelp: [
    '対応中にする前に担当を設定してください。担当を解除する場合は受付に戻します。',
    'Assign an owner before starting work. To release ownership, return the case to triage.',
    '进入处理中前请先认领；释放负责人时需回到待分派。',
  ],
  finished: [
    '終了した相談の対応記録は変更できません。投稿者が再調査を依頼すると対応キューに戻ります。',
    'Finished cases are read-only. A reporter’s request for another review returns the case to the queue.',
    '已结束工单的处理记录为只读；提交人申请重新处理后会回到跟进队列。',
  ],
  all: ['すべて', 'All', '全部'],
  allTeams: ['すべてのグループ', 'All teams', '全部业务组'],
  empty: [
    '条件に一致する相談はありません。',
    'No cases match these filters.',
    '没有符合条件的工单。',
  ],
  UPDATED: ['担当・メモ更新', 'Handling updated', '处理安排已更新'],
  REPLY_RECEIVED: [
    '返信を受信・対応再開',
    'Reply received · action required',
    '收到补充消息 · 待继续处理',
  ],
  RESOLVED: ['対応結果を記録', 'Resolution recorded', '已记录处理结果'],
  REOPENED: ['再調査の依頼', 'Review requested again', '已申请重新处理'],
  ESCALATED: ['プラットフォーム対応へ', 'Escalated to platform', '已升级至平台处理'],
  system: ['システム', 'System', '系统'],
  reporter: ['関係者', 'Case participant', '工单相关方'],
  loading: ['読み込み中…', 'Loading…', '正在加载…'],
  error: [
    '読み込めませんでした。再試行してください。',
    'Unable to load. Please try again.',
    '读取失败，请重试。',
  ],
  VERSION_CONFLICT: [
    '記録が更新されました。最新状態を確認し、再度保存してください。',
    'This case changed. Review the refreshed record before saving again.',
    '工单已变更，已刷新记录，请重新核对后保存。',
  ],
  INVALID_FOLLOW_UP: [
    '7日以内の未来の日時を指定してください。',
    'Choose a future follow-up within seven days.',
    '请选择未来 7 天内的跟进时间。',
  ],
  PRIVATE_CASE: [
    '非公開の相談を店舗の返信待ちにはできません。',
    'Private reports cannot wait for a shop reply.',
    '私密工单不能设置为等待店铺回复。',
  ],
  ALREADY_ASSIGNED: [
    '現在の担当者を明示的に解除してから担当してください。',
    'Release the current owner explicitly before claiming.',
    '请先明确释放现有负责人，再由自己认领。',
  ],
  OWNER_REQUIRED: [
    '対応を開始する前に担当者を設定してください。',
    'Assign an owner before starting work.',
    '开始处理或等待回复前，请先认领工单。',
  ],
  INVALID_STATE: [
    '相談は終了しています。最新状態を確認してください。',
    'This case has ended. Review the latest state.',
    '工单已结束，请核对最新状态。',
  ],
  more: ['さらに表示', 'Show more', '加载更多'],
} satisfies Record<string, [string, string, string]>;
export type HandlingKey = keyof typeof words;
export const ht = (l: Locale, k: HandlingKey) => words[k][l === 'ja' ? 0 : l === 'en' ? 1 : 2];
export const isHandlingKey = (key: string): key is HandlingKey => Object.hasOwn(words, key);

// datetime-local fields are explicitly Japan time, independent of the browser's timezone.
export const handlingDateInput = (value: number) =>
  new Date(value + 9 * 3600000).toISOString().slice(0, 16);
export function handlingDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const at = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(at) && handlingDateInput(at) === value ? at : NaN;
}
