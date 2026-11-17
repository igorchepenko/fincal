import { screens, type ScreenId } from "./screens";

/** Ключ в настройках профиля: JSON-массив id разделов в порядке сайдбара. */
export const MENU_ORDER_KEY = "menu.order";

export const defaultMenuOrder: ScreenId[] = screens.map((s) => s.id);

/**
 * Читает сохранённый порядок. Мусор и неизвестные id отбрасываются, повторы убираются,
 * разделы, которых нет в сохранённом списке (например, новые), встают в конец в порядке по умолчанию.
 */
export function parseMenuOrder(raw: string | null | undefined): ScreenId[] {
  let saved: unknown = [];
  try {
    saved = raw ? JSON.parse(raw) : [];
  } catch {
    saved = [];
  }
  const known = new Set<string>(defaultMenuOrder);
  const result: ScreenId[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === "string" && known.has(id) && !result.includes(id as ScreenId)) result.push(id as ScreenId);
    }
  }
  for (const id of defaultMenuOrder) if (!result.includes(id)) result.push(id);
  return result;
}

export function serializeMenuOrder(order: ScreenId[]): string {
  return JSON.stringify(order);
}

/** Переставляет пункт с позиции from на позицию to. Выход за границы ничего не меняет. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function isDefaultOrder(order: ScreenId[]): boolean {
  return order.length === defaultMenuOrder.length && order.every((id, i) => id === defaultMenuOrder[i]);
}

/** ⌘1…⌘9 по позиции в меню: возвращает индекс пункта или null, если это не наше сочетание. */
export function hotkeyIndex(e: { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, count: number): number | null {
  if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  const m = /^Digit([1-9])$/.exec(e.code);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i < count ? i : null;
}

export function isSettingsHotkey(e: { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "Comma";
}
