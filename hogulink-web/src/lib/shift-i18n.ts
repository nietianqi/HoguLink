import type { Locale } from '@hogulink/contracts';
const words = {
  title: ['出勤シフト', 'Working shifts', '出勤班次'],
  help: [
    '日時指定の予約はシフト内の時間だけ受け付けます。未設定の場合は営業時間内すべてが予約対象になります。',
    'Scheduled visits are offered only inside these shifts. Without shifts, every business hour can be booked.',
    '指定时间预约只会落在班次之内。未设置班次时，营业时间内都可被预约。',
  ],
  notSet: [
    '未設定（営業時間内はすべて予約可能）',
    'Not set (any business hour can be booked)',
    '未设置（营业时间内都可被预约）',
  ],
  working: ['出勤', 'Working', '出勤'],
  start: ['開始', 'Start', '开始'],
  end: ['終了', 'End', '结束'],
  exceptions: ['日付ごとの変更', 'Changes for specific dates', '按日期调整'],
  dayOff: ['休み', 'Day off', '休息'],
  addDate: ['日付を追加', 'Add a date', '添加日期'],
  remove: ['削除', 'Remove', '删除'],
  save: ['シフトを保存', 'Save shifts', '保存班次'],
  saved: ['シフトを保存しました', 'Shifts saved', '班次已保存'],
  SHIFT_HAS_BOOKINGS: [
    'このシフトでは既存の予約が時間外になります。先に店舗へ調整を依頼してください。',
    'An existing booking would fall outside these shifts. Ask the shop to rearrange it first.',
    '已有预约会落在班次之外，请先请店铺调整。',
  ],
  conditions: ['安全のための受付条件', 'Safety conditions for bookings', '安全接单条件'],
  noFirstLateNight: [
    '深夜（22:00〜6:00）の出張は、この店舗の利用経験があるお客様のみ',
    'Late-night home visits (22:00-06:00) only for returning customers of this shop',
    '深夜（22:00–6:00）上门只接本店老顾客',
  ],
  conditionsHelp: [
    '条件の追加は店舗の承認後に有効になります。解除はすぐ反映されます。既存の予約には影響しません。',
    'Adding a condition takes effect once the shop approves it; removing one applies at once. Existing bookings are not affected.',
    '新增条件需店铺批准后生效，取消条件立即生效；不影响已有预约。',
  ],
  APPROVED: ['承認済み', 'Approved', '已批准'],
  PENDING: ['店舗の承認待ち', 'Waiting for the shop', '等待店铺批准'],
  REJECTED: ['店舗が承認しませんでした', 'Not approved by the shop', '店铺未批准'],
  approve: ['承認', 'Approve', '批准'],
  reject: ['承認しない', 'Decline', '不批准'],
} as const;
export type ShiftText = keyof typeof words;
export const sh = (l: Locale, key: ShiftText) => words[key][l === 'ja' ? 0 : l === 'en' ? 1 : 2];
