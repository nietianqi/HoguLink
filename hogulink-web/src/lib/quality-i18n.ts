import type { Locale } from '@hogulink/contracts';
import { ClientError } from './api';
import { errorText } from './i18n';
const words = {
  delayReason: ['延迟原因', '遅延の理由', 'Reason for delay'],
  quality: ['服务体验与安全', 'サービス品質と安全', 'Experience & safety'],
  subtitle: [
    '从真实服务反馈，到每一次安心履约。',
    '実際の声と、安心できる訪問を。',
    'Real feedback. Thoughtful care.',
  ],
  reviews: ['真实服务评价', 'サービスのクチコミ', 'Verified service reviews'],
  favorites: ['我的收藏', 'お気に入り', 'My favorites'],
  favorite: ['收藏技师', 'お気に入り登録', 'Save therapist'],
  saved: ['已收藏', '登録済み', 'Saved'],
  remove: ['移除收藏', '登録を解除', 'Remove favorite'],
  empty: ['暂无记录', 'まだ記録はありません', 'Nothing here yet'],
  emptyReviews: [
    '服务完成后的真实反馈将在审核通过后展示。',
    '完了したサービスの声を、審査後に掲載します。',
    'Feedback from completed visits appears after review.',
  ],
  verified: ['已完成服务 · 匿名评价', '利用完了・匿名クチコミ', 'Completed visit · Anonymous'],
  count: ['条已公开评价', '件の公開クチコミ', 'published reviews'],
  punctuality: ['准时到达', '時間の正確さ', 'Punctuality'],
  communication: ['沟通体验', 'コミュニケーション', 'Communication'],
  explanation: ['服务说明', 'サービスの説明', 'Explanation'],
  cleanliness: ['清洁卫生', '清潔さ', 'Cleanliness'],
  overall: ['整体体验', '総合評価', 'Overall experience'],
  choose: ['请选择评分', '評価を選択', 'Choose a score'],
  score: ['分', '点', ' / 5'],
  write: ['评价这次服务', '今回のサービスを評価', 'Review this visit'],
  edit: ['编辑评价', 'クチコミを編集', 'Edit review'],
  withdraw: ['撤回公开评价', '公開を取り下げる', 'Withdraw review'],
  withdrawNote: [
    '撤回后将立即停止公开，原始记录保留供售后核验。',
    '直ちに非公開となり、元の記録は対応のため保管されます。',
    'This immediately hides the review. The record is retained for support.',
  ],
  reviewHelp: [
    '仅评价本次服务。请勿填写联系方式、地址、外貌评价或医疗疗效宣传。修改后需重新审核。',
    '今回のサービスのみを評価してください。連絡先、住所、容姿や医療効果に関する内容は記載できません。編集後は再審査となります。',
    'Review the service only. Omit contact details, addresses, appearance and medical claims. Edits require review again.',
  ],
  text: [
    '补充说明（选填，最多600字）',
    'コメント（任意・600文字まで）',
    'Comment (optional, up to 600 characters)',
  ],
  submit: ['提交审核', '審査に提出', 'Submit for review'],
  confirm: ['确认', '確認', 'Confirm'],
  back: ['返回工作台', 'ワークスペースへ', 'Back to workspace'],
  refresh: ['刷新', '更新', 'Refresh'],
  more: ['查看更多评价', 'さらに表示', 'More reviews'],
  signin: [
    '请先在工作台登录对应账号',
    'ワークスペースで該当アカウントにログインしてください',
    'Sign in with the matching workspace account',
  ],
  customerSignin: [
    '请先登录顾客账号',
    'お客様アカウントでログインしてください',
    'Please sign in as a customer',
  ],
  customerDemo: ['登录演示顾客账号', 'デモ顧客でログイン', 'Sign in as demo customer'],
  demo: ['演示环境', 'デモ環境', 'Demo environment'],
  login: ['登录', 'ログイン', 'Sign in'],
  rebook: ['再次预约', 'もう一度予約', 'Book again'],
  rebookHelp: [
    '将按当前店铺、可预约状态和最新价格重新选择时段，原订单不会改变。',
    '現在の店舗・受付状況・価格で日時を選び直します。元の予約は変わりません。',
    'Choose a new time using current shop availability and prices. Your original booking stays intact.',
  ],
  unavailable: ['当前暂不可预约', '現在予約できません', 'Currently unavailable'],
  browse: ['浏览服务', 'サービスを探す', 'Explore services'],
  details: ['查看详情', '詳細を見る', 'View profile'],
  reply: ['店铺回复', '店舗からの返信', 'Shop reply'],
  replyHelp: [
    '回复至少5字，最多600字，审核通过后公开。',
    '返信は5〜600文字。審査後に公開されます。',
    'Use 5–600 characters. Replies are published after review.',
  ],
  appeal: ['申请内容复核', '内容の再確認を申請', 'Request content review'],
  appealHelp: [
    '请具体说明违反内容规范的原因（10–500字）。申请期间评价继续公开。评分高低本身不是移除理由。',
    '規約違反の理由を10〜500文字で説明してください。審査中も公開されます。低評価だけを理由に削除はできません。',
    'Describe a content policy issue in 10–500 characters. The review stays public during assessment. A low score alone is not grounds for removal.',
  ],
  reason: ['处理说明（10–500字）', '理由（10〜500文字）', 'Reason (10–500 characters)'],
  moderation: ['评价内容审核', 'クチコミ審査', 'Content moderation'],
  history: ['最近处理记录', '最近の審査履歴', 'Recent decisions'],
  REVIEW: ['顾客评价', '顧客クチコミ', 'Customer review'],
  REPLY: ['店铺回复', '店舗返信', 'Shop reply'],
  APPEAL: ['内容复核', '再確認申請', 'Content appeal'],
  APPROVE: ['通过并公开', '承認して公開', 'Approve & publish'],
  REJECT: ['退回修改', '差し戻す', 'Return for revision'],
  UPHOLD: ['保留原评价', 'クチコミを維持', 'Keep review'],
  REMOVE: ['移除违规评价', '違反クチコミを非公開', 'Remove policy violation'],
  PENDING: ['待审核', '審査待ち', 'Pending review'],
  APPROVED: ['已公开', '公開中', 'Published'],
  REJECTED: ['需修改', '修正が必要', 'Needs revision'],
  WITHDRAWN: ['已撤回', '取り下げ済み', 'Withdrawn'],
  REMOVED: ['已移除', '非公開', 'Removed'],
  OPEN: ['处理中', '対応中', 'Open'],
  UPHELD: ['原评价保留', '維持済み', 'Review retained'],
  STALE: ['内容已更新，请重新查看', '内容が更新されました', 'Content has changed'],
  privacy: ['已核对个人信息与隐私', '個人情報・プライバシー確認済み', 'Privacy checked'],
  appearance: [
    '已核对外貌和身体评价规范',
    '容姿・身体への評価を確認済み',
    'Appearance policy checked',
  ],
  claims: ['已核对医疗疗效宣传规范', '医療効果の表現を確認済み', 'Medical claims checked'],
  relevance: [
    '已核对与真实服务相关',
    '利用したサービスとの関連確認済み',
    'Service relevance checked',
  ],
  safety: ['履约安全签到', '訪問の安全確認', 'Visit safety check-in'],
  safetyHelp: [
    '预计结束15分钟后发起确认，5分钟未回复则升级至店铺和平台。仅记录签到，无持续定位或录音。',
    '予定終了15分後に確認し、5分間応答がなければ店舗・運営へ通知します。常時の位置追跡・録音は行いません。',
    'A check-in starts 15 minutes after the planned end. No response for 5 minutes escalates to the shop and platform. No continuous tracking or recording.',
  ],
  delivery: [
    '当前提醒仅在本地工作台流转，短信、LINE及人工值守尚未接入。紧急情况请直接联系当地紧急服务。',
    '現在はローカル画面内の通知です。SMS・LINE・有人対応は未接続です。緊急時は地域の緊急窓口へ直接連絡してください。',
    'Alerts currently stay in local workspaces. SMS, LINE and staffed response are not connected. Contact local emergency services directly in an emergency.',
  ],
  WAITING: ['等待技师确认', 'スタッフの確認待ち', 'Awaiting check-in'],
  SAFE: ['已确认安全', '安全を確認済み', 'Safety confirmed'],
  ESCALATED: ['已升级跟进', '対応をエスカレーション', 'Escalated'],
  CLOSED: ['已结束', '終了', 'Closed'],
  safe: ['我目前安全', '現在安全です', 'I am safe'],
  help: ['需要协助', 'サポートが必要', 'I need help'],
  contact: ['记录联系结果', '連絡結果を記録', 'Record contact outcome'],
  resolve: ['确认处理完成', '対応完了を確認', 'Resolve event'],
  contactHelp: [
    '填写联系情况与下一步（10–500字），仅店铺和有权平台人员可见。',
    '連絡状況と次の対応を10〜500文字で記録。店舗と権限を持つ運営のみ閲覧できます。',
    'Record contact outcome and next steps in 10–500 characters. Visible only to the shop and authorized platform staff.',
  ],
  MISSED_CHECK_IN: ['安全签到超时', '安全確認の応答なし', 'Missed safety check-in'],
  SOS: ['紧急协助', '緊急サポート', 'Urgent help'],
  SAFETY_TERMINATION: ['安全中止', '安全上の中止', 'Safety termination'],
  due: ['签到时间', '確認予定時刻', 'Check-in due'],
  escalation: ['升级时间', 'エスカレーション時刻', 'Escalates at'],
  arrival: ['到达进度', '到着状況', 'Arrival progress'],
  original: ['原承诺到达时间', '当初の到着予定', 'Original arrival promise'],
  revised: ['最新预计到达', '更新された到着予定', 'Updated arrival estimate'],
  delay: ['更新预计到达', '到着予定を更新', 'Update arrival estimate'],
  delayHelp: [
    '更新预计时间不会顺延原有迟到判定。请同步联系店铺和顾客。',
    '更新しても遅延判定の基準は延長されません。店舗・お客様にも連絡してください。',
    'An update does not extend the original delay threshold. Please also contact the shop and customer.',
  ],
  minutes: ['预计还需分钟数（5–180）', '到着までの分数（5〜180）', 'Minutes until arrival (5–180)'],
  TRAFFIC: ['交通拥堵', '交通渋滞', 'Traffic'],
  PREVIOUS_VISIT: ['上一单延时', '前の訪問の遅延', 'Previous visit overrun'],
  TRANSPORT: ['交通工具异常', '交通機関の遅延', 'Transport disruption'],
  OTHER: ['其他原因', 'その他', 'Other'],
  cancel: ['取消预约', '予約をキャンセル', 'Cancel booking'],
  cancellationFee: ['本次取消费用', '今回のキャンセル料', 'Cancellation fee'],
  cancelHelp: [
    '以下费用由服务端按原订单条款计算。确认时会再次核对订单进度与费用。',
    '元の予約規則に基づく現在の料金です。確定時に予約状況・料金を再確認します。',
    'Calculated from your original booking terms. Progress and fee are checked again when you confirm.',
  ],
  confirmCancel: ['确认取消预约', 'キャンセルを確定', 'Confirm cancellation'],
  PROVIDER_ARRIVAL_DELAY: [
    '超过原承诺到达时间及宽限期，免费取消。',
    '当初の到着予定と猶予時間を超過したため無料です。',
    'The original arrival promise and grace period have passed. Cancellation is free.',
  ],
  MERCHANT_UNABLE: [
    '服务方原因，免费取消。',
    '提供側の事情により無料です。',
    'Provider-related cancellation is free.',
  ],
  CUSTOMER_REQUEST: [
    '按订单确认时的取消条款执行。',
    '予約時に確認したキャンセル規則を適用します。',
    'Your confirmed cancellation terms apply.',
  ],
  updated: ['已保存', '保存しました', 'Saved'],
  stale: [
    '内容或费用已更新，请刷新后重新确认。',
    '内容・料金が更新されました。更新後に再確認してください。',
    'Content or pricing changed. Refresh and confirm again.',
  ],
  invalidText: [
    '内容包含不允许公开的信息，请修改后重试。',
    '公開できない情報が含まれています。修正してください。',
    'This content contains information that cannot be published. Please revise it.',
  ],
  forbidden: [
    '此账号无权访问该业务，请使用对应身份。',
    'このアカウントには権限がありません。該当のアカウントを使用してください。',
    'This account does not have access. Use the matching role.',
  ],
  summary: [
    '基于已公开的真实评价',
    '公開中の実際の評価に基づく',
    'Based on published service reviews',
  ],
  rebookNotice: [
    '再次预约：请重新确认当前价格、技师和可用时段。',
    '再予約：現在の料金・担当者・空き時間を確認してください。',
    'Booking again: confirm current prices, therapist and available times.',
  ],
} as const;
export type QualityText = keyof typeof words;
export function qt(l: Locale, k: QualityText) {
  return words[k][l === 'zh-cn' ? 0 : l === 'ja' ? 1 : 2];
}
export function qualityStatus(l: Locale, k: string) {
  return k in words ? qt(l, k as QualityText) : k;
}
export function qualityError(l: Locale, e: unknown) {
  if (e instanceof ClientError) {
    if (
      [
        'VERSION_CONFLICT',
        'CANCELLATION_PRICE_CHANGED',
        'REVIEW_CHANGED',
        'INVALID_CURSOR',
      ].includes(e.code)
    )
      return qt(l, 'stale');
    if (e.code === 'FORBIDDEN') return qt(l, 'forbidden');
    if (
      [
        'REVIEW_CONTENT_REJECTED',
        'REVIEW_CONTENT_UNSAFE',
        'UNSAFE_CONTENT',
        'CONTENT_NOT_ALLOWED',
      ].includes(e.code)
    )
      return qt(l, 'invalidText');
    if (['REBOOK_UNAVAILABLE', 'NOT_AVAILABLE', 'NOT_FOUND'].includes(e.code))
      return qt(l, 'unavailable');
    return errorText(l, e.code);
  }
  return errorText(l, 'error');
}
