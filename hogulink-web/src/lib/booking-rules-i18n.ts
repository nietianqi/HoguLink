import type { Locale } from '@hogulink/contracts';
const words = {
  title: ['指名料とキャンセル規定', 'Nomination fee & cancellation policy', '指名费与取消政策'],
  fee: ['店舗の指名料（円）', 'Shop nomination fee (JPY)', '本店指名费（日元）'],
  feeHelp: [
    '0〜200,000円。指名なしは常に0円、同意済みの改派でも指名料は免除されます。',
    'JPY 0–200,000. Shop-assigned visits have no nomination fee; agreed replacements waive it.',
    '可设为 0–200,000 日元。不指名始终为 0，顾客同意改派后免指名费。',
  ],
  template: ['キャンセル規定', 'Cancellation policy', '取消政策'],
  LEGACY: ['従来のデモ規定', 'Existing demo policy', '原演示政策'],
  FLEXIBLE_2H: [
    '2時間前まで無料 · 以降30%',
    'Free until 2 hours before · then 30%',
    '提前 2 小时免费 · 之后 30%',
  ],
  STANDARD_24H: [
    '24時間前まで無料 · 30% / 50%',
    'Free until 24 hours before · 30% / 50%',
    '提前 24 小时免费 · 分档 30% / 50%',
  ],
  CUSTOM: ['店舗のカスタム規定', 'Custom shop policy', '店铺自定义政策'],
  free: [
    '無料取消の期限（開始前の時間）',
    'Free cancellation cutoff (hours before)',
    '免费取消截止（开始前小时）',
  ],
  late: ['期限後の取消料（%）', 'Cancellation rate after cutoff (%)', '截止后取消比例（%）'],
  near: [
    '直前料金の開始（開始前の時間）',
    'Final tier starts (hours before)',
    '临近开始档起点（开始前小时）',
  ],
  nearHelp: [
    '0で直前の別料金なし。無料期限より短く設定してください。',
    'Use 0 for one rate. Otherwise choose a shorter window than the free cutoff.',
    '设为 0 使用单档；启用时须小于免费截止时间。',
  ],
  nearFee: ['直前の取消料（%）', 'Final cancellation rate (%)', '临近开始取消比例（%）'],
  noShow: ['不在確認後の料金（%）', 'Verified no-show rate (%)', '核实爽约后的比例（%）'],
  rateHelp: [
    '0〜99%。開始に近づくほど割合は下げられません。不在料金は取消料以上です。交通費は割合計算から除外します。',
    'Rates are 0–99%, increasing or equal nearer the visit. No-show rates cannot be lower. Travel is excluded from percentage fees.',
    '比例为 0–99%，临近开始档不得更低，爽约比例不得低于取消比例；百分比均不含交通费。',
  ],
  preview: ['保存後の規定プレビュー', 'Preview after saving', '保存后的政策预览'],
  effective: ['現在の規定', 'Current policy', '当前生效政策'],
  applies: [
    '新しい見積りに適用します。未送信の見積りは再確認が必要です。送信済み予約の料金・規定は変わりません。',
    'Applies to new quotes. Existing unsubmitted quotes must be reviewed again. Submitted bookings keep their agreed prices and policy.',
    '应用于新报价；未提交的旧报价需重新核对。已提交订单保留原价格与政策。',
  ],
  error: [
    '金額、時間帯、割合の大小関係を確認してください。',
    'Check the fee, time windows and rate order.',
    '请检查金额、时间区间和各档比例的大小关系。',
  ],
  failed: [
    '保存できませんでした。上部のエラーを確認して再試行してください。',
    'Could not save. Check the message above and try again.',
    '保存未成功，请查看上方错误提示后重试。',
  ],
  history: ['最近の料金・規定変更', 'Recent price & policy changes', '最近费用与政策变更'],
  frozen: [
    '予約時に合意した取消規定',
    'Cancellation policy agreed at booking',
    '本订单确认的取消政策',
  ],
  surchargeTitle: ['時間帯加算', 'Time-band surcharge', '时段附加费'],
  surchargeHelp: [
    '予約の開始時刻（日本時間）で判定し、日付をまたいでも二重に加算しません。最大2区間、15分単位、1区間100〜20,000円。保存後の新しい見積もりから適用され、確定済みの予約は変わりません。',
    'Judged by the visit start in Japan time and never charged twice across midnight. Up to 2 bands, 15-minute steps, JPY 100–20,000 each. Applies to new quotes after saving; placed orders keep their price.',
    '按服务开始时间（日本时间）判断，跨午夜不重复收取。最多 2 段，15 分钟为单位，每段 100–20,000 日元。保存后对新报价生效，已提交订单不变。',
  ],
  surchargeHours: [
    '通常予約の開始は9:00〜21:30です。22:00〜6:00の加算は主に「今すぐ」予約に適用されます。',
    'Scheduled visits start between 09:00 and 21:30, so a 22:00–06:00 band mainly applies to instant visits.',
    '指定时间预约的开始时间为 9:00–21:30，因此 22:00–6:00 的附加费主要作用于即时预约。',
  ],
  surchargeStart: ['開始', 'From', '开始'],
  surchargeEnd: ['終了', 'Until', '结束'],
  surchargeAmount: ['加算額（円）', 'Surcharge (JPY)', '附加金额（日元）'],
  surchargeAdd: ['区間を追加', 'Add band', '添加时段'],
  surchargeRemove: ['削除', 'Remove', '删除'],
  surchargeNone: ['時間帯加算なし', 'No time-band surcharge', '无时段附加费'],
  travelTitle: ['エリア別交通費', 'Travel fee by area', '按地区交通费'],
  travelHelp: [
    'エリアごとに0〜20,000円で設定します。空欄のエリアは各メニューの交通費を使います。交通費0円のメニューはどのエリアでも無料のままです。保存後の新しい見積もりから適用されます。',
    'Set JPY 0–20,000 per area. Blank areas use each menu’s travel fee, and menus with a zero travel fee stay free everywhere. Applies to new quotes after saving.',
    '每个地区可设 0–20,000 日元。留空的地区使用各项目自己的交通费；交通费为 0 的项目在所有地区都免交通费。保存后对新报价生效。',
  ],
  travelBlank: ['メニューの交通費', 'Menu travel fee', '按项目交通费'],
  travelNone: ['エリア別交通費なし', 'No area travel fees', '未设置地区交通费'],
  boundary: [
    'プレビューの金額はデモ用です。公開には正式な規定の確認が必要です。',
    'These are demo policy settings. Formal terms require review before publication.',
    '当前为演示政策配置，正式发布前仍需审定条款。',
  ],
} as const;
export function br(locale: Locale, key: keyof typeof words) {
  return words[key][locale === 'ja' ? 0 : locale === 'en' ? 1 : 2];
}
