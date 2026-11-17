import type { Account } from "./api";

export interface Summary {
  /** Сумма балансов активных счетов с флажком «учитывать в итоге», в копейках. */
  totalKop: number;
  counted: number;
  /** Активные счета, не вошедшие в итог из-за снятого флажка. */
  excluded: number;
  active: number;
  archived: number;
}

/** Общий итог по счетам. Архивные счета в итог не входят. Кредитная карта идёт со своим минусом. */
export function summarize(accounts: Account[]): Summary {
  const active = accounts.filter((a) => a.status === "active");
  const counted = active.filter((a) => a.include_in_total);
  return {
    totalKop: counted.reduce((s, a) => s + a.balance_kop, 0),
    counted: counted.length,
    excluded: active.length - counted.length,
    active: active.length,
    archived: accounts.length - active.length,
  };
}
