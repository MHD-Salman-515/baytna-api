import { subtractBusyIntervals } from './subtract-busy-intervals';

function iso(s: string): Date {
  return new Date(s);
}

describe('subtractBusyIntervals', () => {
  const window = { start: iso('2026-11-02T06:00:00Z'), end: iso('2026-11-02T14:00:00Z') };

  it('returns the window unchanged when there is no busy interval', () => {
    expect(subtractBusyIntervals([window], [])).toEqual([window]);
  });

  it('removes the window entirely when busy fully covers it', () => {
    const busy = { start: iso('2026-11-02T05:00:00Z'), end: iso('2026-11-02T15:00:00Z') };
    expect(subtractBusyIntervals([window], [busy])).toEqual([]);
  });

  it('trims the front of the window when busy overlaps the start', () => {
    const busy = { start: iso('2026-11-02T05:00:00Z'), end: iso('2026-11-02T09:00:00Z') };
    expect(subtractBusyIntervals([window], [busy])).toEqual([
      { start: iso('2026-11-02T09:00:00Z'), end: iso('2026-11-02T14:00:00Z') },
    ]);
  });

  it('trims the end of the window when busy overlaps the end', () => {
    const busy = { start: iso('2026-11-02T12:00:00Z'), end: iso('2026-11-02T15:00:00Z') };
    expect(subtractBusyIntervals([window], [busy])).toEqual([
      { start: iso('2026-11-02T06:00:00Z'), end: iso('2026-11-02T12:00:00Z') },
    ]);
  });

  it('splits the window into two when busy sits entirely inside it', () => {
    const busy = { start: iso('2026-11-02T09:00:00Z'), end: iso('2026-11-02T10:00:00Z') };
    expect(subtractBusyIntervals([window], [busy])).toEqual([
      { start: iso('2026-11-02T06:00:00Z'), end: iso('2026-11-02T09:00:00Z') },
      { start: iso('2026-11-02T10:00:00Z'), end: iso('2026-11-02T14:00:00Z') },
    ]);
  });

  it('leaves the window untouched when busy sits entirely outside it (touching edges excluded)', () => {
    const busyBefore = { start: iso('2026-11-02T04:00:00Z'), end: iso('2026-11-02T06:00:00Z') };
    const busyAfter = { start: iso('2026-11-02T14:00:00Z'), end: iso('2026-11-02T16:00:00Z') };
    expect(subtractBusyIntervals([window], [busyBefore, busyAfter])).toEqual([window]);
  });

  it('applies multiple busy intervals cumulatively, sorted by start time', () => {
    const busy1 = { start: iso('2026-11-02T07:00:00Z'), end: iso('2026-11-02T08:00:00Z') };
    const busy2 = { start: iso('2026-11-02T11:00:00Z'), end: iso('2026-11-02T12:00:00Z') };
    expect(subtractBusyIntervals([window], [busy1, busy2])).toEqual([
      { start: iso('2026-11-02T06:00:00Z'), end: iso('2026-11-02T07:00:00Z') },
      { start: iso('2026-11-02T08:00:00Z'), end: iso('2026-11-02T11:00:00Z') },
      { start: iso('2026-11-02T12:00:00Z'), end: iso('2026-11-02T14:00:00Z') },
    ]);
  });

  it('handles multiple independent windows', () => {
    const morning = { start: iso('2026-11-02T06:00:00Z'), end: iso('2026-11-02T10:00:00Z') };
    const evening = { start: iso('2026-11-02T16:00:00Z'), end: iso('2026-11-02T20:00:00Z') };
    const busy = { start: iso('2026-11-02T17:00:00Z'), end: iso('2026-11-02T18:00:00Z') };
    expect(subtractBusyIntervals([morning, evening], [busy])).toEqual([
      morning,
      { start: iso('2026-11-02T16:00:00Z'), end: iso('2026-11-02T17:00:00Z') },
      { start: iso('2026-11-02T18:00:00Z'), end: iso('2026-11-02T20:00:00Z') },
    ]);
  });
});
