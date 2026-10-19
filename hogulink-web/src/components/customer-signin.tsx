'use client';
import type { Locale } from '@hogulink/contracts';
import { ca } from '@/lib/customer-auth-i18n';
export function goCustomerAccess(locale: Locale, returnTo?: string) {
  window.location.assign(
    `/${locale}/account/access?${new URLSearchParams({ returnTo: returnTo || window.location.pathname + window.location.search })}`,
  );
}
export function CustomerSignIn({
  locale,
  className = 'button',
}: {
  locale: Locale;
  className?: string;
}) {
  return (
    <button className={className} type="button" onClick={() => goCustomerAccess(locale)}>
      {ca(locale, 'login')} / {ca(locale, 'register')}
    </button>
  );
}
