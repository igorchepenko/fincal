import type { Payment } from "./api";
import { effectiveKop } from "./model";

export type SortKey = "date" | "amount" | "title" | "account";

export interface SortState {
  key: SortKey;
  /** true: от большего к меньшему / от Я к А / от поздних к ранним. */
  reverse: boolean;
}

export const defaultSort: SortState = { key: "date", reverse: false };

export const SORT_TITLES: Record<SortKey, string> = { date: "Дата", amount: "Сумма", title: "Название", account: "Счёт" };

/** Подсказка словами: что сверху при текущем порядке. */
export function sortHint(s: SortState): string {
  switch (s.key) {
    case "date":
      return s.reverse ? "поздние сверху" : "ближайшие сверху";
    case "amount":
      return s.reverse ? "большие суммы сверху" : "меньшие суммы сверху";
    case "title":
      return s.reverse ? "названия от Я к А" : "названия от А к Я";
    default:
      return s.reverse ? "счета от Я к А" : "счета от А к Я";
  }
}

export function parseSort(raw: string | null | undefined): SortState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<SortState>) : {};
    const key = v.key && v.key in SORT_TITLES ? v.key : "date";
    return { key, reverse: v.reverse === true };
  } catch {
    return defaultSort;
  }
}

/** Сортирует копию списка. Равные по ключу платежи идут по дате, потом по id: порядок устойчив. */
export function sortPayments(list: Payment[], s: SortState, accountName: (id: number) => string): Payment[] {
  const dir = s.reverse ? -1 : 1;
  const cmpDate = (a: Payment, b: Payment) => (a.planned_on < b.planned_on ? -1 : a.planned_on > b.planned_on ? 1 : a.id - b.id);
  const text = (a: string, b: string) => a.localeCompare(b, "ru", { sensitivity: "base" });
  return list.slice().sort((a, b) => {
    let c = 0;
    if (s.key === "amount") c = effectiveKop(a) - effectiveKop(b);
    else if (s.key === "title") c = text(a.title, b.title);
    else if (s.key === "account") c = text(accountName(a.account_id), accountName(b.account_id));
    else c = cmpDate(a, b);
    return c !== 0 ? c * dir : s.key === "date" ? 0 : cmpDate(a, b);
  });
}

/** Поиск по названию, комментарию и счёту без учёта регистра. */
export function matchesQuery(p: Payment, query: string, accountName: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${p.title} ${p.note ?? ""} ${accountName}`.toLowerCase().includes(q);
}
