// IANA tzdb 2026c: Morocco returned to UTC at 02:00 local on 2026-09-20.
// Keep business reports consistent on runtimes that still ship older ICU data.
// https://data.iana.org/time-zones/tzdb/africa
const permanentUtcSince = Date.parse('2026-09-20T01:00:00Z');
const businessZone = (date: Date) =>
  date.getTime() >= permanentUtcSince ? 'UTC' : 'Africa/Casablanca';
export function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: businessZone(date),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function businessStart(day: string) {
  const date = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day)
    throw new Error('Invalid date');
  const zone =
    new Intl.DateTimeFormat('en', { timeZone: businessZone(date), timeZoneName: 'shortOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const match = zone.match(/^GMT([+-])(\d+)(?::(\d+))?$/);
  const minutes = match
    ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0))
    : 0;
  return new Date(date.getTime() - minutes * 60000).toISOString();
}
export function nextDay(day: string) {
  return new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
}
