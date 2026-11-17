import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Shell } from "./Shell";
import { ProfileProvider } from "../profiles/ProfileContext";
import type { ProfileApi } from "../profiles/api";
import { screens } from "./screens";
import { parseTheme, themeAttribute } from "./theme";

describe("экраны", () => {
  it("четыре раздела по умолчанию, «Настройки» вынесены из списка", () => {
    expect(screens.map((s) => s.title)).toEqual(["Календарь", "События", "Платежи", "Счета"]);
  });

  it("у каждого экрана есть пустое состояние", () => {
    for (const s of screens) {
      expect(s.emptyTitle.length).toBeGreaterThan(0);
      expect(s.emptyText.length).toBeGreaterThan(0);
    }
  });
});

describe("тема", () => {
  it("неизвестное значение сводится к системной", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("blue")).toBe("system");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });

  it("системная тема не ставит атрибут", () => {
    expect(themeAttribute("system")).toBeNull();
    expect(themeAttribute("dark")).toBe("dark");
  });
});

const noApi: ProfileApi = {
  list: async () => [],
  current: async () => ({ id: 1, name: "Я" }),
  create: async () => 2,
  rename: async () => {},
  remove: async () => 1,
  switchTo: async () => {},
};

describe("окно", () => {
  it("показывает сайдбар, активный раздел и пустое состояние", () => {
    const html = renderToString(
      <ProfileProvider api={noApi}>
        <Shell version="0.0.0" initialScreen="calendar" />
      </ProfileProvider>,
    );
    for (const s of screens) expect(html).toContain(s.title);
    expect(html).toContain("В календаре пока пусто");
    expect(html).toContain('aria-current="page"');
  });

  it("«Настройки» внизу сайдбара только иконкой, без текста на кнопке", () => {
    const html = renderToString(
      <ProfileProvider api={noApi}>
        <Shell version="0.0.0" />
      </ProfileProvider>,
    );
    expect(html).toMatch(/<button[^>]*aria-label="Настройки"[^>]*><svg[^>]*>.*?<\/svg><\/button>/);
    expect(html).toContain("Настройки ⌘,");
  });

  it("пункты идут в сохранённом порядке и получают ⌘1…⌘N по позиции", () => {
    const html = renderToString(
      <ProfileProvider api={noApi}>
        <Shell version="0.0.0" initialOrder={["accounts", "calendar", "payments"]} />
      </ProfileProvider>,
    );
    const nav = html.slice(html.indexOf('aria-label="Разделы"'));
    expect(nav.indexOf("Счета")).toBeLessThan(nav.indexOf("Календарь"));
    expect(nav.indexOf("Календарь")).toBeLessThan(nav.indexOf("Платежи"));
    expect(nav).toContain("⌘1");
    expect(html).toContain("Счета ⌘1");
  });

  it("окно настроек открывается поверх экрана и содержит разделы", () => {
    const html = renderToString(
      <ProfileProvider api={noApi}>
        <Shell version="0.6.0" initialSettings="menu" />
      </ProfileProvider>,
    );
    expect(html).toContain('class="set-win"');
    for (const t of ["Внешний вид", "Безопасность", "Меню", "О приложении"]) expect(html).toContain(t);
    expect(html).toContain("Сбросить порядок");
    expect(html).toContain("Счета: выше");
  });

  it("раздел «Счета» открывает экран счетов, а не заглушку", () => {
    const html = renderToString(
      <ProfileProvider api={noApi}>
        <Shell version="0.0.0" initialScreen="accounts" />
      </ProfileProvider>,
    );
    expect(html).toContain('class="acc-none"');
    expect(html).not.toContain("Счетов пока нет");
  });
});
