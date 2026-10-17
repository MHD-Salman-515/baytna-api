import { DateTime } from 'luxon';

/**
 * Whether `now` falls inside the [startTime, endTime) window, both "HH:mm"
 * in `timezone` (the user's country timezone — never server local time,
 * same discipline as worker availability windows). Handles the overnight
 * case (e.g. 22:00-07:00) by checking whether the window wraps midnight.
 */
export function isWithinQuietHours(
  startTime: string,
  endTime: string,
  timezone: string,
  now: Date = new Date(),
): boolean {
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const nowMinutes = local.hour * 60 + local.minute;
  const startMinutes = toMinutes(startTime);
  const endMinutes = toMinutes(endTime);

  if (startMinutes === endMinutes) {
    return false; // a zero-length window suppresses nothing
  }

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  // Wraps midnight, e.g. 22:00-07:00: "inside" means >= 22:00 OR < 07:00.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}
