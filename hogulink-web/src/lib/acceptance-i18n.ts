import type { Locale } from '@hogulink/contracts';
const words = {
  title: ['自動受理の範囲', 'Automatic acceptance rules', '自动受理范围'],
  active: ['自動受理を有効にする', 'Enable automatic acceptance', '启用自动受理'],
  enabled: ['有効', 'Active', '已开启'],
  paused: ['停止中', 'Paused', '已暂停'],
  missing: ['未設定 · 手動確認', 'Not configured · manual review', '未配置 · 转人工审核'],
  pause: ['今すぐ停止', 'Pause now', '立即暂停'],
  instant: [
    'この範囲で即時予約を許可',
    'Allow instant visits within these rules',
    '允许此范围内的即时预约',
  ],
  services: ['対象サービス', 'Included services', '适用服务项目'],
  team: ['対象セラピスト', 'Included therapists', '适用技师'],
  areas: ['対象エリア', 'Included areas', '适用地区'],
  start: ['受付開始（JST）', 'Visit window starts (JST)', '服务时段起点（JST）'],
  end: ['受付終了（JST）', 'Visit window ends (JST)', '服务时段终点（JST）'],
  timeHelp: [
    'サービス全体が同じ日の時間帯に収まる必要があります。',
    'The entire service must fit within this daily window.',
    '整段服务须在同一服务日的此时段内完成。',
  ],
  min: ['最低総額（円）', 'Minimum total (JPY)', '单笔最低总价（日元）'],
  max: ['最高総額（円）', 'Maximum total (JPY)', '单笔最高总价（日元）'],
  priceHelp: [
    '指名料・交通費を含む総額で判定します。',
    'Includes service, nomination and travel fees.',
    '按服务费、指名费和交通费的合计判断。',
  ],
  limit: ['サービス日ごとの上限', 'Daily automatic acceptance limit', '每日自动受理上限'],
  limitHelp: [
    '開始日のJST日付で集計。取消しても枠は戻りません。',
    'Counted by the visit start date in JST. Cancellations do not restore the quota.',
    '按服务开始日期（JST）累计；已自动受理后取消不返还额度。',
  ],
  meaning: [
    '条件に合う申込みを店舗名義で受理します。担当者の業務確認は別途必要です。条件外の通常予約は手動確認、即時予約は受付不可となります。',
    'Matching requests are accepted on behalf of your shop. Therapist confirmation is still required. Other scheduled visits go to manual review; instant visits require a matching rule.',
    '符合条件时系统代表店铺接受预约，技师仍须单独确认任务。范围外的普通预约转人工审核，即时预约须符合全部规则。',
  ],
  consent: [
    'この範囲で店舗を代表して受理することを承認します。',
    'I authorize acceptance on behalf of my shop within this scope.',
    '我授权系统在上述范围内代表本店接受预约。',
  ],
  scopeError: [
    '各対象を1件以上選び、時間・金額の範囲と上限を確認してください。',
    'Choose at least one service, therapist and area, and check the time, price and daily limit.',
    '请至少选择一个项目、技师和地区，并检查起止时段、金额范围及每日上限。',
  ],
  updated: ['最終承認', 'Last authorized', '最近授权'],
  history: ['最近のルール変更', 'Recent rule changes', '最近规则变更'],
  automatic: [
    'ルールにより自動受理',
    'Automatically accepted under shop rules',
    '已按店铺授权规则自动受理',
  ],
  manual: [
    '申込時に店舗の手動確認へ',
    'Sent to shop review at submission',
    '提交时已转店铺人工审核',
  ],
  rule: ['適用ルール', 'Applied rule', '适用规则'],
  ELIGIBLE: ['すべての条件に一致', 'All conditions matched', '符合全部授权条件'],
  MANUAL_MODE: ['手動受理の店舗', 'Shop uses manual acceptance', '店铺采用人工受理'],
  NO_RULE: ['有効な承認ルールなし', 'No authorized rule configured', '尚未配置授权规则'],
  PAUSED: ['自動受理が停止中', 'Automatic acceptance is paused', '自动受理已暂停'],
  INSTANT_DISABLED: ['即時予約は対象外', 'Instant visits are disabled', '未开启即时预约'],
  OFFERING: ['対象外のサービス', 'Service is outside the scope', '此项目不在授权范围'],
  STAFF: ['対象外の担当者', 'Therapist is outside the scope', '此技师不在授权范围'],
  AREA: ['対象外のエリア', 'Area is outside the scope', '此地区不在授权范围'],
  TIME: ['対象外のサービス時間', 'Service falls outside the time window', '服务超出授权时段'],
  AMOUNT: ['対象外の予約総額', 'Total is outside the authorized range', '订单总价超出授权范围'],
  DAILY_LIMIT: [
    '当日の自動受理上限に到達',
    'Daily automatic acceptance limit reached',
    '该服务日已达自动受理上限',
  ],
} as const;
export function ar(locale: Locale, key: keyof typeof words) {
  return words[key][locale === 'ja' ? 0 : locale === 'en' ? 1 : 2];
}
