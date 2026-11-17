import type { Direction, EventItem } from "../payments/api";

export type EventState = "active" | "finished" | "all";

export interface EventFilters {
  query: string;
  direction: Direction | "all";
  state: EventState;
  accountId: number | "all";
}

export const noEventFilters: EventFilters = { query: "", direction: "all", state: "active", accountId: "all" };

/** Событие ещё живо, пока в нём есть запланированные платежи (будущие или просроченные). */
export function isActive(e: EventItem): boolean {
  return e.planned > 0;
}

/** Есть ли у события повторение; иначе это разовый платёж. */
export function isSeries(e: EventItem): boolean {
  return e.rule !== null;
}

/** Фильтр списка событий: поиск по названию и комментарию, тип, состояние, счёт. */
export function filterEvents(list: EventItem[], f: EventFilters): EventItem[] {
  const q = f.query.trim().toLowerCase();
  return list.filter((e) => {
    const r = e.representative;
    if (f.direction !== "all" && r.direction !== f.direction) return false;
    if (f.accountId !== "all" && r.account_id !== f.accountId) return false;
    if (f.state === "active" && !isActive(e)) return false;
    if (f.state === "finished" && isActive(e)) return false;
    if (q && !`${r.title} ${r.note ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Сколько фильтров включено (поиск не считается): для кнопки сброса. */
export function activeFilterCount(f: EventFilters): number {
  return (f.direction !== "all" ? 1 : 0) + (f.accountId !== "all" ? 1 : 0) + (f.state !== "active" ? 1 : 0);
}

/** Прогресс события словами: «Выполнено 3 из 5», «Пропущено 1». */
export function progressText(e: EventItem): string {
  if (!isSeries(e)) {
    return e.completed ? "Выполнен" : e.skipped ? "Пропущен" : "Запланирован";
  }
  const parts = [`Выполнено ${e.completed} из ${e.total}`];
  if (e.skipped) parts.push(`пропущено ${e.skipped}`);
  return parts.join(", ");
}
