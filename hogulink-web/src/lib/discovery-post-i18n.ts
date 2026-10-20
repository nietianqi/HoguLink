import type { Locale } from '@hogulink/contracts';
const copy = {
  loading: ['正在读取…', '読み込み中…', 'Loading…'],
  detail: ['内容详情', 'コンテンツ詳細', 'Story details'],
  saved: ['收藏的内容', '保存したコンテンツ', 'Saved content'],
  save: ['收藏内容', '保存する', 'Save'],
  savedAction: ['已收藏', '保存済み', 'Saved'],
  like: ['点赞', 'いいね', 'Like'],
  liked: ['已点赞', 'いいね済み', 'Liked'],
  views: ['阅读', '閲覧', 'Views'],
  more: ['加载更多内容', 'もっと見る', 'Load more'],
  end: [
    '已看完当前分类内容',
    'このカテゴリーは以上です',
    'You have seen all posts in this category',
  ],
  empty: [
    '暂无符合条件的内容',
    '条件に合うコンテンツはありません',
    'No content matches these filters',
  ],
  search: [
    '搜索内容、技师或店铺',
    '記事・スタッフ・店舗を検索',
    'Search posts, therapists or shops',
  ],
  filters: ['内容筛选', '絞り込み', 'Filter content'],
  language: ['服务语言', '対応言語', 'Service language'],
  anyLanguage: ['不限语言', '言語指定なし', 'Any language'],
  apply: ['查看内容', '表示する', 'Apply'],
  reset: ['清除筛选', '条件をクリア', 'Clear filters'],
  related: ['更多内容', '関連するコンテンツ', 'More to explore'],
  book: ['立即预约', '予約へ進む', 'Book a visit'],
  author: ['查看作者资料', 'プロフィールを見る', 'View author'],
  signin: ['登录后保存与点赞', 'ログインして保存・いいね', 'Sign in to save or like'],
  signinHelp: [
    '阅读无需登录；互动仅保存在你自己的顾客账号。',
    '閲覧はログイン不要。保存・いいねはご本人のアカウントに記録します。',
    'Reading is open to everyone. Saves and likes belong to your own customer account.',
  ],
  unavailable: ['内容暂不可用', 'このコンテンツは利用できません', 'This content is unavailable'],
  unavailableHelp: [
    '内容可能已下架，或不符合当前地区与语言条件。可返回发现重新选择。',
    '公開が終了したか、選択中のエリア・言語に対応していない可能性があります。',
    'It may have been removed or may not match your current area and language. Return to Discover to choose again.',
  ],
  error: [
    '暂时无法读取，请重试。',
    '読み込めませんでした。再試行してください。',
    'Unable to load. Please try again.',
  ],
  retry: ['重试', '再試行', 'Retry'],
  back: ['返回发现', '見つけるに戻る', 'Back to Discover'],
  remove: ['取消收藏', '保存を解除', 'Remove save'],
  emptySaved: ['还没有收藏内容', '保存したコンテンツはありません', 'No saved content yet'],
  image: ['内容图片', 'コンテンツ画像', 'Content image'],
  previous: ['上一张', '前の画像', 'Previous image'],
  next: ['下一张', '次の画像', 'Next image'],
  sample: ['示例档案', 'サンプルプロフィール', 'Sample profile'],
  illustration: ['图片为示意', 'イメージ画像', 'Illustrative image'],
} as const;
export function pt(l: Locale, key: keyof typeof copy) {
  return copy[key][l === 'zh-cn' ? 0 : l === 'ja' ? 1 : 2];
}
