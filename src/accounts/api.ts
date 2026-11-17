import { call } from "../api/tauri";
import type { AccountKind } from "./options";

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  currency: string;
  /** Корректировка: остаток на конец дня balance_on. */
  opening_balance_kop: number;
  balance_on: string;
  /** Текущий баланс в копейках (корректировка плюс выполненные платежи после неё). Кредитка: долг со знаком минус. */
  balance_kop: number;
  comment: string;
  color: string;
  icon: string;
  include_in_total: boolean;
  status: "active" | "archived";
}

export interface AccountInput {
  name: string;
  kind: AccountKind;
  comment: string;
  color: string;
  icon: string;
  include_in_total: boolean;
  balance_kop: number;
  /** Календарный день, на который введён баланс (сегодня у пользователя), ГГГГ-ММ-ДД. */
  balance_on: string;
}

/** Операции со счетами текущего профиля. В тестах подставляется заглушка. */
export interface AccountApi {
  list(): Promise<Account[]>;
  create(input: AccountInput): Promise<number>;
  update(id: number, input: AccountInput): Promise<void>;
  setArchived(id: number, archived: boolean): Promise<void>;
}

export const tauriAccountApi: AccountApi = {
  list: () => call<Account[]>("list_accounts"),
  create: (i) =>
    call<number>("create_account", {
      account: {
        name: i.name,
        kind: i.kind,
        opening_balance_kop: i.balance_kop,
        balance_on: i.balance_on,
        comment: i.comment,
        color: i.color,
        icon: i.icon,
        include_in_total: i.include_in_total,
      },
    }),
  update: (id, i) => call<void>("update_account", { id, update: i }),
  setArchived: (id, archived) => call<void>("archive_account", { id, archived }),
};
