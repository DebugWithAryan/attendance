import { config } from '../config/index.js';

/**
 * The college day, not the server's day.
 *
 * toISOString() would put a 9am class in Kolkata on the previous date whenever
 * the server runs in UTC and the clock is past midnight IST, so every "today"
 * in this system is resolved in the college's own timezone.
 */
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const todayIso = (at = new Date()) => formatter.format(at);

/** ISO weekday 1..7 (Mon..Sun). The college week is 1..6; Sunday has no classes. */
export const isoDayOfWeek = (dateStr) => {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`not a YYYY-MM-DD date: ${dateStr}`);
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
};

export const addDays = (dateStr, n) => {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
