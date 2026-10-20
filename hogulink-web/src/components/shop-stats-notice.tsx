'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@hogulink/contracts';
import { ht } from '@/lib/h5-i18n';

export function ShopStatsNotice({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="shop-stats-notice" role="status">
      <span>{ht(locale, 'shopStatsUnavailable')}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {ht(locale, pending ? 'loading' : 'retryAction')}
      </button>
    </div>
  );
}
