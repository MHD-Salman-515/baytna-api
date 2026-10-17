import { isWithinQuietHours } from './quiet-hours';

const TZ = 'Asia/Damascus'; // UTC+3, no DST

function damascusTime(hour: number, minute: number): Date {
  // 2026-11-02T00:00 Damascus == 2026-11-01T21:00 UTC (UTC+3).
  return new Date(Date.UTC(2026, 10, 1, hour - 3 < 0 ? hour - 3 + 24 : hour - 3, minute));
}

describe('isWithinQuietHours', () => {
  describe('an overnight window (22:00-07:00)', () => {
    it('is within quiet hours at 23:00', () => {
      expect(isWithinQuietHours('22:00', '07:00', TZ, damascusTime(23, 0))).toBe(true);
    });

    it('is within quiet hours at 03:00 (past midnight)', () => {
      expect(isWithinQuietHours('22:00', '07:00', TZ, damascusTime(3, 0))).toBe(true);
    });

    it('is exactly at the start boundary -> inside', () => {
      expect(isWithinQuietHours('22:00', '07:00', TZ, damascusTime(22, 0))).toBe(true);
    });

    it('is exactly at the end boundary -> outside (end is exclusive)', () => {
      expect(isWithinQuietHours('22:00', '07:00', TZ, damascusTime(7, 0))).toBe(false);
    });

    it('is outside quiet hours at midday', () => {
      expect(isWithinQuietHours('22:00', '07:00', TZ, damascusTime(13, 0))).toBe(false);
    });
  });

  describe('a same-day window (09:00-17:00)', () => {
    it('is within quiet hours at noon', () => {
      expect(isWithinQuietHours('09:00', '17:00', TZ, damascusTime(12, 0))).toBe(true);
    });

    it('is outside quiet hours in the evening', () => {
      expect(isWithinQuietHours('09:00', '17:00', TZ, damascusTime(20, 0))).toBe(false);
    });
  });

  it('a zero-length window (start === end) never suppresses anything', () => {
    expect(isWithinQuietHours('22:00', '22:00', TZ, damascusTime(22, 0))).toBe(false);
  });

  it('uses the given timezone, not server local time', () => {
    // 22:00 Damascus (UTC+3) is 19:00 UTC — asserting the UTC instant alone
    // would get this backwards if the function ignored the timezone argument.
    const nineteenUtc = new Date('2026-11-01T19:00:00.000Z');
    expect(isWithinQuietHours('22:00', '07:00', TZ, nineteenUtc)).toBe(true);
  });
});
