import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="wrap page-section">
      <div className="empty-state">
        <span className="eyebrow">404</span>
        <h1>ページが見つかりません / Page not found / 页面不存在</h1>
        <p>This content may be unavailable.</p>
        <Link href="/ja" className="button">
          HoguLink ↗
        </Link>
      </div>
    </main>
  );
}
