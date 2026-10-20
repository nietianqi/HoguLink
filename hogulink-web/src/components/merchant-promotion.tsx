'use client';
import { useState } from 'react';
import { LoaderCircle, TicketPercent } from 'lucide-react';
import {
  PROMOTION_RULES,
  promotionPriceFloor,
  type Locale,
  type Offering,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { money } from '@/lib/i18n';
import { MobileSheet } from './mobile-ui';
import { tokyoPromotionInput as tokyo, promotionFormWindow } from '@/lib/promotion-model';

const copy = {
  title: ['限时价', '期間限定価格', 'Limited price'],
  set: ['设置限时价', '期間限定価格を設定', 'Set limited price'],
  edit: ['修改限时价', '期間限定価格を変更', 'Change limited price'],
  price: ['限时价格（日元）', '期間限定価格（円）', 'Limited price (JPY)'],
  starts: ['开始（东京时间）', '開始（日本時間）', 'Starts (Tokyo time)'],
  ends: ['结束（东京时间）', '終了（日本時間）', 'Ends (Tokyo time)'],
  regular: ['当前原价', '現在の通常価格', 'Current regular price'],
  rules: [
    `最长 ${PROMOTION_RULES.maxDays} 天，${PROMOTION_RULES.maxLeadDays} 天内开始；价格须低于原价且不低于原价的 ${PROMOTION_RULES.minPriceRatio * 100}%。活动期间下单的订单按限时价结算。`,
    `最長${PROMOTION_RULES.maxDays}日間・${PROMOTION_RULES.maxLeadDays}日以内に開始。通常価格未満かつ通常価格の${PROMOTION_RULES.minPriceRatio * 100}%以上。期間中のご予約に適用されます。`,
    `Up to ${PROMOTION_RULES.maxDays} days, starting within ${PROMOTION_RULES.maxLeadDays} days. Below the regular price and at least ${PROMOTION_RULES.minPriceRatio * 100}% of it. Applies to orders placed during the offer.`,
  ],
  compareRule: [
    `只有原价已连续使用 ${PROMOTION_RULES.regularPriceMinDays} 天以上、且近 ${PROMOTION_RULES.lookbackDays} 天优惠天数不超过一半时，前台才显示划线原价（二重価格表示）。`,
    `通常価格を${PROMOTION_RULES.regularPriceMinDays}日以上継続し、直近${PROMOTION_RULES.lookbackDays}日の特価日数が半分以下の場合のみ、通常価格を打ち消し線で表示します（二重価格表示）。`,
    `The regular price is shown struck through only if it has applied for ${PROMOTION_RULES.regularPriceMinDays}+ days and offers ran on at most half of the last ${PROMOTION_RULES.lookbackDays} days.`,
  ],
  live: ['进行中', '実施中', 'Live'],
  scheduled: ['已排期', '予定', 'Scheduled'],
  until: ['至', 'まで', 'until'],
  ELIGIBLE: ['显示划线原价', '通常価格を併記', 'Regular price shown'],
  REGULAR_PRICE_TOO_NEW: [
    '原价不满28天：不显示划线价',
    '通常価格が28日未満：併記なし',
    'Regular price too new: not shown',
  ],
  TOO_MANY_PROMOTION_DAYS: [
    '近期优惠过多：不显示划线价',
    '特価期間が多いため併記なし',
    'Too many offer days: not shown',
  ],
  end: ['结束优惠', '終了する', 'End offer'],
  cancel: ['取消', 'キャンセル', 'Cancel'],
  save: ['保存', '保存', 'Save'],
  conflict: [
    '服务刚被更新，请刷新后再试',
    'サービスが更新されました。再読み込みしてください',
    'This service changed. Refresh and try again.',
  ],
  failed: ['保存失败，请稍后再试', '保存できませんでした', 'Could not save. Try again.'],
} as const;
const ct = (l: Locale, key: keyof typeof copy) => copy[key][l === 'zh-cn' ? 0 : l === 'ja' ? 1 : 2];

const shortDate = (l: Locale, at: number) =>
  new Intl.DateTimeFormat(l, {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);

/** Status line plus editor for one shop service's limited-time price. */
export function MerchantPromotion({
  locale: l,
  offering: o,
  disabled,
  onChanged,
}: {
  locale: Locale;
  offering: Offering;
  disabled?: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const now = Date.now();
  const promo =
    o.promotion && o.promotion.endsAt > now && o.promotion.regularPrice === o.price
      ? o.promotion
      : undefined;
  const eligible =
    o.approved && o.active !== false && o.regulatoryCategory === 'RELAXATION' && o.price >= 1000;
  async function send(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setOpen(false);
      await onChanged();
    } catch (e) {
      setError(
        e instanceof ClientError && e.code === 'INVALID_PROMOTION'
          ? ct(l, 'rules')
          : e instanceof ClientError && e.code === 'VERSION_CONFLICT'
            ? ct(l, 'conflict')
            : ct(l, 'failed'),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="merchant-promotion">
      {promo && (
        <p className="merchant-promotion-status">
          <span className={`merchant-pill ${promo.startsAt > now ? 'muted' : ''}`}>
            {ct(l, promo.startsAt > now ? 'scheduled' : 'live')}
          </span>
          <strong>{money(l, promo.price)}</strong>
          <span>
            {l === 'ja'
              ? `${shortDate(l, promo.endsAt)}${ct(l, 'until')}`
              : `${ct(l, 'until')} ${shortDate(l, promo.endsAt)}`}
          </span>
          <small className={promo.comparisonAllowed ? 'is-ok' : 'is-off'}>
            {ct(l, promo.comparisonReason)}
          </small>
        </p>
      )}
      <button
        type="button"
        className="button secondary small"
        disabled={disabled || !eligible}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <TicketPercent size={14} aria-hidden="true" />
        {ct(l, promo ? 'edit' : 'set')}
      </button>
      <MobileSheet
        className="merchant-dialog"
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        locale={l}
        title={ct(l, 'title')}
      >
        {open && (
          <form
            key={`${o.id}:${o.version}`}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send(() =>
                api(
                  `merchant/services/${o.id}/promotion`,
                  {
                    version: o.version,
                    price: Number(f.get('price')),
                    ...promotionFormWindow(
                      String(f.get('startsAt')),
                      String(f.get('endsAt')),
                      Date.now(),
                    ),
                  },
                  'PUT',
                ),
              );
            }}
          >
            <fieldset disabled={busy}>
              <h3>{o.name[l]}</h3>
              <p>
                {ct(l, 'regular')} {money(l, o.price)}
              </p>
              <label className="field">
                {ct(l, 'price')}
                <input
                  name="price"
                  type="number"
                  inputMode="numeric"
                  min={Math.max(500, promotionPriceFloor(o.price))}
                  max={o.price - 1}
                  step={1}
                  defaultValue={promo?.price ?? Math.round((o.price * 0.85) / 100) * 100}
                  required
                />
              </label>
              <label className="field">
                {ct(l, 'starts')}
                <input
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={tokyo(Math.max(promo?.startsAt ?? now, now))}
                  required
                />
              </label>
              <label className="field">
                {ct(l, 'ends')}
                <input
                  name="endsAt"
                  type="datetime-local"
                  defaultValue={tokyo(promo?.endsAt ?? now + 7 * 86_400_000)}
                  required
                />
              </label>
              <p className="merchant-promotion-help">{ct(l, 'rules')}</p>
              <p className="merchant-promotion-help">{ct(l, 'compareRule')}</p>
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <div className="merchant-dialog-actions">
                {promo ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      void send(() =>
                        api(
                          `merchant/services/${o.id}/promotion`,
                          { version: o.version },
                          'DELETE',
                        ),
                      )
                    }
                  >
                    {ct(l, 'end')}
                  </button>
                ) : (
                  <button type="button" className="button secondary" onClick={() => setOpen(false)}>
                    {ct(l, 'cancel')}
                  </button>
                )}
                <button className="button">
                  {busy ? <LoaderCircle size={17} className="spin" /> : ct(l, 'save')}
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </MobileSheet>
    </div>
  );
}
