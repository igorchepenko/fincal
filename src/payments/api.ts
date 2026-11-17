import { call } from "../api/tauri";

export type Direction = "income" | "expense";
export type PaymentStatus = "planned" | "completed" | "skipped";
export type Frequency = "daily" | "weekly" | "monthly";
export type Scope = "this" | "following";

/** Платёж, как его отдаёт Rust (`list_payments`). Суммы в копейках. */
export interface Payment {
  id: number;
  account_id: number;
  rule_id: number | null;
  direction: Direction;
  title: string;
  note: string | null;
  amount_kop: number;
  actual_amount_kop: number | null;
  planned_on: string;
  status: PaymentStatus;
}

export interface MonthTotals {
  count: number;
  skipped_count: number;
  planned_income_kop: number;
  planned_expense_kop: number;
  completed_income_kop: number;
  completed_expense_kop: number;
}

export interface MonthGroup {
  /** ГГГГ-ММ */
  month: string;
  totals: MonthTotals;
  payments: Payment[];
}

/** Правило серии, как его отдаёт Rust. */
export interface RecurrenceInfo {
  rule_id: number;
  rrule: string;
  frequency: Frequency | "yearly";
  interval: number;
  weekdays: string[];
  month_days: number[];
  starts_on: string;
  ends_on: string | null;
}

export interface PaymentList {
  months: MonthGroup[];
  rules: RecurrenceInfo[];
  total_count: number;
}

export interface PaymentFilter {
  from: string;
  to: string;
  account_id?: number;
  direction?: Direction;
  status?: PaymentStatus;
}

/** Повторяемость в запросе на создание и правку. */
export interface RecurrenceSpec {
  frequency: Frequency;
  interval: number;
  weekdays: string[];
  month_days: number[];
  starts_on: string;
  ends_on: string;
}

export interface NewPayment {
  title: string;
  direction: Direction;
  amount_kop: number;
  account_id: number;
  planned_on?: string;
  note?: string;
  recurrence?: RecurrenceSpec;
}

export interface PaymentPatch {
  title?: string;
  direction?: Direction;
  amount_kop?: number;
  account_id?: number;
  planned_on?: string;
  /** Пустая строка очищает комментарий. */
  note?: string;
  recurrence?: RecurrenceSpec;
}

export interface RecurrencePreview {
  count: number;
  first: string | null;
  last: string | null;
  dates: string[];
}

/** Операции с платежами текущего профиля. В тестах подставляется заглушка. */
export interface PaymentApi {
  list(filter: PaymentFilter): Promise<PaymentList>;
  create(p: NewPayment): Promise<{ rule_id: number | null; count: number; first_id: number }>;
  update(id: number, patch: PaymentPatch, scope: Scope): Promise<{ changed: number; new_rule_id: number | null }>;
  remove(id: number, scope: Scope): Promise<number>;
  preview(spec: RecurrenceSpec): Promise<RecurrencePreview>;
  /** `actualKop` задаётся только для «выполнен»: фактическая сумма, если она отличается от плановой. */
  setStatus(id: number, status: PaymentStatus, actualKop: number | null): Promise<void>;
}

export const tauriPaymentApi: PaymentApi = {
  list: (filter) => call<PaymentList>("list_payments", { filter }),
  create: (payment) => call("create_payment", { payment }),
  update: (id, patch, scope) => call("update_payment", { id, patch, scope }),
  remove: (id, scope) => call<number>("delete_payment", { id, scope }),
  preview: (recurrence) => call<RecurrencePreview>("preview_recurrence", { recurrence }),
  setStatus: (id, status, actualKop) => call<void>("set_transaction_status", { id, status, actualAmountKop: actualKop }),
};
