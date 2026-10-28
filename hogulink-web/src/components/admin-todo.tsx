'use client';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  FileCheck2,
  Landmark,
  MessageSquareWarning,
  ShieldAlert,
  Siren,
  Store,
  Star,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import type { AdminTodo, Locale } from '@hogulink/contracts';
import { at, type AdminKey } from '@/lib/admin-i18n';
import { ot } from '@/lib/admin-operations-i18n';

type Card = {
  key: AdminKey;
  count: number;
  href: string;
  Icon: LucideIcon;
  urgent?: boolean;
  note?: string;
};
export type TodoLinks = {
  safety: string;
  orders: string;
  cases: string;
  review: string;
  quality: string;
  content: string;
  finance: string;
};

const destination = (href: string, key: string, value: string) => {
  const [path, hash] = href.split('#');
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${value}${hash ? `#${hash}` : ''}`;
};
/** Counts describe individual queues; one business item may be in several queues. */
export function todoCards(l: Locale, todo: AdminTodo, links: TodoLinks): Card[] {
  const cards: Card[] = [];
  if (todo.safetyEvents !== undefined)
    cards.push({
      key: 'todoSafety',
      count: todo.safetyEvents,
      href: links.safety,
      Icon: Siren,
      urgent: true,
    });
  if (todo.orderAlerts)
    cards.push({
      key: 'todoAlerts',
      count: todo.orderAlerts.open,
      href: links.orders,
      Icon: ShieldAlert,
      urgent: todo.orderAlerts.high > 0,
      note: todo.orderAlerts.high ? `${at(l, 'highShort')} ${todo.orderAlerts.high}` : undefined,
    });
  if (todo.cases) {
    cards.push({
      key: 'todoEscalated',
      count: todo.cases.escalated,
      href: destination(links.cases, 'queue', 'escalated'),
      Icon: BookOpen,
      urgent: true,
    });
    cards.push({
      key: 'todoOverdue',
      count: todo.cases.overdue,
      href: destination(links.cases, 'queue', 'overdue'),
      Icon: BookOpen,
      urgent: true,
    });
    cards.push({
      key: 'todoUnassigned',
      count: todo.cases.unassigned,
      href: destination(links.cases, 'queue', 'unassigned'),
      Icon: BookOpen,
    });
  }
  if (todo.onboarding !== undefined)
    cards.push({
      key: 'todoOnboarding',
      count: todo.onboarding,
      href: destination(links.review, 'section', 'qualification'),
      Icon: UserCheck,
    });
  if (todo.venues !== undefined)
    cards.push({
      key: 'todoVenues',
      count: todo.venues,
      href: destination(links.review, 'section', 'venues'),
      Icon: Store,
    });
  if (todo.storefronts !== undefined)
    cards.push({
      key: 'todoStorefronts',
      count: todo.storefronts,
      href: destination(links.review, 'section', 'storefront'),
      Icon: Store,
    });
  if (todo.services !== undefined)
    cards.push({
      key: 'todoServices',
      count: todo.services,
      href: destination(links.review, 'section', 'services'),
      Icon: FileCheck2,
    });
  if (todo.media !== undefined)
    cards.push({
      key: 'todoMedia',
      count: todo.media,
      href: destination(links.review, 'section', 'media'),
      Icon: UserCheck,
    });
  if (todo.aftercare !== undefined)
    cards.push({
      key: 'todoAftercare',
      count: todo.aftercare,
      href: destination(links.review, 'section', 'aftercare'),
      Icon: Store,
    });
  if (todo.experience !== undefined)
    cards.push({ key: 'todoExperience', count: todo.experience, href: links.quality, Icon: Star });
  if (todo.contentReviews !== undefined)
    cards.push({
      key: 'todoContent',
      count: todo.contentReviews,
      href: links.content,
      Icon: MessageSquareWarning,
    });
  if (todo.finance) {
    cards.push({
      key: 'todoReconcile',
      count: todo.finance.unmatched,
      href: links.finance,
      Icon: Landmark,
    });
    cards.push({
      key: 'todoInvoices',
      count: todo.finance.invoices,
      href: destination(links.finance, 'section', 'invoices'),
      Icon: FileCheck2,
    });
  }
  // Waiting work first, urgent before routine; clear queues last.
  const rank = (c: Card) => (c.count ? (c.key === 'todoSafety' ? -1 : c.urgent ? 0 : 1) : 2);
  return cards.sort((a, b) => rank(a) - rank(b) || b.count - a.count);
}

export function AdminTodoBoard({
  locale: l,
  todo,
  links,
}: {
  locale: Locale;
  todo?: AdminTodo;
  links: TodoLinks;
}) {
  if (!todo) return null;
  const cards = todoCards(l, todo, links);
  const waiting = cards.filter((c) => c.count > 0);
  return (
    <section className="admin-panel admin-todo" aria-labelledby="admin-todo-title">
      <div className="admin-panel-heading">
        <div>
          <h2 id="admin-todo-title">{at(l, 'todoTitle')}</h2>
          <p>{at(l, 'todoHelp')}</p>
        </div>
        <span>
          {waiting.length} {ot(l, 'queueCount')}
        </span>
      </div>
      {!waiting.length && (
        <p className="admin-todo-clear">
          <Check size={18} />
          {at(l, 'todoClear')}
        </p>
      )}
      <div className="admin-todo-grid">
        {waiting.map(({ key, count, href, Icon, urgent, note }) => (
          <Link
            key={key}
            href={href}
            className={`admin-todo-card ${count ? (urgent ? 'urgent' : 'waiting') : 'clear'}`}
          >
            <Icon size={18} aria-hidden="true" />
            <strong>{count}</strong>
            <span>
              {at(l, key)}
              {count > 0 && urgent && <em>{at(l, 'urgent')}</em>}
            </span>
            {note && <small>{note}</small>}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        ))}
      </div>
      <p className="admin-footnote">{ot(l, 'queueNote')}</p>
      {cards.some((c) => !c.count) && (
        <details className="admin-clear-queues">
          <summary>
            {ot(l, 'clearQueues')} · {cards.length - waiting.length}
          </summary>
          <div className="admin-todo-grid">
            {cards
              .filter((c) => !c.count)
              .map(({ key, href, Icon }) => (
                <Link className="admin-todo-card clear" href={href} key={key}>
                  <Icon size={18} />
                  <strong>0</strong>
                  <span>{at(l, key)}</span>
                </Link>
              ))}
          </div>
        </details>
      )}
    </section>
  );
}
