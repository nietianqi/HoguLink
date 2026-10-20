import type { Locale } from '@hogulink/contracts';

const copy = {
  title: ['把放松留给自己', '自分をいたわる時間を。', 'Make time for yourself.'],
  intro: [
    '选择信任的店铺，预约适合自己的放松服务。',
    '信頼できるお店から、自分に合うリラクゼーションを。',
    'Find your local shop and a relaxation visit that suits you.',
  ],
  quick: ['预约上门服务', '訪問サービスを予約', 'Book a visit'],
  start: ['查看可约技师', '予約できるセラピストを見る', 'Find available therapists'],
  browse: ['预约', '予約', 'Book a visit'],
  therapists: ['技师', 'セラピスト', 'Therapists'],
  shops: ['店铺', 'お店', 'Shops'],
  services: ['项目', 'メニュー', 'Services'],
  trust: [
    '身份核验 · 明码标价 · 服务结束由你确认',
    '本人確認 · 明確な料金 · 終了はお客様が確認',
    'Verified identities · Clear prices · You confirm completion',
  ],
  featured: ['推荐技师', 'おすすめのセラピスト', 'Featured therapists'],
  allTherapists: ['查看全部', 'すべて見る', 'View all'],
  allShops: ['全部店铺', 'すべてのお店', 'All shops'],
  fees: ['含指名费、交通费及税费', '指名料・交通費・税込', 'Includes nomination, travel and tax'],
  freeFees: [
    '含交通费及税费；店铺安排免指名费',
    '交通費・税込。お店におまかせなら指名料なし',
    'Travel and tax included. No nomination fee with shop assignment.',
  ],
  noMatch: [
    '暂无符合条件的服务',
    '条件に合うサービスがありません',
    'No services match your filters',
  ],
  checkLater: [
    '暂时无法加载，请重试',
    '読み込めませんでした。再試行してください',
    'Unable to load. Please try again.',
  ],
  apply: ['应用筛选', '絞り込む', 'Apply filters'],
  moreFilters: ['更多筛选', 'その他の条件', 'More filters'],
  clear: ['清除筛选', '条件をリセット', 'Reset filters'],
  groupShops: ['{n} 家店铺提供', '{n} 店舗で提供', 'Offered by {n} shops'],
  chooseShop: ['选择店铺与时长', 'お店と時間を選ぶ', 'Choose shop and duration'],
  statsUnavailable: [
    '数据暂不可用，请重试',
    'データを読み込めません。再試行してください',
    'Statistics unavailable. Please try again.',
  ],
  shopStories: ['店铺动态', 'お店の便り', 'Shop stories'],
  footerInfo: ['服务与帮助', 'ご利用ガイド', 'Help and information'],
  bookedService: ['预约服务', '予約サービス', 'Booked service'],
  current: ['当前预约', '現在の予約', 'Current booking'],
  order: ['查看订单', '予約の詳細', 'View booking'],
  orderFailed: [
    '预约状态暂不可用，前往订单重试',
    '予約状況を読み込めません。予約一覧で再試行',
    'Booking status unavailable. Retry in your bookings.',
  ],
  consent: ['请确认改派', '担当変更をご確認ください', 'Please confirm reassignment'],
  completion: ['请确认服务完成', 'サービス終了をご確認ください', 'Please confirm completion'],
  serviceFrom: ['{n} 分钟起价', '{n} 分コースから', 'From the {n} min service'],
} as const;

export function cui(locale: Locale, key: keyof typeof copy) {
  return copy[key][locale === 'zh-cn' ? 0 : locale === 'ja' ? 1 : 2];
}
