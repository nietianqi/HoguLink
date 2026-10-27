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

/** Cards for every queue this person may work, so a zero means "checked and clear". */
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
      href: links.cases,
      Icon: BookOpen,
      urgent: true,
    });
    cards.push({
      key: 'todoOverdue',
      count: todo.cases.overdue,
      href: links.cases,
      Icon: BookOpen,
      urgent: true,
    });
    cards.push({
      key: 'todoUnassigned',
      count: todo.cases.unassigned,
      href: links.cases,
      Icon: BookOpen,
    });
  }
  if (todo.onboarding !== undefined)
    cards.push({
      key: 'todoOnboarding',
      count: todo.onboarding,
      href: links.review,
      Icon: UserCheck,
    });
  if (todo.venues !== undefined)
    cards.push({ key: 'todoVenues', count: todo.venues, href: links.review, Icon: Store });
  if (todo.aftercare !== undefined)
    cards.push({ key: 'todoAftercare', count: todo.aftercare, href: links.review, Icon: Store });
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
      href: links.finance,
      Icon: FileCheck2,
    });
  }
  // Waiting work first, urgent before routine; clear queues last.
  const rank = (c: Card) => (c.count ? (c.urgent ? 0 : 1) : 2);
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
        <span>{waiting.reduce((n, c) => n + c.count, 0)}</span>
      </div>
      {!waiting.length && (
        <p className="admin-todo-clear">
          <Check size={18} />
          {at(l, 'todoClear')}
        </p>
      )}
      <div className="admin-todo-grid">
        {cards.map(({ key, count, href, Icon, urgent, note }) => (
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
    </section>
  );
}
