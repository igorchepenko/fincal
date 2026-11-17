import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Shell } from "./Shell";
import { screens } from "./screens";
import { parseTheme, themeAttribute } from "./theme";

describe("экраны", () => {
  it("четыре раздела в нужном порядке", () => {
    expect(screens.map((s) => s.title)).toEqual(["Календарь", "Платежи", "Счета", "Настройки"]);
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

describe("окно", () => {
  it("показывает сайдбар, активный раздел и пустое состояние", () => {
    const html = renderToString(<Shell version="0.0.0" initialScreen="accounts" />);
    for (const s of screens) expect(html).toContain(s.title);
    expect(html).toContain("Счетов пока нет");
    expect(html).toContain('aria-current="page"');
  });
});
