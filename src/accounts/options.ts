/** Справочники счёта: типы, цвета, иконки. Ключи цветов и иконок совпадают с проверкой в Rust (store.rs). */

export type AccountKind = "debit_card" | "credit_card" | "cash" | "deposit";

export const kinds: { id: AccountKind; title: string; hint: string }[] = [
  { id: "debit_card", title: "Дебетовая карта", hint: "Свои деньги на карте" },
  { id: "credit_card", title: "Кредитная карта", hint: "Учитывается как долг" },
  { id: "cash", title: "Наличные", hint: "Деньги на руках" },
  { id: "deposit", title: "Вклад", hint: "Вклад или накопительный счёт" },
];

export function kindTitle(id: string): string {
  return kinds.find((k) => k.id === id)?.title ?? id;
}

/** Цвета: семь цветов категорий из дизайн-системы (`--sp-*`). */
export const colors: { id: string; title: string }[] = [
  { id: "teal", title: "Бирюзовый" },
  { id: "berry", title: "Ягодный" },
  { id: "clay", title: "Глиняный" },
  { id: "slate", title: "Сланцевый" },
  { id: "cocoa", title: "Какао" },
  { id: "sage", title: "Шалфей" },
  { id: "graphite", title: "Графитовый" },
];

export const colorVar = (id: string): string => `var(--sp-${id})`;

export const icons: { id: string; title: string; path: string }[] = [
  { id: "card", title: "Карта", path: "M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5zM4 10h16M7 14.5h3" },
  { id: "wallet", title: "Кошелёк", path: "M4 7.5A1.5 1.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4 8.5V7M16 13h.01" },
  { id: "cash", title: "Наличные", path: "M3.5 7.5h17v9h-17zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 10h.01M17.5 14h.01" },
  { id: "bank", title: "Банк", path: "M3.5 9.5L12 4l8.5 5.5zM5.5 10.5v6M10 10.5v6M14 10.5v6M18.5 10.5v6M3.5 19.5h17" },
  { id: "deposit", title: "Вклад", path: "M12 3.5l7.5 3v5c0 4.5-3.1 7.7-7.5 9-4.4-1.3-7.5-4.5-7.5-9v-5zM9.5 14.5l5-5M9.5 10h.01M14.5 14h.01" },
  { id: "coins", title: "Монеты", path: "M12 9c3.9 0 7-1.1 7-2.5S15.9 4 12 4 5 5.1 5 6.5 8.1 9 12 9zM5 6.5v4C5 11.9 8.1 13 12 13s7-1.1 7-2.5v-4M5 10.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 14.5v3C5 18.9 8.1 20 12 20s7-1.1 7-2.5v-3" },
  { id: "home", title: "Дом", path: "M4 11l8-6.5 8 6.5M6 9.5V19h12V9.5M10 19v-5h4v5" },
  { id: "briefcase", title: "Портфель", path: "M4 8.5h16V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 8.5v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16" },
];

export function defaultIcon(kind: AccountKind): string {
  return kind === "cash" ? "cash" : kind === "deposit" ? "deposit" : "card";
}
