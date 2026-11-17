import type { Account } from "../accounts/api";
import { formatKop } from "../accounts/money";
import type { Payment } from "../payments/api";
import { addMonths, diffDays, formatDay, isValidDay, monthEnd, monthStart, monthTitle, parseIso, toIso } from "../payments/dates";
import { effectiveKop } from "../payments/model";

/** Раздел «Бюджет»: чистые расчёты без экрана. Деньги в копейках, дни строками ГГГГ-ММ-ДД. */

export type PeriodKind = "week" | "month" | "quarter" | "year" | "custom";

export interface BudgetPeriod {
  kind: PeriodKind;
  from: string;
  to: string;
}

export const KIND_TITLE: Record<PeriodKind, string> = { week: "Неделя", month: "Месяц", quarter: "Квартал", year: "Год", custom: "Свой" };

/** Самый длинный свой период: пять лет. Дальше график всё равно нечитаем. */
export const MAX_BUDGET_DAYS = 1830;

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function addDays(iso: string, n: number): string {
  const v = parseIso(iso);
  if (!v) return iso;
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + n));
  return toIso({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Понедельник недели, в которую попадает день. */
export function weekStart(iso: string): string {
  const v = parseIso(iso);
  if (!v) return iso;
  const dow = new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay(); // 0 = вс
  return addDays(iso, -((dow + 6) % 7));
}

export function periodFor(kind: Exclude<PeriodKind, "custom">, anchor: string): BudgetPeriod {
  if (kind === "week") {
    const from = weekStart(anchor);
    return { kind, from, to: addDays(from, 6) };
  }
  if (kind === "month") return { kind, from: monthStart(anchor), to: monthEnd(anchor) };
  if (kind === "quarter") {
    const from = addMonths(monthStart(anchor), -((Number(anchor.slice(5, 7)) - 1) % 3));
    return { kind, from, to: monthEnd(addMonths(from, 2)) };
  }
  return { kind, from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
}

/** Шаг вперёд или назад на длину периода. */
export function shiftPeriod(p: BudgetPeriod, dir: 1 | -1): BudgetPeriod {
  if (p.kind === "custom") {
    const len = diffDays(p.from, p.to) + 1;
    return { kind: "custom", from: addDays(p.from, dir * len), to: addDays(p.to, dir * len) };
  }
  if (p.kind === "week") return periodFor("week", addDays(p.from, dir * 7));
  const span = p.kind === "month" ? 1 : p.kind === "quarter" ? 3 : 12;
  return periodFor(p.kind, addMonths(p.from, dir * span));
}

/** «Сегодня»: период того же вида, в который попадает сегодняшний день. Свой период сохраняет длину и начинается сегодня. */
export function periodAround(p: BudgetPeriod, today: string): BudgetPeriod {
  if (p.kind !== "custom") return periodFor(p.kind, today);
  const len = Math.max(1, diffDays(p.from, p.to) + 1);
  return { kind: "custom", from: today, to: addDays(today, len - 1) };
}

export function periodTitle(p: BudgetPeriod): string {
  if (p.kind === "month") return monthTitle(p.from);
  if (p.kind === "year") return p.from.slice(0, 4);
  if (p.kind === "quarter") return `${Math.floor((Number(p.from.slice(5, 7)) - 1) / 3) + 1} квартал ${p.from.slice(0, 4)}`;
  const a = parseIso(p.from);
  const b = parseIso(p.to);
  if (!a || !b) return `${p.from} — ${p.to}`;
  if (p.kind === "week" && a.m === b.m && a.y === b.y) return `${a.d}–${b.d} ${MONTHS_GEN[b.m - 1]} ${b.y}`;
  return `${formatDay(p.from, p.to)} — ${formatDay(p.to, p.from)}`;
}

export function periodError(p: BudgetPeriod): string | null {
  if (!isValidDay(p.from) || !isValidDay(p.to)) return "Введи обе даты целиком";
  const days = diffDays(p.from, p.to) + 1;
  if (days < 1) return "Конец периода раньше начала";
  if (days > MAX_BUDGET_DAYS) return "Свой период не длиннее пяти лет";
  return null;
}

/** Диапазон дат, который нужно загрузить: период плюс всё между ним и датами остатков счетов. */
export function loadRange(accounts: Account[], p: BudgetPeriod): { from: string; to: string } {
  let from = p.from;
  let to = p.to;
  for (const a of counted(accounts)) {
    if (a.balance_on < from) from = a.balance_on;
    if (a.balance_on > to) to = a.balance_on;
  }
  return { from, to };
}

/** Счета, которые идут в график: активные с флажком «в итоге». */
export function counted(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.status === "active" && a.include_in_total);
}

export interface DayPoint {
  date: string;
  /** Баланс на конец дня. */
  balanceKop: number;
  incomeKop: number;
  expenseKop: number;
}

export type Granularity = "day" | "week" | "month";

export interface Bucket {
  from: string;
  to: string;
  /** Индексы первого и последнего дня в `days`. */
  start: number;
  end: number;
  label: string;
  title: string;
  incomeKop: number;
  expenseKop: number;
  /** Баланс на конец последнего дня столбика. */
  balanceKop: number;
}

export interface BudgetData {
  days: DayPoint[];
  buckets: Bucket[];
  granularity: Granularity;
  accountCount: number;
  startKop: number;
  endKop: number;
  incomeKop: number;
  expenseKop: number;
  minKop: number;
  minOn: string;
}

export function granularityFor(p: BudgetPeriod): Granularity {
  const n = diffDays(p.from, p.to) + 1;
  if (p.kind === "week" || p.kind === "month") return "day";
  if (p.kind === "quarter") return "week";
  if (p.kind === "year") return "month";
  return n <= 31 ? "day" : n <= 200 ? "week" : "month";
}

/** Сумма платежа со знаком для баланса: пропущенные не считаются, выполненные по факту, остальные по плану. */
export function signedKop(p: Payment): number {
  if (p.status === "skipped") return 0;
  const v = effectiveKop(p);
  return p.direction === "income" ? v : -v;
}

/**
 * Баланс на конец каждого дня периода по счетам «в итоге».
 * Остаток счёта известен на конец дня `balance_on`; дальше вперёд прибавляем платежи, назад вычитаем.
 * Выполненные платежи берутся по факту, запланированные по плану, пропущенные не учитываются.
 */
export function computeBudget(accounts: Account[], payments: Payment[], p: BudgetPeriod): BudgetData {
  const used = counted(accounts);
  const ids = new Set(used.map((a) => a.id));
  const n = Math.max(0, diffDays(p.from, p.to) + 1);

  const dayIndex = (d: string) => diffDays(p.from, d);
  const income = new Array<number>(n).fill(0);
  const expense = new Array<number>(n).fill(0);
  // дельта по дням для каждого счёта, чтобы считать баланс до начала периода
  const byAccount = new Map<number, Payment[]>();
  for (const pay of payments) {
    if (!ids.has(pay.account_id) || pay.status === "skipped") continue;
    const list = byAccount.get(pay.account_id);
    if (list) list.push(pay);
    else byAccount.set(pay.account_id, [pay]);
    const i = dayIndex(pay.planned_on);
    if (i >= 0 && i < n) {
      if (pay.direction === "income") income[i] += effectiveKop(pay);
      else expense[i] += effectiveKop(pay);
    }
  }

  const dayBefore = addDays(p.from, -1);
  let startKop = 0;
  for (const a of used) {
    let bal = a.opening_balance_kop;
    for (const pay of byAccount.get(a.id) ?? []) {
      const s = signedKop(pay);
      if (dayBefore >= a.balance_on) {
        if (pay.planned_on > a.balance_on && pay.planned_on <= dayBefore) bal += s;
      } else if (pay.planned_on > dayBefore && pay.planned_on <= a.balance_on) {
        bal -= s;
      }
    }
    startKop += bal;
  }

  const days: DayPoint[] = [];
  let bal = startKop;
  for (let i = 0; i < n; i++) {
    bal += income[i] - expense[i];
    days.push({ date: addDays(p.from, i), balanceKop: bal, incomeKop: income[i], expenseKop: expense[i] });
  }

  const buckets = makeBuckets(days, p, granularityFor(p));
  let minKop = days.length ? days[0].balanceKop : startKop;
  let minOn = days.length ? days[0].date : p.from;
  for (const d of days) {
    if (d.balanceKop < minKop) {
      minKop = d.balanceKop;
      minOn = d.date;
    }
  }
  return {
    days,
    buckets,
    granularity: granularityFor(p),
    accountCount: used.length,
    startKop,
    endKop: days.length ? days[days.length - 1].balanceKop : startKop,
    incomeKop: income.reduce((a, b) => a + b, 0),
    expenseKop: expense.reduce((a, b) => a + b, 0),
    minKop,
    minOn,
  };
}

function dayNum(iso: string): number {
  return parseIso(iso)?.d ?? 0;
}

function shortDate(iso: string): string {
  const v = parseIso(iso);
  return v ? `${v.d} ${MONTHS_SHORT[v.m - 1]}` : iso;
}

export function makeBuckets(days: DayPoint[], p: BudgetPeriod, g: Granularity): Bucket[] {
  if (!days.length) return [];
  const keyOf = (d: string) => (g === "day" ? d : g === "week" ? weekStart(d) : d.slice(0, 7));
  const out: Bucket[] = [];
  days.forEach((d, i) => {
    const key = keyOf(d.date);
    const last = out[out.length - 1];
    if (last && (last as Bucket & { key?: string }).key === key) {
      last.to = d.date;
      last.end = i;
      last.incomeKop += d.incomeKop;
      last.expenseKop += d.expenseKop;
      last.balanceKop = d.balanceKop;
    } else {
      const b: Bucket & { key?: string } = { from: d.date, to: d.date, start: i, end: i, label: "", title: "", incomeKop: d.incomeKop, expenseKop: d.expenseKop, balanceKop: d.balanceKop, key };
      out.push(b);
    }
  });
  for (const b of out) {
    delete (b as Bucket & { key?: string }).key;
    if (g === "day") {
      b.label = String(dayNum(b.from));
      b.title = formatDay(b.from, p.to);
    } else if (g === "week") {
      b.label = shortDate(b.from);
      b.title = b.from === b.to ? formatDay(b.from, p.to) : `${shortDate(b.from)} — ${shortDate(b.to)}`;
    } else {
      const m = Number(b.from.slice(5, 7));
      b.label = MONTHS_SHORT[m - 1];
      b.title = monthTitle(b.from);
    }
  }
  return out;
}

/** Круглые значения для сетки по оси: от min до max включительно, примерно `count` штук. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) {
    const v = Number.isFinite(min) ? min : 0;
    return [v - 100, v, v + 100].map((x) => Math.round(x));
  }
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.0001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round(ticks[ticks.length - 1] + step));
  return ticks;
}

/** Короткая подпись для оси: «1,2 млн», «350 тыс.», «800». Входное значение в копейках. */
export function compactKop(kop: number): string {
  const rub = Math.round(kop / 100);
  const abs = Math.abs(rub);
  const sign = rub < 0 ? "−" : "";
  const fmt = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
  if (abs >= 1_000_000) return `${sign}${fmt(abs / 1_000_000)} млн`;
  if (abs >= 10_000) return `${sign}${fmt(abs / 1000)} тыс.`;
  return sign + formatKop(abs * 100).replace(/\s?₽$/, "");
}

/** Гладкая линия через точки без «выбросов» за пределы данных (монотонная кубическая интерполяция). */
export function smoothPath(pts: Array<[number, number]>): string {
  const n = pts.length;
  if (n === 0) return "";
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  if (n === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}`;
  if (n === 2) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;
  const dx: number[] = [];
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    sl.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = sl[0];
  m[n - 1] = sl[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / sl[i];
    const b = m[i + 1] / sl[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * sl[i]) / h;
      m[i + 1] = (3 * b * sl[i]) / h;
    }
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i][0] + dx[i] / 3;
    const y1 = pts[i][1] + (m[i] * dx[i]) / 3;
    const x2 = pts[i + 1][0] - dx[i] / 3;
    const y2 = pts[i + 1][1] - (m[i + 1] * dx[i]) / 3;
    d += `C${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`;
  }
  return d;
}
