/** datetime-local is a Tokyo wall time, independent of the browser's time zone. */
export const tokyoPromotionInput = (at: number) =>
  new Date(at + 9 * 3_600_000).toISOString().slice(0, 16);
export const parseTokyoPromotionInput = (value: string) => Date.parse(`${value}:00+09:00`);

/** Match the form's minute precision and the server's one-minute start grace. */
export function promotionFormWindow(start: string, end: string, now: number) {
  return {
    startsAt: Math.max(parseTokyoPromotionInput(start), Math.floor(now / 60000) * 60000),
    endsAt: parseTokyoPromotionInput(end),
  };
}
