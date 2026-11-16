import type { Iterations } from "./manifest.js";

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const DAY = 86_400_000;

/** A positive whole number of calendar days, or null for an invalid duration. */
export function durationDays(duration: string): number | null {
  const match = /^([1-9]\d*) (days?|weeks?)$/.exec(duration);
  if (!match) return null;
  const days = Number(match[1]) * (match[2]!.startsWith("week") ? 7 : 1);
  return Number.isSafeInteger(days) ? days : null;
}

/** Rejects normalized impossible dates, such as February 30, as well as non-ISO spellings. */
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

/** Inclusive calendar windows; demo is the last matching weekday, or the end if none fits. */
export function iterationDates(iterations: Iterations, today: string) {
  const days = durationDays(iterations.duration)!;
  const first = Date.parse(`${iterations.start_date}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const index = Math.max(0, Math.floor((now - first) / DAY / days));
  const start = first + index * days * DAY;
  const end = start + (days - 1) * DAY;
  const back = (new Date(end).getUTCDay() - (WEEKDAYS.indexOf(iterations.demo_day) + 1) + 7) % 7;
  const last = end - back * DAY;
  const demo = last < start ? end : last;
  const date = (ms: number) => new Date(ms).toISOString().replace(/T.*$/, "");
  return {
    number: index + 1,
    start: date(start),
    end: date(end),
    daysToDemo: (demo - now) / DAY,
  };
}
