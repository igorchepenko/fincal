import { kopToInput, parseRubles } from "../accounts/money";
import type { Direction, Frequency, NewPayment, Payment, PaymentPatch, RecurrenceInfo, RecurrenceSpec } from "./api";
import { diffDays, isValidDay, weekdayCode } from "./dates";

export const MAX_TITLE = 200;
export const MAX_NOTE = 1000;
export const MAX_INTERVAL = 999;

/** Конструктор повторения, как его видит человек (числа текстом). */
export interface RecurrenceForm {
  enabled: boolean;
  frequency: Frequency;
  interval: string;
  weekdays: string[];
  /** Числа месяца через запятую: «5, 20». */
  monthDays: string;
  lastDay: boolean;
  /** Конец периода; начало серии это дата платежа. */
  endsOn: string;
}

export interface PaymentForm {
  direction: Direction;
  title: string;
  amount: string;
  accountId: string;
  date: string;
  note: string;
  rec: RecurrenceForm;
}

export function emptyRecurrence(): RecurrenceForm {
  return { enabled: false, frequency: "monthly", interval: "1", weekdays: [], monthDays: "", lastDay: false, endsOn: "" };
}

export function emptyForm(today: string, accountId?: number): PaymentForm {
  return {
    direction: "expense",
    title: "",
    amount: "",
    accountId: accountId === undefined ? "" : String(accountId),
    date: today,
    note: "",
    rec: emptyRecurrence(),
  };
}

export function recurrenceFormFromInfo(r: RecurrenceInfo): RecurrenceForm {
  const freq: Frequency = r.frequency === "yearly" ? "monthly" : r.frequency;
  return {
    enabled: true,
    frequency: freq,
    interval: String(r.interval),
    weekdays: r.weekdays,
    monthDays: r.month_days.filter((d) => d !== -1).join(", "),
    lastDay: r.month_days.includes(-1),
    endsOn: r.ends_on ?? "",
  };
}

export function formFromPayment(p: Payment, rule: RecurrenceInfo | null): PaymentForm {
  return {
    direction: p.direction,
    title: p.title,
    amount: kopToInput(p.amount_kop),
    accountId: String(p.account_id),
    date: p.planned_on,
    note: p.note ?? "",
    rec: rule ? recurrenceFormFromInfo(rule) : emptyRecurrence(),
  };
}

export interface FormErrors {
  title?: string;
  amount?: string;
  account?: string;
  date?: string;
  note?: string;
  interval?: string;
  monthDays?: string;
  endsOn?: string;
}

/** Разбор «5, 20, 31» в числа месяца; null, если что-то не число 1–31. */
export function parseMonthDays(text: string, lastDay: boolean): number[] | null {
  const out: number[] = [];
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  for (const part of parts) {
    if (!/^\d{1,2}$/.test(part)) return null;
    const n = Number(part);
    if (n < 1 || n > 31) return null;
    if (!out.includes(n)) out.push(n);
  }
  out.sort((a, b) => a - b);
  if (lastDay) out.push(-1);
  return out;
}

/** Повторяемость из формы. Ошибки складываются в `errors`; null, если повторения нет или оно не разобрано. */
export function buildRecurrence(f: PaymentForm, errors: FormErrors): RecurrenceSpec | null {
  const r = f.rec;
  if (!r.enabled) return null;
  const interval = /^\d{1,3}$/.test(r.interval.trim()) ? Number(r.interval.trim()) : 0;
  if (interval < 1 || interval > MAX_INTERVAL) errors.interval = `Число от 1 до ${MAX_INTERVAL}`;
  let monthDays: number[] = [];
  if (r.frequency === "monthly") {
    const parsed = parseMonthDays(r.monthDays, r.lastDay);
    if (!parsed) errors.monthDays = "Числа месяца от 1 до 31 через запятую, например 5, 20";
    else monthDays = parsed;
  }
  if (!r.endsOn) errors.endsOn = "Укажи, до какой даты повторять";
  else if (!isValidDay(r.endsOn)) errors.endsOn = "Введи дату целиком";
  else if (isValidDay(f.date) && r.endsOn < f.date) errors.endsOn = "Конец периода раньше начала";
  if (errors.interval || errors.monthDays || errors.endsOn || !isValidDay(f.date)) return null;
  return {
    frequency: r.frequency,
    interval,
    weekdays: r.frequency === "weekly" ? r.weekdays : [],
    month_days: monthDays,
    starts_on: f.date,
    ends_on: r.endsOn,
  };
}

export interface Checked {
  title: string;
  direction: Direction;
  amountKop: number;
  accountId: number;
  date: string;
  note: string;
  recurrence: RecurrenceSpec | null;
}

/** Проверка формы. Возвращает нормализованные значения или ошибки по полям. */
export function validatePaymentForm(f: PaymentForm): { ok: Checked } | { errors: FormErrors } {
  const errors: FormErrors = {};
  const title = f.title.trim();
  if (!title) errors.title = "Введи название платежа";
  else if (title.length > MAX_TITLE) errors.title = `Не длиннее ${MAX_TITLE} символов`;

  const raw = parseRubles(f.amount);
  if (raw === null) errors.amount = "Введи сумму, например 1500 или 349,90";
  else if (raw <= 0) errors.amount = "Сумма должна быть больше нуля: тип (приход или расход) выбирается выше";

  const accountId = Number(f.accountId);
  if (!f.accountId || !Number.isInteger(accountId)) errors.account = "Выбери счёт";

  if (!isValidDay(f.date)) errors.date = "Введи дату целиком";
  if (f.note.trim().length > MAX_NOTE) errors.note = `Не длиннее ${MAX_NOTE} символов`;

  const recurrence = buildRecurrence(f, errors);
  if (Object.keys(errors).length || raw === null) return { errors };
  return { ok: { title, direction: f.direction, amountKop: raw, accountId, date: f.date, note: f.note.trim(), recurrence } };
}

export function toNewPayment(c: Checked): NewPayment {
  const base: NewPayment = { title: c.title, direction: c.direction, amount_kop: c.amountKop, account_id: c.accountId };
  if (c.note) base.note = c.note;
  if (c.recurrence) base.recurrence = c.recurrence;
  else base.planned_on = c.date;
  return base;
}

const same = <T,>(a: T[], b: T[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Изменили ли правило повторения по сравнению с сохранённым. */
export function recurrenceChanged(spec: RecurrenceSpec | null, old: RecurrenceInfo | null): boolean {
  if (!spec || !old) return false;
  return (
    spec.frequency !== old.frequency ||
    spec.interval !== old.interval ||
    spec.ends_on !== old.ends_on ||
    !same(spec.weekdays, old.weekdays) ||
    !same(spec.month_days, old.month_days)
  );
}

/**
 * Правка: передаём все поля платежа; новую дату только если она сменилась;
 * повторяемость только если её изменили (и тогда годится лишь «этот и все следующие»).
 */
export function toPatch(c: Checked, original: Payment, rule: RecurrenceInfo | null, scope: "this" | "following"): PaymentPatch {
  const patch: PaymentPatch = {
    title: c.title,
    direction: c.direction,
    amount_kop: c.amountKop,
    account_id: c.accountId,
    note: c.note,
  };
  if (c.date !== original.planned_on) patch.planned_on = c.date;
  if (scope === "following" && c.recurrence && recurrenceChanged(c.recurrence, rule)) patch.recurrence = c.recurrence;
  return patch;
}

/** Серия на экране формы: спецификация для подсказки «будет N платежей»; null, пока форма не годится. */
export function previewSpec(f: PaymentForm): RecurrenceSpec | null {
  if (!f.rec.enabled) return null;
  const errors: FormErrors = {};
  return buildRecurrence(f, errors);
}

/** Сколько дней в периоде: для защиты от случайного «до 2099 года». */
export function periodDays(f: PaymentForm): number {
  return isValidDay(f.date) && isValidDay(f.rec.endsOn) ? diffDays(f.date, f.rec.endsOn) + 1 : 0;
}

/** День недели первого платежа, на случай если дни недели не выбраны. */
export function defaultWeekday(date: string): string | null {
  return weekdayCode(date);
}
