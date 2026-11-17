/** Календарные дни без часовых поясов: строки ГГГГ-ММ-ДД. Всё считается в UTC, чтобы летнее время не сдвигало дни. */

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** Дни недели в формате RRULE, по порядку от понедельника. */
export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export const WEEKDAY_SHORT_RU: Record<string, string> = { MO: "пн", TU: "вт", WE: "ср", TH: "чт", FR: "пт", SA: "сб", SU: "вс" };

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function toIso({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${p2(m)}-${p2(d)}`;
}

/** Разбирает «ГГГГ-ММ-ДД»; null, если строка не настоящая дата (например 2026-02-30). */
export function parseIso(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const v = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d));
  return t.getUTCFullYear() === v.y && t.getUTCMonth() === v.m - 1 && t.getUTCDate() === v.d ? v : null;
}

export function isValidDay(s: string): boolean {
  return parseIso(s) !== null;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Число дней между двумя датами (to минус from). */
export function diffDays(from: string, to: string): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** Сдвиг по месяцам с прижатием дня к концу месяца: 31 января + 1 месяц = 28 (29) февраля. */
export function addMonths(iso: string, n: number): string {
  const v = parseIso(iso);
  if (!v) return iso;
  const idx = v.y * 12 + (v.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return toIso({ y, m, d: Math.min(v.d, daysInMonth(y, m)) });
}

export function monthStart(iso: string): string {
  const v = parseIso(iso);
  return v ? toIso({ ...v, d: 1 }) : iso;
}

export function monthEnd(iso: string): string {
  const v = parseIso(iso);
  return v ? toIso({ ...v, d: daysInMonth(v.y, v.m) }) : iso;
}

/** День недели в формате RRULE («MO»…«SU») или null. */
export function weekdayCode(iso: string): string | null {
  const v = parseIso(iso);
  if (!v) return null;
  const dow = new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();
  return WEEKDAY_CODES[(dow + 6) % 7];
}

/** «Ноябрь 2026» из «2026-11» или любой даты этого месяца. */
export function monthTitle(isoOrMonth: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoOrMonth);
  if (!m) return isoOrMonth;
  const name = MONTHS[Number(m[2]) - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${m[1]}`;
}

/** «15 ноября, вс»; год добавляется, если он не совпадает с годом из `relativeTo`. */
export function formatDay(iso: string, relativeTo?: string): string {
  const v = parseIso(iso);
  if (!v) return iso;
  const dow = WEEKDAYS_SHORT[new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay()];
  const ref = relativeTo ? parseIso(relativeTo) : null;
  const year = ref && ref.y !== v.y ? ` ${v.y}` : "";
  return `${v.d} ${MONTHS_GEN[v.m - 1]}${year}, ${dow}`;
}

/** «15 ноября 2026» без дня недели. */
export function formatDayLong(iso: string): string {
  const v = parseIso(iso);
  return v ? `${v.d} ${MONTHS_GEN[v.m - 1]} ${v.y}` : iso;
}

/** Календарный день сегодня у пользователя. */
export function today(d: Date = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
