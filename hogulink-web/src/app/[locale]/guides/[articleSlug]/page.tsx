import { notFound } from 'next/navigation';
import { asLocale, t } from '@/lib/i18n';
import { seo } from '@/lib/seo';
import Link from 'next/link';
import { discoveryArticles } from '@/lib/discovery-content';
import { xt } from '@/lib/discovery-i18n';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; articleSlug: string }>;
}) {
  const p = await params;
  const l = asLocale(p.locale);
  return seo(
    l,
    `/guides/${p.articleSlug}`,
    discoveryArticles.find((a) => a.slug === p.articleSlug)?.title[l] ??
      t(l, p.articleSlug === 'terms' ? 'terms' : 'safety'),
    t(l, 'nonMedical'),
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; articleSlug: string }>;
}) {
  const p = await params;
  const article = discoveryArticles.find((a) => a.slug === p.articleSlug);
  if (article) {
    const l = asLocale(p.locale);
    return (
      <main id="main" className="wrap page-section">
        <article className="guide-content discovery-article">
          <Link href={`/${l}/discover`}>{xt(l, 'returnDiscover')}</Link>
          <span className="quality-eyebrow">HOGULINK / FIELD NOTES</span>
          <h1>{article.title[l]}</h1>
          <p className="discovery-article-intro">{article.summary[l]}</p>
          <p className="notice">{xt(l, 'editorial')}</p>
          {article.sections.map((s, i) => (
            <section key={i}>
              <h2>{s.heading[l]}</h2>
              <p>{s.text[l]}</p>
            </section>
          ))}
          <div className="discovery-article-actions">
            <Link className="quality-primary" href={`/${l}/services`}>
              {xt(l, 'viewServices')}
            </Link>
            <Link className="quality-button" href={`/${l}/discover?tab=shops`}>
              {xt(l, 'shops')}
            </Link>
          </div>
        </article>
      </main>
    );
  }
  if (!['terms', 'booking-and-safety'].includes(p.articleSlug)) notFound();
  const l = asLocale(p.locale);
  return (
    <main id="main" className="wrap page-section">
      <article className="guide-content">
        <span className="eyebrow small">HOGULINK / GUIDE</span>
        <h1>{t(l, p.articleSlug === 'terms' ? 'terms' : 'safety')}</h1>
        <p className="notice">{t(l, 'demo')}</p>
        <h2>{t(l, 'shopProvider')}</h2>
        <p>
          {l === 'ja'
            ? 'サービスの契約・料金設定・提供・返金対応は、ご予約画面に記載された店舗の事業者が行います。HoguLink は発見・予約・決済体験・安全管理のためのシステムを提供します。'
            : l === 'en'
              ? 'The business shown on your booking is responsible for the service contract, pricing, delivery and refunds. HoguLink provides discovery, booking, payment experience and safety tools.'
              : '预约页面列示的店铺经营主体负责服务合同、定价、履约与退款。HoguLink 提供发现、预约、支付体验和安全管理系统。'}
        </p>
        <h2>{t(l, 'howTitle')}</h2>
        <p>
          {t(l, 'step1Text')} {t(l, 'step2Text')} {t(l, 'step3Text')} {t(l, 'payExplain')}
        </p>
        <h2>{t(l, 'policy')}</h2>
        <p>{t(l, 'policyText')}</p>
        <h2>{t(l, 'safety')}</h2>
        <p>
          {t(l, 'nonMedical')}{' '}
          {l === 'ja'
            ? '性的なサービスやハラスメントは禁止しています。担当者の変更は、指名予約ではお客様の明示的な同意が必要です。住所は確認済みの担当者に業務に必要な間だけ表示されます。'
            : l === 'en'
              ? 'Sexual services and harassment are prohibited. A nominated therapist can only be replaced with your explicit consent. Your full address is shown only to the confirmed therapist while needed for the task.'
              : '禁止任何性服务或骚扰。指定技师的变更必须获得顾客明确同意。完整地址仅在任务所需期间向已确认的履约技师显示。'}
        </p>
        <h2>{t(l, 'support')}</h2>
        <p>{t(l, 'supportText')}</p>
        <p className="muted">
          {l === 'ja'
            ? 'これは開発用サンプルです。正式な利用規約・法定表示・英中訳文の審査は未完了です。'
            : l === 'en'
              ? 'This is a development sample. Formal terms, legal disclosures and translations have not completed review.'
              : '本页为开发样例，正式条款、法定披露与英中译文尚未完成审核。'}
        </p>
      </article>
    </main>
  );
}
