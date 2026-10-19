import { notFound } from 'next/navigation';
import Link from 'next/link';
import { asLocale } from '@/lib/i18n';
const copy = {
  ja: {
    notice:
      'テスト環境の説明です。一般公開に向けた正式規約ではありません。実際の決済・施術には利用できません。',
    terms: 'テスト利用規約',
    privacy: 'テスト環境のプライバシー説明',
    back: 'アカウントに戻る',
    scope: 'サービスの範囲',
    scopeBody:
      '現在は予約、店舗受理、担当者確認、キャンセルの検証用です。表示される店舗、人物、金額と決済結果にはサンプルが含まれます。緊急時には本サービスの通知に依存せず、適切な窓口へ連絡してください。',
    account: 'アカウントと禁止事項',
    accountBody:
      'ご自身が管理するメールアドレスを使用してください。なりすまし、他人の資料の提出、性的・違法なサービスの要求、嫌がらせは禁止です。安全確認のため利用制限や記録の確認を行う場合があります。',
    data: '収集する情報と目的',
    dataBody:
      'メールアドレス、名前、パスワードのハッシュ、同意日時、予約と住所、メッセージ、提携申請資料を、認証、予約処理、安全確認、お問い合わせ対応のために処理します。テストには架空の住所と資料を使用してください。',
    protection: '保護と外部送信',
    protectionBody:
      'セッションは HttpOnly Cookie で管理し、権限に応じて情報へのアクセスを制限します。申請ファイルとメール本文は保存時に暗号化します。メール送信先と内容は、環境で設定した配信事業者に渡されます。',
    retention: '確認・削除の相談',
    retentionBody:
      '登録内容や削除に関する相談は、ログイン後のお問い合わせ窓口をご利用ください。本人確認後に対応します。正式公開前に運営主体、連絡先、保存期間と法令に基づく事項を確定し、規約を改めて案内します。',
  },
  en: {
    notice:
      'This notice covers the test environment. It is not the final public service agreement. Do not use it for actual payments or services.',
    terms: 'Test terms of use',
    privacy: 'Test privacy notice',
    back: 'Back to your account',
    scope: 'Scope',
    scopeBody:
      'This environment tests booking, shop acceptance, staff confirmation and cancellation. People, shops, amounts and payment results include samples. For an emergency, contact the appropriate emergency service directly; do not rely on this app’s notifications.',
    account: 'Accounts and prohibited conduct',
    accountBody:
      'Use an email address you control. Impersonation, submitting another person’s documents, requests for sexual or illegal services, and harassment are prohibited. Access may be restricted and records reviewed for safety.',
    data: 'Information and purpose',
    dataBody:
      'We process your email, name, password hash, consent timestamp, bookings, addresses, messages and partner application documents for authentication, bookings, safety and support. Use fictional addresses and documents when testing.',
    protection: 'Protection and delivery',
    protectionBody:
      'Sessions use HttpOnly cookies and information access is restricted by role. Application files and email bodies are encrypted at rest. Email recipients and content are passed to the delivery provider configured for the environment.',
    retention: 'Access and deletion requests',
    retentionBody:
      'For account information or deletion requests, use the support area after signing in. Identity will be checked before action. Before public release, the operator, contact details, retention periods and required legal notices must be finalized and updated terms presented.',
  },
  'zh-cn': {
    notice: '本说明适用于测试环境，并非正式对外运营协议。请勿据此进行真实支付或服务。',
    terms: '测试版服务条款',
    privacy: '测试版隐私说明',
    back: '返回顾客账号',
    scope: '适用范围',
    scopeBody:
      '当前用于验证预约、店铺受理、技师确认和取消流程。页面中的人物、店铺、金额及支付结果包含示例。紧急情况请直接联系相应的紧急服务机构，不要依赖本应用通知。',
    account: '账号与禁止行为',
    accountBody:
      '请使用本人控制的邮箱。禁止冒用身份、提交他人证件、请求色情或违法服务以及骚扰他人。平台可因安全事项限制使用并核查记录。',
    data: '信息类型与用途',
    dataBody:
      '我们处理邮箱、姓名、密码哈希、同意时间、预约、地址、会话和合作申请资料，用于身份认证、预约处理、安全核查及客服。测试时请使用虚构地址和资料。',
    protection: '保护与外部投递',
    protectionBody:
      '会话使用 HttpOnly Cookie，信息访问按角色限制。申请文件和邮件内容加密保存。邮件收件地址及内容会发送给环境中配置的邮件服务商。',
    retention: '查阅与删除申请',
    retentionBody:
      '如需查询账号资料或申请删除，请登录后通过客服入口提出，核实身份后处理。正式公开前，仍需确定运营主体、联系方式、留存期限及法定披露事项，并重新提示正式条款。',
  },
};
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; document: string }>;
}) {
  const { locale, document } = await params,
    l = asLocale(locale),
    t = copy[l];
  if (document !== 'terms' && document !== 'privacy') notFound();
  const keys = document === 'terms' ? ['scope', 'account'] : ['data', 'protection', 'retention'];
  return (
    <main id="main" className="workspace-shell">
      <article className="customer-auth-card quality-card">
        <h1>{t[document]}</h1>
        <p className="auth-delivery-note">{t.notice}</p>
        {keys.map((k) => (
          <section key={k}>
            <h2>{t[k as keyof typeof t]}</h2>
            <p>{t[`${k}Body` as keyof typeof t]}</p>
          </section>
        ))}
        <Link className="button secondary" href={`/${l}/account/access`}>
          {t.back}
        </Link>
      </article>
    </main>
  );
}
