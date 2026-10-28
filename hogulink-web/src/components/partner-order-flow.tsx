import type { ReactNode } from 'react';
import { ArrowDownRight, CalendarDays, MapPin } from 'lucide-react';
import type { Booking, Locale } from '@hogulink/contracts';
import { areaName, dateTime, t } from '@/lib/i18n';
import { nextWork, workOrderStage } from '@/lib/coordination-model';
import { ot } from '@/lib/coordination-i18n';
import { pf } from '@/lib/partner-flow-i18n';
import { ar } from '@/lib/acceptance-i18n';
import { sv } from '@/lib/service-mode-i18n';

export function OrderQueueDisclosure({
  locale,
  focused,
  children,
}: {
  locale: Locale;
  focused: boolean;
  children: ReactNode;
}) {
  return focused ? (
    <details className="partner-queue-disclosure">
      <summary>
        {pf(locale, 'switchOrder')}
        <ArrowDownRight size={17} />
      </summary>
      {children}
    </details>
  ) : (
    children
  );
}

export function PartnerOrderFlow({
  locale: l,
  booking: b,
  role,
}: {
  locale: Locale;
  booking: Booking;
  role: 'MERCHANT' | 'STAFF';
}) {
  const stage = workOrderStage(b),
    next = nextWork(b);
  const steps = ['receive', 'confirm', 'visit', 'approval', 'finished'] as const;
  const targets =
    role === 'MERCHANT'
      ? ([
          ['dispatch', `dispatch-${b.id}`],
          ['overview', `order-overview-${b.id}`],
          ['cooperation', `cooperation-${b.id}`],
        ] as const)
      : ([
          ['fulfillment', `fulfillment-${b.id}`],
          ['cooperation', `cooperation-${b.id}`],
          ['contact', `contact-${b.id}`],
        ] as const);
  return (
    <>
      <header className="partner-order-hero">
        <span className="partner-order-eyebrow">
          {sv(l, b.quote.fulfillmentMode ?? 'HOME_VISIT')}
        </span>
        <h2>{b.quote.serviceName?.[l] ?? pf(l, 'service')}</h2>
        <div className="partner-order-meta">
          <span>
            <CalendarDays size={16} />
            {dateTime(l, b.quote.startAt)} JST
          </span>
          <span>
            {Math.round((b.quote.endAt - b.quote.startAt) / 60000)} {t(l, 'minutes')}
          </span>
          <span>
            <MapPin size={16} />
            {areaName(l, b.quote.area)}
          </span>
        </div>
        <div className="partner-order-next">
          <span>{pf(l, 'current')}</span>
          <strong>
            {stage === null
              ? pf(l, 'cancelled')
              : b.quote.fulfillmentMode === 'IN_STORE' && next === 'visit'
                ? sv(l, b.checkIn ? 'readyToStart' : 'waitCheckIn')
                : ot(l, next)}
          </strong>
        </div>
        {stage !== null && (
          <ol className="partner-order-progress" aria-label={pf(l, 'journey')}>
            {steps.map((step, i) => (
              <li
                key={step}
                className={i < stage ? 'done' : i === stage ? 'current' : ''}
                aria-current={i === stage ? 'step' : undefined}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                <strong>
                  {step === 'visit' && b.quote.fulfillmentMode === 'IN_STORE'
                    ? sv(l, 'IN_STORE')
                    : pf(l, step)}
                </strong>
              </li>
            ))}
          </ol>
        )}
        {!['visit', 'closed', 'completionPending', 'completionReview'].includes(next) && (
          <p className="partner-order-deadline">
            {ot(l, 'deadline')} ·{' '}
            {dateTime(
              l,
              b.replacementConsent === 'PENDING'
                ? (b.replacementDeadline ?? b.deadline)
                : b.deadline,
            )}{' '}
            JST
          </p>
        )}
      </header>
      {role === 'MERCHANT' && b.acceptanceDecision && (
        <aside className="acceptance-order-note">
          <strong>
            {ar(l, b.acceptanceDecision.outcome === 'AUTO_ACCEPTED' ? 'automatic' : 'manual')}
          </strong>
          <span>
            {ar(l, b.acceptanceDecision.reason)}
            {b.acceptanceDecision.rule
              ? ` · ${ar(l, 'rule')} v${b.acceptanceDecision.rule.version}`
              : ''}
          </span>
        </aside>
      )}
      <nav className="partner-section-nav" aria-label={pf(l, 'journey')}>
        {targets.map(([key, id]) => (
          <a href={`#${id}`} key={id}>
            {pf(l, key)}
            <ArrowDownRight size={14} />
          </a>
        ))}
      </nav>
    </>
  );
}
