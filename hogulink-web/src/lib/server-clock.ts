export type ServerClock = { serverNow: number; sampledAt: number };

/** elapsedNow is monotonic (performance.now), so changing the device clock cannot move it. */
export function serverClockNow(clock: ServerClock, elapsedNow: number) {
  return clock.serverNow + Math.max(0, elapsedNow - clock.sampledAt);
}
