import { Check, Circle } from 'lucide-react';
import type { Booking, Locale } from '@hogulink/contracts';
import { customerBookingStage } from '@/lib/booking-presentation';
import { vt } from '@/lib/visit-i18n';
import { statusText } from '@/lib/i18n';

export function CustomerOrderProgress({
  locale: l,
  booking,
}: {
  locale: Locale;
  booking: Booking;
}) {
  const stage = customerBookingStage(booking);
  if (stage === null)
    return (
      <p className="customer-order-closed">
        <Circle size={16} />
        {statusText(l, booking.status)} · {vt(l, 'closedOrderHelp')}
      </p>
    );
  return (
    <ol className="customer-order-progress" aria-label={vt(l, 'bookingProgress')}>
      {(
        [
          'progressSubmitted',
          'progressResponse',
          'progressConfirmed',
          'progressService',
          'progressApproval',
          'progressCompleted',
        ] as const
      ).map((key, index) => (
        <li
          key={key}
          className={index < stage ? 'done' : index === stage ? 'current' : ''}
          aria-current={index === stage ? 'step' : undefined}
        >
          <span>{index < stage ? <Check size={14} /> : index + 1}</span>
          <strong>{vt(l, key)}</strong>
        </li>
      ))}
    </ol>
  );
}
