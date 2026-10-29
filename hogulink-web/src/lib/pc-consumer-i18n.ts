import type { Locale } from '@hogulink/contracts';

const copy = {
  noReviews: ['まだレビューはありません', 'No reviews yet', '暂无评价'],
  homeSubtitle: ['東京のリラクゼーション予約', 'Relaxation services in Tokyo', '东京放松服务预约'],
  homeHelp: [
    'メニュー、お店、担当者から選び、サービス方法と日時をご確認ください。',
    'Start with a service, therapist or shop, then choose how and when to book.',
    '从项目、技师或店铺开始，选择适合自己的服务方式与时间。',
  ],
  browse: ['サービスを探す', 'Find a service', '查找服务'],
  services: ['メニュー', 'Services', '选项目'],
  therapists: ['セラピスト', 'Therapists', '选技师'],
  shops: ['お店', 'Shops', '选店铺'],
  searchArea: ['エリア', 'Service area', '服务地区'],
  shopService: ['お店がサービスを手配', 'Service arranged by the shop', '由店铺安排服务'],
  chooseArea: ['出張先のエリアを選択', 'Choose your service area', '请选择上门地区'],
  areaFirst: [
    '料金と空き時間の確認には、出張先のエリアをお選びください。',
    'Choose your service area to see travel fees and available times.',
    '先选择上门地区，再查看交通费和可约时间。',
  ],
  areaPrice: [
    '出張料はエリア選択後に表示',
    'Travel fee shown after choosing an area',
    '交通费待选择地区后确认',
  ],
  changeService: ['メニューを変更', 'Change service', '更换项目'],
  chooseService: ['メニューを選択', 'Choose a service', '选择服务项目'],
  preference: ['担当者の希望', 'Therapist preference', '人员安排'],
  feeIncluded: [
    '指名料は合計に含まれます',
    'Nomination fee included in the total',
    '指名费已计入合计',
  ],
  noNomination: ['指名料なし', 'No nomination fee', '不收指名费'],
  nextStep: ['次のご案内', 'What happens next', '下一步'],
  waitingShop: [
    'お店が予約内容を確認しています。確定後にお知らせします。',
    'The shop is reviewing your request. We will show confirmation when it is ready.',
    '店铺正在确认预约申请，请等待安排结果。',
  ],
  waitingTherapist: [
    'お店が受理しました。担当者の確認をお待ちください。',
    'The shop has accepted your request and is confirming the therapist.',
    '店铺已受理，正在确认服务技师。',
  ],
  arranging: [
    'お店が担当者を調整しています。確定した担当者をこちらでご確認ください。',
    'The shop is arranging a therapist. Check here for the confirmed assignment.',
    '店铺正在重新安排技师，请留意确认结果。',
  ],
  replacement: [
    '担当者の変更についてご確認ください。ご同意なしに指名担当者は変更されません。',
    'Review the proposed replacement. Your nominated therapist will not change without your consent.',
    '请查看候选技师与费用变化，由您决定是否同意改派。',
  ],
  homeReady: [
    'ご予約が確定しました。日時と出張先住所をご確認ください。',
    'Your booking is confirmed. Check the appointment time and service address.',
    '预约已确认，请核对服务时间与上门地址。',
  ],
  storeReady: [
    'ご予約が確定しました。予約時刻にお店へお越しください。',
    'Your booking is confirmed. Please arrive at the shop at your appointment time.',
    '预约已确认，请按预约时间前往门店，并出示核销码。',
  ],
  checkedIn: [
    '来店の受付が完了しました。担当者のご案内をお待ちください。',
    'You are checked in. Please wait for the therapist to begin your service.',
    '已完成到店签到，请等待技师开始服务。',
  ],
  onWay: [
    '担当者が出発しました。連絡が必要な場合はお店へお知らせください。',
    'Your therapist is on the way. Contact the shop if you need assistance.',
    '技师已出发，如需沟通请联系店铺。',
  ],
  arrived: [
    '担当者が到着しました。本人を確認してサービスをお待ちください。',
    'Your therapist has arrived. Check their identity before the service starts.',
    '技师已到达，请核对本人身份并等待服务开始。',
  ],
  serving: [
    'サービス中です。終了後に時間と料金をご確認ください。',
    'Your service is in progress. Review the time and amount after it ends.',
    '服务进行中，结束后请核对服务记录与金额。',
  ],
  completion: [
    'サービスが終了しました。内容をご確認いただくか、問題をお知らせください。',
    'The service has ended. Review the details and confirm, or report a problem.',
    '服务已结束，请核对记录和金额，确认完成或提出问题。',
  ],
  completionReview: [
    'サービスの確認事項をお店が調査しています。処理状況はこちらで確認できます。',
    'Your service requires review. Follow the shop’s response and case progress here.',
    '本次服务正在核实中，请查看处理记录与店铺回复。',
  ],
  paymentAction: [
    '予約の支払い確認が必要です。表示された期限までにお手続きください。',
    'Your booking needs payment verification. Complete the required step by the displayed deadline.',
    '预约需要更新支付保障，请在提示的期限内处理。',
  ],
  completed: [
    'サービスが完了しました。評価、再予約、アフターサポートをご利用いただけます。',
    'Your service is complete. You can leave a review, book again, or get support.',
    '服务已完成，可以评价、再次预约或申请售后。',
  ],
  closed: [
    'この予約は終了しています。料金と処理結果をご確認いただけます。',
    'This booking is closed. You can still review its charges and support history.',
    '这笔预约已关闭，仍可查看费用结果和售后记录。',
  ],
  respondBy: ['回答期限', 'Response due', '处理截止'],
  contact: ['お店に連絡', 'Contact the shop', '联系店铺'],
  viewVenue: ['お店・受付コードを見る', 'View venue and check-in code', '查看门店与核销码'],
  viewService: ['予約内容を見る', 'View booking details', '查看预约信息'],
  reviewService: ['サービスを確認', 'Review your service', '核对服务记录'],
  reviewReplacement: ['担当者の変更を確認', 'Review replacement', '查看改派方案'],
  venueArea: ['店舗エリア', 'Shop area', '门店所在地区'],
  therapist: ['サービス担当者', 'Service therapist', '服务技师'],
  notAssigned: ['お店が手配中', 'Being arranged by the shop', '店铺安排中'],
  support: ['ヘルプ・サポート', 'Help and support', '帮助与售后'],
  noCharge: [
    'まだ請求されていません。お困りの際は、この予約からご連絡ください。',
    'You have not been charged. If you need help, contact us from this booking.',
    '当前尚未扣款。如遇问题，可从本订单联系店铺或申请协助。',
  ],
  records: ['予約の履歴', 'Booking history', '预约处理记录'],
  moreTools: ['その他のツール', 'More tools', '更多工具'],
  bookingTitle: ['サービス・日時を選ぶ', 'Choose service and time', '选择服务与时间'],
  selected: ['選択中の予約', 'Your booking', '本次预约'],
  request: ['予約内容を確認', 'Review booking request', '核对预约申请'],
  addressStep: ['連絡先・場所を確認', 'Confirm location and contact', '确认地点与联系信息'],
} as const;
export type PcConsumerText = keyof typeof copy;
export const pc = (locale: Locale, key: PcConsumerText) =>
  copy[key][locale === 'ja' ? 0 : locale === 'en' ? 1 : 2];
