import { mergePromotionWindows, type Offering } from '@hogulink/contracts';

/** Keep all elapsed discount time needed by the comparison look-back, regardless of edit count. */
export function closedPromotionHistory(service: Offering | undefined, now: number) {
  const history = [...(service?.promotionHistory ?? [])];
  if (service?.promotion) history.push(service.promotion);
  return mergePromotionWindows(history, now - 120 * 86_400_000, now);
}
