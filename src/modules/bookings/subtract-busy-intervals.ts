export interface TimeInterval {
  start: Date;
  end: Date;
}

/**
 * Subtracts every interval in `busy` from `windows`, returning the disjoint
 * free remainder, sorted by start time. Pure interval arithmetic — used by
 * BookingsService.getFreeSlots to turn "available windows" into "available
 * windows minus her existing bookings (expanded by the travel buffer)".
 */
export function subtractBusyIntervals(
  windows: TimeInterval[],
  busy: TimeInterval[],
): TimeInterval[] {
  let free: TimeInterval[] = windows.map((w) => ({ start: w.start, end: w.end }));

  for (const b of busy) {
    const next: TimeInterval[] = [];
    for (const w of free) {
      const noOverlap =
        b.end.getTime() <= w.start.getTime() || b.start.getTime() >= w.end.getTime();
      if (noOverlap) {
        next.push(w);
        continue;
      }
      if (b.start.getTime() > w.start.getTime()) {
        next.push({ start: w.start, end: new Date(Math.min(b.start.getTime(), w.end.getTime())) });
      }
      if (b.end.getTime() < w.end.getTime()) {
        next.push({ start: new Date(Math.max(b.end.getTime(), w.start.getTime())), end: w.end });
      }
    }
    free = next.filter((segment) => segment.end.getTime() > segment.start.getTime());
  }

  return free.sort((a, b) => a.start.getTime() - b.start.getTime());
}
