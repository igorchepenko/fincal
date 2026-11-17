import { describe, expect, it } from "vitest";
import { defaultMenuOrder, hotkeyIndex, isDefaultOrder, isSettingsHotkey, moveItem, parseMenuOrder, serializeMenuOrder } from "./menu";

const key = (code: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  code,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

describe("порядок меню", () => {
  it("без сохранённого значения берётся порядок по умолчанию", () => {
    expect(parseMenuOrder(null)).toEqual(defaultMenuOrder);
    expect(parseMenuOrder("")).toEqual(defaultMenuOrder);
  });

  it("сохранённый порядок читается как есть", () => {
    expect(parseMenuOrder('["accounts","calendar","payments","events"]')).toEqual(["accounts", "calendar", "payments", "events", "budget"]);
  });

  it("мусор, неизвестные id и повторы отбрасываются", () => {
    expect(parseMenuOrder("{нет")).toEqual(defaultMenuOrder);
    expect(parseMenuOrder('"payments"')).toEqual(defaultMenuOrder);
    expect(parseMenuOrder('["x","payments","payments",7]')).toEqual(["payments", "calendar", "events", "budget", "accounts"]);
  });

  it("новые разделы, которых нет в сохранённом списке, встают в конец", () => {
    expect(parseMenuOrder('["accounts"]')).toEqual(["accounts", "calendar", "events", "payments", "budget"]);
  });

  it("запись и чтение возвращают тот же порядок", () => {
    const order = ["payments", "accounts", "events", "calendar", "budget"] as const;
    expect(parseMenuOrder(serializeMenuOrder([...order]))).toEqual([...order]);
  });

  it("moveItem переставляет и не ломается на краях", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    const same = ["a", "b"];
    expect(moveItem(same, 0, 5)).toBe(same);
    expect(moveItem(same, -1, 0)).toBe(same);
    expect(same).toEqual(["a", "b"]);
  });

  it("isDefaultOrder", () => {
    expect(isDefaultOrder(defaultMenuOrder)).toBe(true);
    expect(isDefaultOrder([...defaultMenuOrder].reverse())).toBe(false);
  });
});

describe("сочетания клавиш", () => {
  it("⌘1…⌘N дают позицию, лишние цифры и чужие модификаторы игнорируются", () => {
    expect(hotkeyIndex(key("Digit1"), 3)).toBe(0);
    expect(hotkeyIndex(key("Digit3"), 3)).toBe(2);
    expect(hotkeyIndex(key("Digit4"), 3)).toBeNull();
    expect(hotkeyIndex(key("Digit1", { metaKey: false }), 3)).toBeNull();
    expect(hotkeyIndex(key("Digit1", { shiftKey: true }), 3)).toBeNull();
    expect(hotkeyIndex(key("KeyA"), 3)).toBeNull();
  });

  it("⌘, открывает настройки", () => {
    expect(isSettingsHotkey(key("Comma"))).toBe(true);
    expect(isSettingsHotkey(key("Comma", { metaKey: false }))).toBe(false);
    expect(isSettingsHotkey(key("Period"))).toBe(false);
  });
});
