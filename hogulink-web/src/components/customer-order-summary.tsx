import type { Booking, Locale } from '@hogulink/contracts';
import { CalendarDays, MapPin, MessageCircle, ArrowRight, UserRound } from 'lucide-react';
import { pc } from '@/lib/pc-consumer-i18n';
import { customerNextStep } from '@/lib/customer-order-model';
import { areaName, dateTime, t } from '@/lib/i18n';
import { visitTimeRange } from '@/lib/booking-presentation';
import { sv } from '@/lib/service-mode-i18n';

export function CustomerOrderSummary({
  locale: l,
  booking: b,
  storeName,
  therapistName,
}: {
  locale: Locale;
  booking: Booking;
  storeName: string;
  therapistName: string;
}) {
  const next = customerNextStep(b);
  const inStore = b.quote.fulfillmentMode === 'IN_STORE';
  const place = inStore
    ? b.quote.venue?.address
    : [b.address?.hotelName, b.address?.detail].filter(Boolean).join(' · ');
  return (
    <section className="customer-state-card" aria-label={pc(l, 'nextStep')}>
      <div className="customer-state-copy">
        <span className="service-mode-tag">{sv(l, inStore ? 'IN_STORE' : 'HOME_VISIT')}</span>
        <h2>
          {b.quote.serviceName?.[l] ?? t(l, 'services')} ·{' '}
          {(b.quote.endAt - b.quote.startAt) / 60000} {t(l, 'minutes')}
        </h2>
        <p className="customer-state-shop">{storeName}</p>
        <p className="customer-state-message">{pc(l, next.key)}</p>
        {next.deadline && (
          <p className="customer-state-deadline">
            {pc(l, 'respondBy')} · {dateTime(l, next.deadline)} JST
          </p>
        )}
      </div>
      <dl className="customer-state-facts">
        <div>
          <dt>
            <UserRound size={16} />
            {pc(l, 'therapist')}
          </dt>
          <dd>{therapistName}</dd>
        </div>
        <div>
          <dt>
            <CalendarDays size={16} />
            {t(l, 'start')}
          </dt>
          <dd>{visitTimeRange(l, b.quote.startAt, b.quote.endAt)}</dd>
        </div>
        <div>
          <dt>
            <MapPin size={16} />
            {inStore ? sv(l, 'venue') : t(l, 'area')}
          </dt>
          <dd>{place || areaName(l, b.quote.area)}</dd>
        </div>
      </dl>
      <div className="customer-state-actions">
        <a className="button" href={next.target}>
          {pc(l, next.action)}
          <ArrowRight size={16} />
        </a>
        <a
          className="button secondary"
          href={`#order-messages-${b.id}`}
          onClick={() => {
            const panel = document.getElementById(`order-messages-${b.id}`);
            if (panel instanceof HTMLDetailsElement) panel.open = true;
          }}
        >
          <MessageCircle size={16} />
          {pc(l, 'contact')}
        </a>
      </div>
    </section>
  );
}
