import type { Locale } from '@hogulink/contracts';

const words = {
  discover: ['探す', 'Discover', '发现'],
  bookings: ['予約', 'Bookings', '预约'],
  help: ['相談', 'Help', '帮助'],
  filters: ['絞り込み', 'Filters', '筛选'],
  close: ['閉じる', 'Close', '关闭'],
  fees: ['料金の内訳', 'Price details', '费用明细'],
  chooseTime: ['日時を選ぶ', 'Choose a time', '选择时间'],
  continue: ['次へ進む', 'Continue', '下一步'],
  login: ['デモで続ける', 'Continue in demo', '演示登录后继续'],
  review: ['予約内容', 'Your visit', '预约信息'],
  back: ['戻る', 'Go back', '返回'],
  area: ['東京・全エリア', 'All Tokyo areas', '东京 · 全部地区'],
  applied: ['適用中', 'Applied', '已选'],
  show: ['この条件で探す', 'Show results', '查看筛选结果'],
  payment: ['支払い方法を確認', 'Review payment', '先确认支付方式'],
  agree: ['規約を確認', 'Review terms', '先确认预约规则'],
} as const;
export function mt(locale: Locale, key: keyof typeof words): string {
  return words[key][locale === 'ja' ? 0 : locale === 'en' ? 1 : 2];
}
