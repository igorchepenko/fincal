import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LockScreen } from "./LockScreen";
import { LockSettingsView } from "./LockSettingsPanel";
import { authHint, parseMinutes, unlockLabel, type LockStatus } from "./model";
import { Shell } from "../shell/Shell";

const status = (over: Partial<LockStatus["settings"]> = {}, auth: Partial<LockStatus["auth"]> = {}): LockStatus => ({
  locked: false,
  settings: { enabled: true, mode: "always", minutes: 5, ...over },
  auth: { available: true, touchId: true, reason: null, ...auth },
});

describe("минуты", () => {
  it("принимает целые от 1 до 1440", () => {
    expect(parseMinutes("5")).toBe(5);
    expect(parseMinutes(" 15 ")).toBe(15);
    expect(parseMinutes("1440")).toBe(1440);
  });
  it("отклоняет ноль, дроби, текст и слишком большие", () => {
    for (const v of ["0", "1.5", "", "abc", "-3", "1441"]) expect(parseMinutes(v)).toBeNull();
  });
});

describe("подсказки", () => {
  it("объясняет запасной вход паролем macOS", () => {
    expect(authHint(status().auth)).toContain("пароль macOS");
    expect(authHint(status({}, { touchId: false }).auth)).toContain("Touch ID не настроен");
    expect(authHint(status({}, { available: false, reason: "нет пароля" }).auth)).toContain("нет пароля");
    expect(unlockLabel(true)).toContain("Touch ID");
    expect(unlockLabel(false)).toContain("паролем macOS");
  });
});

describe("экран блокировки", () => {
  it("не показывает данных и предлагает открыть", () => {
    const html = renderToString(<LockScreen touchId busy={false} error={null} onUnlock={() => {}} />);
    expect(html).toContain("FinCal заблокирован");
    expect(html).toContain("Открыть по Touch ID");
    expect(html).not.toContain("Календарь");
  });
  it("показывает ошибку системы", () => {
    const html = renderToString(<LockScreen touchId={false} busy={false} error="сбой" onUnlock={() => {}} />);
    expect(html).toContain("сбой");
    expect(html).toContain("Открыть паролем macOS");
  });
});

describe("настройки блокировки", () => {
  it("режим «при каждом открытии» без поля минут", () => {
    const html = renderToString(<LockSettingsView status={status()} busy={false} error={null} onChange={() => {}} />);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("При каждом открытии");
    expect(html).not.toContain("мин</span>");
  });
  it("режим «если свёрнуто дольше» с минутами", () => {
    const html = renderToString(
      <LockSettingsView status={status({ mode: "after", minutes: 12 })} busy={false} error={null} onChange={() => {}} />,
    );
    expect(html).toContain('value="12"');
    expect(html).toContain("мин");
  });
  it("выключенная блокировка прячет режимы", () => {
    const html = renderToString(
      <LockSettingsView status={status({ enabled: false })} busy={false} error={null} onChange={() => {}} />,
    );
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain("Когда спрашивать");
  });
  it("нельзя включить, если Mac не может проверить владельца", () => {
    const html = renderToString(
      <LockSettingsView
        status={status({ enabled: false }, { available: false })}
        busy={false}
        error={null}
        onChange={() => {}}
      />,
    );
    expect(html).toMatch(/role="switch"[^>]*disabled/);
  });
});

describe("раздел Настройки", () => {
  it("Shell показывает переданное содержимое раздела", () => {
    const html = renderToString(
      <Shell version="0.0.0" initialScreen="settings" screenContent={{ settings: <p>блок-настроек</p> }} />,
    );
    expect(html).toContain("блок-настроек");
    expect(html).not.toContain("Настроек пока нет");
  });
});
