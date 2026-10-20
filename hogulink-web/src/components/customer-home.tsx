'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CustomerOverview, Locale, MobileTherapists } from '@hogulink/contracts';
import { api, type Catalog } from '@/lib/api';
import { areaName, areas, dateTime, statusText, t } from '@/lib/i18n';
import { ht } from '@/lib/h5-i18n';
import { cui } from '@/lib/customer-ui-i18n';
import { serviceChoices } from '@/lib/consumer-model';
import { shopCards, shopCardHref } from '@/lib/shop-model';
import { useSession } from './booking-form';
import { H5ShopCard } from './h5-shops';
import { CustomerTherapistCard } from './customer-therapist-card';
import { ActionBar, Button, Card, EmptyState, Price, SectionHeading } from './ui';

function CurrentBooking({ locale: l }: { locale: Locale }) {
  const { actor } = useSession();
  const [result, setResult] = useState<{
    actor: string;
    value?: CustomerOverview;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (actor?.role !== 'CUSTOMER') return;
    let cancelled = false,
      generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const value = await api<CustomerOverview>('customer/overview');
        if (!cancelled && request === generation) setResult({ actor: actor.id, value });
      } catch {
        if (!cancelled && request === generation) setResult({ actor: actor.id, failed: true });
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [actor?.id, actor?.role]);
  if (actor?.role !== 'CUSTOMER' || result?.actor !== actor.id) return null;
  if (result.failed)
    return (
      <Link className="ui-current-booking" href={`/${l}/account/bookings`}>
        {cui(l, 'orderFailed')}
      </Link>
    );
  const focus = result.value?.focus;
  if (!focus) return null;
  return (
    <Link className="ui-current-booking" href={`/${l}/account/bookings/${focus.id}`}>
      <span>
        <small>{cui(l, 'current')}</small>
        <strong>
          {focus.requiresConsent
            ? cui(l, 'consent')
            : focus.status === 'AWAITING_COMPLETION'
              ? cui(l, 'completion')
              : statusText(l, focus.status)}
        </strong>
        <small>
          {focus.serviceName[l]} · {dateTime(l, focus.startAt)}
        </small>
      </span>
      <span>{cui(l, 'order')} →</span>
    </Link>
  );
}

export function CustomerHome({
  locale: l,
  catalog,
  recommendations,
  q,
}: {
  locale: Locale;
  catalog: Catalog;
  recommendations: MobileTherapists | null;
  q: Record<string, string>;
}) {
  const [mode, setMode] = useState(q.mode);
  const carry = Object.fromEntries(
    Object.entries(q).filter(([k]) => ['area', 'language', 'mode', 'duration'].includes(k)),
  );
  const browse = (view: string) =>
    `/${l}/therapists?${new URLSearchParams({ ...Object.fromEntries(Object.entries(carry).filter(([k]) => view === 'therapists' || k !== 'duration')), view })}`;
  const shops = shopCards(catalog, {
    area: q.area,
    language: q.language,
    mode: q.mode,
    locale: l,
  }).slice(0, 3);
  const offers = serviceChoices(catalog, {
    area: q.area,
    language: q.language,
    mode: q.mode,
    locale: l,
    promotions: true,
  }).slice(0, 3);
  return (
    <main id="main" className="customer-home wrap">
      <section className="ui-home-booking">
        <div className="ui-home-intro">
          <p className="ui-kicker">HOGULINK · TOKYO</p>
          <h1>{cui(l, 'title')}</h1>
          <p>{cui(l, 'intro')}</p>
        </div>
        <Card className="ui-quick-booking">
          <h2>{cui(l, 'quick')}</h2>
          <form action={`/${l}/therapists`}>
            <label>
              {t(l, 'area')}
              <select name="area" defaultValue={q.area ?? ''}>
                <option value="">{t(l, 'all')}</option>
                {Object.keys(areas).map((a) => (
                  <option key={a} value={a}>
                    {areaName(l, a)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ht(l, 'directoryDuration')}
              <select name="duration" defaultValue={q.duration}>
                {[60, 90, 120].map((n) => (
                  <option key={n} value={n}>
                    {n} {t(l, 'minutes')}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="ui-mode-choice">
              <legend className="sr-only">{t(l, 'mode')}</legend>
              {(['SCHEDULED', 'INSTANT'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {t(l, value === 'INSTANT' ? 'instant' : 'scheduled')}
                </button>
              ))}
              <input type="hidden" name="mode" value={mode} />
            </fieldset>
            {q.language && <input type="hidden" name="language" value={q.language} />}
            <ActionBar>
              <Button>{cui(l, 'start')} →</Button>
            </ActionBar>
          </form>
          <p className="ui-trust-line">{cui(l, 'trust')}</p>
          <CurrentBooking locale={l} />
        </Card>
      </section>
      {!!offers.length && (
        <section className="ui-home-offers">
          <SectionHeading href={`${browse('services')}&promo=1`} action={cui(l, 'allTherapists')}>
            {ht(l, 'promotions')}
          </SectionHeading>
          <div className="ui-offer-grid">
            {offers.map((item) => (
              <Link
                className="ui-card ui-offer"
                key={item.offering.id}
                href={`/${l}/therapists?${new URLSearchParams({ ...carry, view: 'services', duration: String(item.offering.durationMinutes), offering: item.offering.id, promo: '1' })}`}
              >
                <span>
                  <strong>{item.store.name[l]}</strong>
                  <small>
                    {item.offering.name[l]} · {item.offering.durationMinutes} {t(l, 'minutes')}
                  </small>
                </span>
                <Price
                  locale={l}
                  total={item.freeTotal}
                  compareTotal={
                    item.compareTotal === undefined
                      ? undefined
                      : item.compareTotal - (item.total - item.freeTotal)
                  }
                  promotionEndsAt={item.promotionEndsAt}
                />
              </Link>
            ))}
          </div>
          <p className="ui-note">{cui(l, 'freeFees')}</p>
        </section>
      )}
      <section>
        <SectionHeading href={browse('shops')} action={cui(l, 'allShops')}>
          {ht(l, 'shopsTitle')}
        </SectionHeading>
        <div className="ui-home-shops">
          {shops.map((card) => (
            <H5ShopCard
              key={card.store.id}
              locale={l}
              card={card}
              href={shopCardHref(l, card, carry)}
            />
          ))}
        </div>
        {!shops.length && (
          <EmptyState href={`/${l}/therapists?view=shops`} action={cui(l, 'clear')}>
            {cui(l, 'noMatch')}
          </EmptyState>
        )}
        <p className="ui-note">{cui(l, 'freeFees')}</p>
      </section>
      <section>
        <SectionHeading href={browse('therapists')} action={cui(l, 'allTherapists')}>
          {cui(l, 'featured')}
        </SectionHeading>
        <p className="ui-note">{cui(l, 'fees')}</p>
        <div className="ui-home-therapists">
          {recommendations?.items.map((item) => (
            <CustomerTherapistCard
              key={item.listing.id}
              locale={l}
              item={item}
              q={q}
              checkedAt={recommendations.checkedAt}
              demo={catalog.demo}
            />
          ))}
        </div>
        {(!recommendations || !recommendations.items.length) && (
          <EmptyState
            href={
              recommendations
                ? `/${l}/therapists?${new URLSearchParams({ ...carry, mode: 'SCHEDULED' })}`
                : browse('therapists')
            }
            action={recommendations ? t(l, 'scheduled') : ht(l, 'retryAction')}
          >
            {recommendations ? cui(l, 'noMatch') : cui(l, 'checkLater')}
          </EmptyState>
        )}
      </section>
      <p className="ui-home-footnote">
        {catalog.demo && ht(l, 'sampleNote')}{' '}
        <Link href={`/${l}/guides/booking-and-safety`}>{t(l, 'safety')} →</Link>
      </p>
    </main>
  );
}
