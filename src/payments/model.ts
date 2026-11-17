import { formatKop } from "../accounts/money";
import type { MonthTotals, Payment, PaymentStatus, RecurrenceInfo } from "./api";
import { WEEKDAY_CODES, WEEKDAY_SHORT_RU } from "./dates";

/** Сумма платежа с учётом факта: у выполненного это фактическая сумма, если её ввели. */
export function effectiveKop(p: Payment): number {
  return p.status === "completed" && p.actual_amount_kop !== null ? p.actual_amount_kop : p.amount_kop;
}

/** Сумма со знаком для показа: поступление +, списание −. Знак пишется всегда. */
export function signedAmount(p: Payment): string {
  return (p.direction === "income" ? "+" : "−") + formatKop(Math.abs(effectiveKop(p)));
}

export interface Net {
  incomeKop: number;
  expenseKop: number;
  /** Поступления минус списания. */
  netKop: number;
}

/** Итог месяца: выполненные по факту плюс ещё не выполненные по плану; пропущенные не считаются. */
export function monthNet(t: MonthTotals): Net {
  const incomeKop = t.planned_income_kop + t.completed_income_kop;
  const expenseKop = t.planned_expense_kop + t.completed_expense_kop;
  return { incomeKop, expenseKop, netKop: incomeKop - expenseKop };
}

export function sumNet(list: MonthTotals[]): Net {
  const acc = list.map(monthNet).reduce(
    (a, n) => ({ incomeKop: a.incomeKop + n.incomeKop, expenseKop: a.expenseKop + n.expenseKop, netKop: 0 }),
    { incomeKop: 0, expenseKop: 0, netKop: 0 },
  );
  return { ...acc, netKop: acc.incomeKop - acc.expenseKop };
}

/** Знаковая сумма итога: «+12 000 ₽», «−3 400 ₽», «0 ₽». */
export function signedKop(kop: number): string {
  if (kop === 0) return formatKop(0);
  return (kop > 0 ? "+" : "−") + formatKop(Math.abs(kop));
}

export function statusTitle(s: PaymentStatus): string {
  return s === "completed" ? "Выполнен" : s === "skipped" ? "Пропущен" : "Запланирован";
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function paymentsWord(n: number): string {
  return `${n} ${plural(n, "платёж", "платежа", "платежей")}`;
}

/** Просрочен: ещё не выполнен и не пропущен, а дата уже прошла. */
export function isOverdue(p: Payment, today: string): boolean {
  return p.status === "planned" && p.planned_on < today;
}

/** Короткое описание правила для чипа: «Каждую неделю: пн, чт», «Каждые 2 месяца: 5, 20 числа». */
export function describeRule(r: Pick<RecurrenceInfo, "frequency" | "interval" | "weekdays" | "month_days">): string {
  const n = r.interval;
  if (r.frequency === "daily") return n === 1 ? "Каждый день" : `Каждые ${n} ${plural(n, "день", "дня", "дней")}`;
  if (r.frequency === "weekly") {
    const head = n === 1 ? "Каждую неделю" : `Каждые ${n} ${plural(n, "неделю", "недели", "недель")}`;
    const days = [...r.weekdays].sort((a, b) => WEEKDAY_CODES.indexOf(a as never) - WEEKDAY_CODES.indexOf(b as never));
    return days.length ? `${head}: ${days.map((d) => WEEKDAY_SHORT_RU[d] ?? d).join(", ")}` : head;
  }
  if (r.frequency === "monthly") {
    const head = n === 1 ? "Каждый месяц" : `Каждые ${n} ${plural(n, "месяц", "месяца", "месяцев")}`;
    const days = r.month_days.map((d) => (d === -1 ? "последний день" : String(d)));
    if (!days.length) return head;
    const last = r.month_days.length === 1 && r.month_days[0] === -1;
    return `${head}: ${days.join(", ")}${last ? "" : " числа"}`;
  }
  return n === 1 ? "Каждый год" : `Каждые ${n} ${plural(n, "год", "года", "лет")}`;
}
