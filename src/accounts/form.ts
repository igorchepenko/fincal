import type { Account, AccountInput } from "./api";
import { defaultIcon, type AccountKind } from "./options";
import { kopToInput, parseRubles } from "./money";

export const MAX_ACCOUNT_NAME = 60;
export const MAX_ACCOUNT_COMMENT = 500;

/** Значения полей формы счёта в том виде, как их видит человек (баланс текстом). */
export interface AccountForm {
  name: string;
  kind: AccountKind;
  /** Для кредитной карты это размер долга без знака, для остальных остаток (можно с минусом). */
  balance: string;
  comment: string;
  color: string;
  icon: string;
  includeInTotal: boolean;
}

export function emptyForm(): AccountForm {
  return { name: "", kind: "debit_card", balance: "0", comment: "", color: "slate", icon: defaultIcon("debit_card"), includeInTotal: true };
}

export function formFromAccount(a: Account): AccountForm {
  const credit = a.kind === "credit_card";
  return {
    name: a.name,
    kind: a.kind,
    // Кредитку показываем как долг без знака: баланс −25 000 это «долг 25 000».
    balance: kopToInput(credit ? Math.max(-a.balance_kop, 0) : a.balance_kop),
    comment: a.comment,
    color: a.color,
    icon: a.icon,
    includeInTotal: a.include_in_total,
  };
}

export interface FormErrors {
  name?: string;
  balance?: string;
  comment?: string;
}

export function validateForm(f: AccountForm, today: string): { input: AccountInput } | { errors: FormErrors } {
  const errors: FormErrors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Введи название счёта";
  else if (name.length > MAX_ACCOUNT_NAME) errors.name = `Не длиннее ${MAX_ACCOUNT_NAME} символов`;
  if (f.comment.trim().length > MAX_ACCOUNT_COMMENT) errors.comment = `Не длиннее ${MAX_ACCOUNT_COMMENT} символов`;

  const raw = parseRubles(f.balance);
  if (raw === null) errors.balance = "Введи сумму, например 25000 или 1200,50";
  if (Object.keys(errors).length || raw === null) return { errors };

  // Кредитка: человек вводит долг, в базе он хранится отрицательным числом.
  const balance = f.kind === "credit_card" ? -Math.abs(raw) : raw;
  return {
    input: {
      name,
      kind: f.kind,
      comment: f.comment.trim(),
      color: f.color,
      icon: f.icon,
      include_in_total: f.includeInTotal,
      balance_kop: balance,
      balance_on: today,
    },
  };
}

/** Сегодняшний календарный день по часам пользователя, ГГГГ-ММ-ДД. */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
