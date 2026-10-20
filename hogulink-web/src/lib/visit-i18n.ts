import type { Locale, AcceptanceMode, Quote } from '@hogulink/contracts';
const words = {
  therapistUnavailable: [
    '担当者のプロフィールを取得できません',
    'Therapist profile unavailable',
    '技师资料暂不可用',
  ],
  bookingProgress: ['予約の進捗', 'Booking progress', '预约进度'],
  checkoutUnavailable: [
    '予約内容を確認できません',
    'Unable to load this reservation',
    '暂时无法查看此预约',
  ],
  chooseAnotherTime: ['別の時間を選ぶ', 'Choose another time', '重新选择预约时段'],
  noOrderMessages: [
    'まだメッセージはありません。',
    'No messages in this booking yet.',
    '此预约暂无消息。',
  ],
  orderDetails: ['予約の詳細', 'Booking details', '预约详情'],
  backBookings: ['予約一覧に戻る', 'Back to bookings', '返回预约列表'],
  progressSubmitted: ['申込み', 'Request sent', '提交申请'],
  progressResponse: ['店舗・担当者の確認', 'Shop & therapist review', '店铺与技师确认'],
  progressConfirmed: ['予約確定', 'Visit confirmed', '预约确认'],
  progressService: ['サービス中', 'In service', '服务中'],
  progressApproval: ['完了の確認', 'Completion review', '完成验收'],
  progressCompleted: ['完了', 'Completed', '已完成'],
  closedOrderHelp: [
    'この予約は終了しました。料金・条件・サポートは引き続き確認できます。',
    'This booking is closed. Prices, terms and support remain available.',
    '此预约已关闭，仍可查看原费用、政策及售后。',
  ],
  visitWindow: ['予約時間', 'Visit time', '预约时间'],
  selectedTime: ['選択した時間', 'Selected time', '已选时段'],
  nextStepHelp: [
    '次に住所と確定見積りを確認します。',
    'Next, review your address and final quote.',
    '下一步填写地址并核对最终报价。',
  ],
  chooseScheduled: ['日時指定に切り替える', 'Choose a scheduled visit', '改为指定时间预约'],
  about: ['このセラピストについて', 'Meet your therapist', '了解这位技师'],
  shopAbout: ['お店について', 'About the shop', '了解这家店铺'],
  serviceMenu: ['サービスと料金', 'Services & prices', '服务项目与费用'],
  team: ['お店のセラピスト', 'Meet the team', '店铺技师'],
  visitInfo: ['ご予約の前に', 'Before your visit', '预约前须知'],
  plan: ['あなたのひと息を、予約。', 'Make time for yourself.', '为自己，预留一段时光。'],
  preview: ['空き時間と料金を確認', 'Check times & prices', '查看时段与费用'],
  totalNote: [
    '指名料・交通費・税込み',
    'Includes nomination, travel & tax',
    '已含指名费、交通费与税费',
  ],
  freeTotalNote: [
    '交通費・税込み、指名料なし',
    'Includes travel & tax. No nomination fee.',
    '已含交通费与税费，不收指名费',
  ],
  estimate: [
    '概算 · 次の画面で確定見積り',
    'Estimate · Final quote at the next step',
    '预估费用 · 下一步核对最终报价',
  ],
  selectTime: ['空き時間をお選びください', 'Choose an available time', '请选择可预约时段'],
  loadingSlots: ['空き状況を確認しています…', 'Checking availability…', '正在查询可预约时段…'],
  emptySlots: [
    'この条件で空き枠がありません。条件を変更してください。',
    'No times match these choices. Try a different service or language.',
    '当前条件暂无可约时段，请调整项目或语言。',
  ],
  staleSlot: [
    '選択した時間は利用できなくなりました。もう一度お選びください。',
    'Your selected time is no longer available. Please choose again.',
    '所选时段已不可用，请重新选择。',
  ],
  retry: ['空き状況を再確認', 'Refresh availability', '重新查询时段'],
  moreTimes: ['すべての時間を見る', 'Show all times', '展开全部时段'],
  fewerTimes: ['時間を折りたたむ', 'Show fewer times', '收起时段'],
  jst: ['表示はすべて日本時間（JST）', 'All times are in Japan · JST', '所有时段均为日本时间 JST'],
  slotHint: [
    '時間枠は次の画面で一時確保します。',
    'Your time is temporarily held at the next step.',
    '进入下一步后，系统才会暂时保留时段。',
  ],
  nominatedHelp: [
    '表示されたセラピストを指名します。変更にはお客様の同意が必要です。',
    'Choose this therapist. A replacement requires your consent.',
    '指定当前技师，更换履约技师须经你同意。',
  ],
  freeHelp: [
    '条件に合う同じお店の担当者を、お店が手配します。',
    'The shop assigns a qualified team member who matches your selected language.',
    '由店铺安排符合所选语言条件的同店技师。',
  ],
  noInstant: [
    'この条件では今すぐの訪問を受け付けていません。日時指定をご利用ください。',
    'Instant visits are unavailable for these choices. Please schedule a visit.',
    '当前条件暂不支持即时预约，请选择指定时间。',
  ],
  manualHelp: [
    '店舗の受理と担当者の確認後に予約が確定します。',
    'Your booking is confirmed after the shop and therapist respond.',
    '店铺受理并由技师确认任务后，预约才会确认。',
  ],
  autoHelp: [
    '承認ルールに合う場合は店舗が自動受理します。条件外の通常予約は手動確認となり、担当者の業務確認も必要です。',
    'Matching requests are accepted automatically. Other scheduled requests need shop review. Therapist confirmation is also required.',
    '符合店铺授权规则时自动受理，范围外的普通预约转人工审核；技师仍须单独确认任务。',
  ],
  soloHelp: [
    '店主が担当します。店主の受理で予約が確定します。',
    'The owner provides the service. Confirmation follows their acceptance.',
    '由店主本人履约，店主受理后预约确认。',
  ],
  automatic: ['自動受理対応', 'Automatic acceptance', '支持自动受理'],
  manual: ['店舗が確認して受理', 'Shop confirmation', '店铺人工受理'],
  solo: ['店主が直接対応', 'Owner operated', '店主亲自履约'],
  hotelHelp: [
    'この担当者の訪問先はホテルに限られます。ホテルの訪問者受け入れをご確認ください。',
    'This therapist visits hotels only. Please confirm that your hotel allows visitors.',
    '此技师仅接酒店服务，请事先确认酒店允许访客。',
  ],
  homeHelp: [
    'サービス対応エリア内のご自宅・ホテルへ訪問します。',
    'Visits are available at home or at a hotel within the shop’s service areas.',
    '可在店铺服务地区内的住宅或酒店接受服务。',
  ],
  included: ['料金の内訳', 'Your price breakdown', '费用明细'],
  edit: ['内容を変更', 'Edit your visit', '修改预约内容'],
  editHint: [
    '変更すると現在の時間確保と未請求の決済認証を解除します。',
    'Editing releases this time and voids any unused payment authorization.',
    '修改将释放当前时段，并作废尚未使用的支付授权。',
  ],
  step1: ['サービスと日時', 'Service & time', '服务与时间'],
  step2: ['住所と決済', 'Address & payment', '地址与支付'],
  step3: ['予約を申し込む', 'Submit request', '提交预约申请'],
  bookingTitle: [
    '心地よい時間を、あなたの場所で。',
    'A little calm, at your place.',
    '一段放松时光，就在你的身边。',
  ],
  bookingText: [
    'サービス・担当者・日時を選んで、料金を確認しましょう。',
    'Choose your service, therapist preference and time. Then review the full price.',
    '选择项目、技师与上门时间，再核对完整费用。',
  ],
  checkoutText: [
    '住所と料金を確認して、店舗へ予約を申し込みます。',
    'Confirm your address and price, then send your request to the shop.',
    '确认地址、费用与支付保障后，向店铺提交预约申请。',
  ],
  session: ['選択したサービス', 'Your selected session', '已选服务'],
  location: ['訪問エリア', 'Visit area', '上门地区'],
  addressPrivacy: [
    '住所は予約の権限と進捗に応じて共有します。',
    'Your address is shared according to booking permissions and progress.',
    '地址按预约权限与履约阶段共享。',
  ],
  paymentHelp: [
    '現時点で請求は行いません。購入時間の提供とお客様の完了確認後に請求します。',
    'No charge is captured now. Capture follows the purchased duration and your confirmation.',
    '当前不作实际扣款，服务足时结束且由你确认完成后才扣款。',
  ],
  frozenQuote: [
    '確保時の見積りとキャンセル条件が適用されます。',
    'The quote and cancellation terms saved with this reservation apply.',
    '以本次保留时段时保存的报价与取消政策为准。',
  ],
  noReviews: [
    '評価・レビューは準備中です。',
    'Reviews are not available yet.',
    '评价功能尚未开放。',
  ],
  shopDescription: [
    'お店がサービスの提供・料金・履行を担当します。セラピストと内容を選んで、ご希望の場所でひと息。',
    'The shop sets prices and provides your service. Choose a session and enjoy a quiet moment at your place.',
    '店铺负责服务提供、定价与履约。选择合适的项目与技师，在熟悉的地方安心放松。',
  ],
  shopLocationNote: [
    '出張サービスです。所在地は事業者の表示住所で、来店先ではありません。',
    'This is a visiting service. The listed business address is not a walk-in venue.',
    '本店提供上门服务，经营主体地址并非到店服务地点。',
  ],
  demoLegal: [
    'デモ情報です。法定表示と翻訳は公開前の審査が必要です。',
    'Demo information. Legal disclosures and translations require review before publication.',
    '以上为演示信息，完整法定披露与译文需在发布前审核。',
  ],
  noTeam: [
    '現在、公開中の担当者はいません。',
    'No therapists are currently published.',
    '当前暂无公开技师。',
  ],
  selectSession: ['まずサービスを選んでください', 'Choose a service first', '请先选择服务项目'],
  noService: [
    'この条件で提供可能なサービスはありません。',
    'No service is available for these choices.',
    '当前条件暂无可提供的服务。',
  ],
  business: ['提供する事業者', 'Service provider', '服务经营主体'],
  policyLink: ['詳細とご利用条件', 'Full terms & guidance', '查看完整条款与说明'],
  paySaved: [
    '認証済みの決済方法を保存しました',
    'Authenticated payment method saved',
    '已保存认证支付方式',
  ],
  requestNote: [
    '申込みだけでは予約は確定しません。お店と担当者の確認をお待ちください。',
    'Submitting a request does not confirm the visit. Please await the shop and therapist’s response.',
    '提交申请不代表预约已经确认，请等待店铺与技师确认。',
  ],
} as const;
export function vt(l: Locale, key: keyof typeof words) {
  return words[key][l === 'ja' ? 0 : l === 'en' ? 1 : 2];
}
export function acceptanceLabel(l: Locale, mode: AcceptanceMode) {
  return vt(l, mode === 'MANUAL' ? 'manual' : mode === 'SOLO' ? 'solo' : 'automatic');
}
export function acceptanceHelp(l: Locale, mode: AcceptanceMode) {
  return vt(l, mode === 'MANUAL' ? 'manualHelp' : mode === 'SOLO' ? 'soloHelp' : 'autoHelp');
}
export function policyText(
  l: Locale,
  policy: Pick<
    Quote['cancellationPolicy'],
    | 'freeBeforeMinutes'
    | 'lateFeeBps'
    | 'noShow'
    | 'instantTravelOnly'
    | 'instantDelayGraceMinutes'
    | 'scheduledTiers'
  >,
  mode?: 'INSTANT' | 'SCHEDULED',
) {
  const hours = policy.freeBeforeMinutes / 60,
    percent = policy.lateFeeBps / 100;
  let cancellation =
    l === 'ja'
      ? `開始${hours}時間前まで無料。その後のお客様都合のキャンセルは交通費を除く金額の${percent}%。店舗都合・改派辞退は無料です。`
      : l === 'en'
        ? `Free until ${hours} hours before the visit. Later customer cancellations cost ${percent}% excluding travel. Shop cancellations and declined replacements are free.`
        : `开始前 ${hours} 小时可免费取消。之后顾客原因取消收取交通费以外金额的 ${percent}%；店铺原因或拒绝改派免费。`;
  if (policy.scheduledTiers) {
    const tiers = policy.scheduledTiers;
    const bands = [...tiers]
      .reverse()
      .map((tier, i, reversed) => {
        const from = reversed[i + 1]?.withinMinutes ?? 0;
        const high = tier.withinMinutes / 60,
          low = from / 60,
          rate = tier.feeBps / 100;
        return l === 'ja'
          ? `開始まで${low}時間以上${high}時間未満は${rate}%`
          : l === 'en'
            ? `${low} to under ${high} hours before: ${rate}%`
            : `距开始 ${low} 小时至不足 ${high} 小时收取 ${rate}%`;
      })
      .join(l === 'en' ? '; ' : '；');
    cancellation =
      l === 'ja'
        ? `開始${hours}時間前まで無料。${bands}（交通費を除く）。開始時刻以降は直前の割合を適用。店舗都合・改派辞退は無料です。`
        : l === 'en'
          ? `Free until ${hours} hours before. ${bands}, excluding travel. The final rate also applies after the start time. Shop cancellations and declined replacements are free.`
          : `开始前 ${hours} 小时及更早免费。${bands}（均不含交通费）。开始时刻后沿用最后一档比例；店铺原因或拒绝改派免费。`;
  }
  if (policy.instantTravelOnly && mode !== 'SCHEDULED') {
    const instant =
      l === 'ja'
        ? `即時予約は出発前無料、出発後は交通費のみ。到着目安から${policy.instantDelayGraceMinutes ?? 15}分超過して未到着の場合は無料です。`
        : l === 'en'
          ? `Instant visits are free to cancel before departure; after departure only the quoted travel fee applies. If arrival is ${policy.instantDelayGraceMinutes ?? 15} minutes beyond the original promise, cancellation is free.`
          : `即时单出发前免费取消，出发后仅收约定交通费；超过原到达目安 ${policy.instantDelayGraceMinutes ?? 15} 分钟仍未到达，可免费取消。`;
    cancellation = mode === 'INSTANT' ? instant : cancellation + ' ' + instant;
  }
  if (!policy.noShow) return cancellation;
  const n = policy.noShow;
  return (
    cancellation +
    (l === 'ja'
      ? ` 到着後${n.minContacts}回以上の連絡（${n.contactGapMinutes}分間隔）を行い、連絡開始・到着・予約開始の最も遅い時点から${n.waitMinutes}分待機し、店舗が不在と確認した場合は交通費を除く金額の${n.feeBps / 100}%を申し受けます。`
      : l === 'en'
        ? ` A no-show charge of ${n.feeBps / 100}% excluding travel requires ${n.minContacts} recorded contact attempts at least ${n.contactGapMinutes} minutes apart, ${n.waitMinutes} minutes of waiting from the latest of first contact, arrival and scheduled start, and shop review.`
        : ` 爽约须到达后至少联系 ${n.minContacts} 次，间隔不少于 ${n.contactGapMinutes} 分钟，自开始联系、到达或约定开始三者最晚时间起等待 ${n.waitMinutes} 分钟，经店铺核实后收取交通费外金额的 ${n.feeBps / 100}%。`)
  );
}
