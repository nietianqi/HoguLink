import type { Locale } from '@hogulink/contracts';
const words = {
  consentPending: ['待你确认改派', 'スタッフ変更の確認待ち', 'Your consent needed'],
  customerHelp: [
    '查看预约进度，处理改派与售后。',
    '予約状況・変更・サポートを確認できます。',
    'Track your visit, changes and aftercare.',
  ],
  currentVisit: ['当前预约', '現在の予約', 'Your current visit'],
  track: ['查看预约进度', '予約状況を確認', 'Track your visit'],
  completionPending: ['待核对服务完成', 'サービス完了を確認', 'Review service completion'],
  consent: ['确认技师改派', 'スタッフ変更を確認', 'Review therapist change'],
  consentHelp: [
    '店铺提出了替代技师，请先查看人选与费用，再决定是否同意。',
    '代わりのスタッフと料金を確認してから、変更をご判断ください。',
    'Review the proposed therapist and price before deciding.',
  ],
  overview: ['今日工作台', '本日のワークスペース', 'Your day at a glance'],
  actions: ['优先处理', '優先する対応', 'Needs your attention'],
  actionHelp: [
    '先处理待办，再安排接下来的服务。',
    '必要な対応を済ませてから、次の訪問を確認しましょう。',
    'Take care of open actions, then plan the next visit.',
  ],
  waitingStaff: ['待技师回应', 'スタッフの返答待ち', 'Awaiting therapist'],
  waitingCustomer: ['待顾客同意', 'お客様の同意待ち', 'Awaiting customer consent'],
  waitingHelp: [
    '等待中的预约也可查看进度、联系或安排替代技师。',
    '返答待ちの予約も、状況確認や連絡・変更ができます。',
    'Track waiting visits, contact the team or arrange a replacement.',
  ],
  allClear: [
    '当前没有需要你处理的订单',
    '現在、対応が必要な予約はありません',
    'No order actions waiting for you',
  ],
  noActionHelp: [
    '可继续查看待回应预约、团队安排和售后工单。',
    '返答待ち・チームの予定・サポート案件を確認できます。',
    'Check waiting visits, team schedules and support cases.',
  ],
  common: ['常用操作', 'よく使う操作', 'Quick actions'],
  waitingLeave: ['休息待审批', '休みの申請', 'Time-off requests'],
  workNow: ['处理当前任务', '現在のタスクを開く', 'Open current task'],
  workHelp: [
    '先确认当前任务，再查看日程与待机。',
    '現在のタスクを確認してから、予定や待機状況を確認。',
    'Start with your current task, then check schedules and standby.',
  ],
  resources: ['资质与服务设置', '登録情報とサービス設定', 'Credentials and service settings'],
  switchIdentity: ['演示身份', 'デモアカウント', 'Demo identity'],
  incomeHelp: [
    '服务订单金额不代表个人收入；分成与结算由所属店铺确认。',
    '予約金額は個人の報酬ではありません。分配・精算は所属店舗に確認してください。',
    'Order value is not personal earnings. Confirm your share and payout with your shop.',
  ],
  serviceDetails: ['服务与费用详情', 'サービス・料金の詳細', 'Service and price details'],
  responseBy: ['本阶段响应截止', 'この段階の返答期限', 'Response deadline for this stage'],
} as const;
export function wt(l: Locale, key: keyof typeof words) {
  return words[key][l === 'zh-cn' ? 0 : l === 'ja' ? 1 : 2];
}
