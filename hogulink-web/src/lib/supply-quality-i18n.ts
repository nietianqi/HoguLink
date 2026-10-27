import type { Locale } from '@hogulink/contracts';
const words = {
  title: [
    '店舗の対応品質（直近30日）',
    'Shop reliability (last 30 days)',
    '店铺履约质量（近 30 天）',
  ],
  help: [
    '予約数10件以上の店舗で基準を超えた項目に印が付きます。基準は初期値で、ペナルティの前に事実確認を行ってください。',
    'Flags appear for shops with 10 or more orders that exceed a starting threshold. Check the facts before any penalty.',
    '订单满 10 笔且超过初始阈值的项目会标记。处罚前请先核实事实。',
  ],
  shop: ['店舗', 'Shop', '店铺'],
  orders: ['予約', 'Orders', '订单'],
  completed: ['完了', 'Completed', '完成'],
  shopFailures: ['店舗側の不成立', 'Shop-side failures', '店铺原因未成单'],
  customerFees: ['店舗発の顧客料金', 'Shop-started customer fees', '店铺发起的顾客收费'],
  disputes: ['異議・異常', 'Disputes', '异议/异常'],
  complaints: ['相談', 'Cases', '投诉工单'],
  safety: ['安全', 'Safety', '安全'],
  flags: ['要確認', 'Follow up', '需跟进'],
  SHOP_FAILURES: ['拒否・期限切れが多い', 'Many rejections or expiries', '拒单/超时偏多'],
  CUSTOMER_FEES: ['未来店・遅刻料金が多い', 'Many no-show or late fees', '爽约/迟到收费偏多'],
  COMPLAINTS: ['相談が多い', 'Many cases', '投诉偏多'],
  SAFETY: ['安全イベントあり', 'Safety events', '有安全事件'],
  none: ['対象の店舗はありません。', 'No shops to show.', '暂无店铺数据。'],
  impactTitle: [
    '停止後も続いている予約',
    'Bookings still open after a suspension',
    '停用后仍在进行的预约',
  ],
  impactHelp: [
    '停止は新規予約だけを止めます。下記の予約はお客様と店舗への連絡、必要に応じた無料キャンセルや改派を確認してください。',
    'A suspension stops new bookings only. For the bookings below, confirm contact with the customer and shop and arrange free cancellation or reassignment where needed.',
    '停用只阻止新预约。以下预约请确认已联系顾客与店铺，必要时安排免费取消或改派。',
  ],
  impactNone: [
    '対応が必要な予約はありません。',
    'No open bookings need aftercare.',
    '暂无需要善后的预约。',
  ],
  STORE: ['店舗停止', 'Shop suspended', '店铺停用'],
  LISTING: ['担当者停止', 'Therapist suspended', '技师下架'],
  VENUE: ['来店予約停止', 'In-store paused', '到店暂停'],
  retry: ['再読み込み', 'Reload', '重新加载'],
} as const;
export type SupplyQualityText = keyof typeof words;
export const sq = (l: Locale, key: SupplyQualityText) =>
  words[key][l === 'ja' ? 0 : l === 'en' ? 1 : 2];
