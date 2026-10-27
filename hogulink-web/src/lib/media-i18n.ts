import type { ListingMediaStatus, Locale } from '@hogulink/contracts';
const words = {
  // Customer profile
  gallery: ['写真と動画', 'Photos and video', '照片与视频'],
  mainPhoto: ['メイン写真', 'Main photo', '主照片'],
  photo: ['写真', 'Photo', '照片'],
  video: ['動画紹介', 'Video introduction', '视频介绍'],
  play: ['動画を再生', 'Play video', '播放视频'],
  playIntro: ['紹介動画を再生', 'Play the introduction video', '播放视频介绍'],
  enlarge: ['拡大して見る', 'View larger', '点击放大'],
  previous: ['前へ', 'Previous', '上一张'],
  next: ['次へ', 'Next', '下一张'],
  close: ['閉じる', 'Close', '关闭'],
  samplePhoto: ['サンプル写真', 'Sample photo', '示例照片'],
  noPhoto: ['写真は公開されていません。', 'No photo is published.', '暂未公开照片。'],
  mediaNote: [
    '本人の同意を得て、店舗と運営の確認後に掲載しています。',
    'Published with the therapist’s consent after shop and platform review.',
    '经本人授权，并由店铺和平台审核后公开。',
  ],
  report: ['写真・動画を報告', 'Report this photo or video', '举报照片或视频'],
  reportTitle: ['報告する理由', 'Why are you reporting it?', '举报原因'],
  NOT_THE_PERSON: ['本人ではないようです', 'It does not seem to be this person', '不像本人'],
  INAPPROPRIATE: ['内容が不適切です', 'The content is inappropriate', '内容不当'],
  CONTACT_INFO: ['連絡先が写っています', 'Contact details are shown', '含联系方式'],
  OTHER: ['その他', 'Other', '其他'],
  reportDetail: ['補足（任意）', 'Details (optional)', '补充说明（选填）'],
  reportSend: ['報告する', 'Send report', '提交举报'],
  reportSent: [
    '報告を受け付けました。運営が確認します。',
    'Thanks. The platform will review it.',
    '已收到举报，平台会尽快核实。',
  ],
  reportLogin: ['報告するにはログインしてください', 'Sign in to report', '登录后可举报'],
  // Card
  bookThis: ['このスタッフを予約', 'Book this therapist', '预约此技师'],
  services: ['主なメニュー', 'Main services', '主要项目'],
  reviews: ['件の口コミ', 'reviews', '条评价'],
  noReviews: ['口コミはまだありません', 'No reviews yet', '暂无评价'],
  // Detail sections
  profileTitle: ['自己紹介とサービスの特徴', 'About and service style', '个人介绍与服务特点'],
  serviceTitle: ['メニューと料金', 'Services and prices', '服务项目与价格'],
  checks: ['確認状況', 'Checks', '核验情况'],
  verifiedFacts: [
    '本人確認済み・店舗所属・本人同意のうえ掲載',
    'Identity checked · Shop member · Published with consent',
    '身份已核验 · 店铺在籍 · 本人授权公开',
  ],
  shopTitle: ['所属店舗とご利用案内', 'Shop and service notes', '所属店铺与服务说明'],
  fromPrice: ['料金の目安', 'From', '参考价格'],
  // Management
  manageTitle: ['写真と紹介動画', 'Photos and introduction video', '我的照片与视频'],
  shopManageTitle: ['スタッフの写真と動画', 'Therapist photos and video', '技师照片与视频'],
  manageHelp: [
    'アップロード → 店舗の確認 → 運営の審査 → 公開。審査中は公開中の内容がそのまま表示されます。',
    'Upload → shop confirms → platform reviews → published. While a new item is in review, the published ones stay up.',
    '上传 → 店铺确认 → 平台审核 → 公开。新内容审核期间，已公开的内容继续展示。',
  ],
  shopPending: [
    '{n}件の写真・動画がスタッフ欄で確認待ちです',
    '{n} photos or videos wait for your confirmation under each therapist',
    '有 {n} 项照片/视频等待确认，请在对应技师卡片中处理',
  ],
  shopManageHelp: [
    '店舗がアップロードした内容は、本人の同意後に運営が審査します。',
    'Items the shop uploads go to platform review after the therapist authorizes them.',
    '店铺上传的内容需本人确认授权后，再交给平台审核。',
  ],
  rulesTitle: ['掲載ルール', 'Publishing rules', '发布规范'],
  rules: [
    '本人の最近の写真のみ。連絡先・QRコード・外部リンク・お客様や住所が分かるもの・医療効果の表現・露出や暗示的な表現は掲載できません。',
    'Recent photos of yourself only. No contact details, QR codes, links, customers, anything that reveals an address, medical claims, or revealing or suggestive content.',
    '仅限本人近期照片。不得出现联系方式、二维码、外部链接、顾客或可识别住址的画面，不得宣传医疗效果，不得暴露或暗示。',
  ],
  mainPhotoRule: [
    '出張サービスにはメイン写真が必要です。到着時にお客様が本人確認に使います。',
    'Home visits need a main photo; customers use it to recognize you at the door.',
    '上门服务必须有主照片，顾客上门时用它核对本人。',
  ],
  missingMain: [
    'メイン写真がないため、出張予約を受けられません。承認済みの写真をメイン写真に設定してください。',
    'Without a main photo, home visits cannot be booked. Set an approved photo as the main photo.',
    '当前没有主照片，暂不能接上门预约。请把审核通过的照片设为主照片。',
  ],
  addPhoto: ['写真を追加', 'Add photo', '添加照片'],
  addVideo: ['紹介動画を追加', 'Add introduction video', '添加视频介绍'],
  replaceVideo: ['動画を差し替える', 'Replace video', '替换视频'],
  photoLimit: ['写真は最大8枚', 'Up to 8 photos', '照片最多 8 张'],
  videoLimit: [
    'MP4（H.264）・60秒以内・20MB以内。720p推奨。',
    'MP4 (H.264), up to 60 seconds and 20 MB. 720p recommended.',
    'MP4（H.264）格式，60 秒、20MB 以内，建议 720p。',
  ],
  consentLabel: [
    '私が写っている本人であり、店舗と運営の確認後の公開に同意します',
    'I am the person shown and agree to publication after shop and platform review',
    '我是画面中的本人，同意经店铺和平台审核后公开',
  ],
  uploading: ['アップロード中…', 'Uploading…', '正在上传…'],
  uploaded: [
    'アップロードしました。確認をお待ちください。',
    'Uploaded. It now waits for review.',
    '已上传，等待审核。',
  ],
  empty: ['まだ写真や動画はありません。', 'No photos or video yet.', '还没有照片或视频。'],
  PENDING_CONSENT: ['本人の同意待ち', 'Waiting for the therapist', '等待本人授权'],
  PENDING_SHOP: ['店舗の確認待ち', 'Waiting for the shop', '等待店铺确认'],
  PENDING_REVIEW: ['運営の審査中', 'In platform review', '平台审核中'],
  APPROVED: ['公開中', 'Published', '已公开'],
  REJECTED: ['差し戻し', 'Returned', '已退回'],
  WITHDRAWN: ['同意を撤回', 'Authorization withdrawn', '已撤回授权'],
  REMOVED: ['掲載終了', 'Taken down', '已下架'],
  REPLACED: ['新しい動画に差し替え', 'Replaced by a newer video', '已被新视频替换'],
  cover: ['メイン写真', 'Main photo', '主照片'],
  setCover: ['メイン写真にする', 'Use as main photo', '设为主照片'],
  moveUp: ['前へ移動', 'Move earlier', '前移'],
  moveDown: ['後ろへ移動', 'Move later', '后移'],
  authorize: ['公開に同意する', 'Authorize publication', '确认授权'],
  withdraw: ['同意を撤回して非公開にする', 'Withdraw and hide', '撤回授权并下架'],
  confirm: ['確認して運営へ送る', 'Confirm and send for review', '确认并提交平台审核'],
  returnItem: ['差し戻す', 'Return', '退回'],
  remove: ['掲載をやめる', 'Take down', '下架'],
  reason: ['理由', 'Reason', '原因'],
  reasonHelp: [
    '本人と店舗に表示されます（4文字以上）',
    'Shown to the therapist and shop (at least 4 characters)',
    '会展示给技师和店铺（至少 4 个字）',
  ],
  reports: ['件の報告', 'reports', '条举报'],
  uploadedByShop: ['店舗がアップロード', 'Uploaded by the shop', '店铺上传'],
  uploadedByStaff: ['本人がアップロード', 'Uploaded by the therapist', '本人上传'],
  seconds: ['秒', 's', '秒'],
  // Platform review
  reviewTitle: ['写真・動画の審査', 'Photo and video review', '技师照片与视频审核'],
  reviewHelp: [
    '本人の同意と店舗の確認が済んだ内容と、お客様から報告された公開中の内容です。',
    'Items authorized by the therapist and confirmed by the shop, plus published items customers reported.',
    '已获本人授权、店铺确认的内容，以及顾客举报的公开内容。',
  ],
  reviewEmpty: ['審査待ちはありません。', 'Nothing waiting for review.', '暂无待审核内容。'],
  approve: ['承認して公開', 'Approve and publish', '审核通过并公开'],
  reject: ['差し戻す', 'Return', '退回修改'],
  keep: ['問題なし・掲載を続ける', 'Keep it published', '无问题，继续展示'],
  takeDown: ['掲載をやめる', 'Take it down', '下架'],
  reviewChecks: [
    '本人・最近の写真／連絡先や外部誘導なし／露出・暗示なし／医療表現なし を確認',
    'Checked: the person, recent; no contact details or links; nothing revealing or suggestive; no medical claims',
    '已核对：本人且近期；无联系方式或外部引流；无暴露暗示；无医疗宣传',
  ],
  saved: ['保存しました', 'Saved', '已保存'],
  failed: [
    '保存できませんでした。もう一度お試しください。',
    'Could not save. Try again.',
    '保存失败，请重试。',
  ],
  CONSENT_REQUIRED: [
    '本人であることと公開への同意を確認してください。',
    'Confirm that you are the person shown and agree to publication.',
    '请确认您是画面中的本人并同意公开。',
  ],
  MEDIA_LIMIT: [
    '掲載・審査中の上限に達しています。',
    'The limit for published and pending items has been reached.',
    '已达到展示和审核中的数量上限。',
  ],
  VIDEO_CODEC: [
    'H.264のMP4動画を選んでください。iPhoneは「互換性優先」で撮影するかMP4で書き出してください。',
    'Use an H.264 MP4. On iPhone, record with “Most Compatible” or export as MP4.',
    '请使用 H.264 编码的 MP4。iPhone 请在相机格式中选择“兼容性最佳”，或导出为 MP4。',
  ],
  VIDEO_TOO_LONG: [
    '60秒以内の動画にしてください。',
    'Keep it within 60 seconds.',
    '请控制在 60 秒以内。',
  ],
  INVALID_VIDEO: ['MP4動画を選んでください。', 'Select an MP4 video.', '请选择 MP4 视频。'],
  VIDEO_TOO_LARGE: [
    '20MB以内の動画にしてください。',
    'Keep it within 20 MB.',
    '请选择 20MB 以内的视频。',
  ],
  INVALID_PHOTO: [
    'JPEGまたはPNGの写真（350KB以内）を選んでください。',
    'Select a JPEG or PNG photo up to 350 KB.',
    '请选择 350KB 以内的 JPEG 或 PNG 照片。',
  ],
  MAIN_PHOTO_REQUIRED: [
    '出張サービスを有効にするには、承認済みのメイン写真が必要です。',
    'An approved main photo is required before enabling home visits.',
    '开启上门服务前，需要先有审核通过的主照片。',
  ],
} as const;
export type MediaText = keyof typeof words;
export const md = (l: Locale, key: MediaText) => words[key][l === 'ja' ? 0 : l === 'en' ? 1 : 2];
export const isMediaKey = (key: string): key is MediaText => key in words;
export const mediaStatus = (l: Locale, s: ListingMediaStatus, note?: string) =>
  note === 'REPLACED' ? md(l, 'REPLACED') : md(l, s);
/** 0:30 style duration for video badges. */
export const clock = (seconds?: number) => {
  const total = Math.round(seconds ?? 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
