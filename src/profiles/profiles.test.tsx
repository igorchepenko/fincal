import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateProfileName } from "./validate";
import { ProfileProvider } from "./ProfileContext";
import { ProfileSwitcher } from "./ProfileSwitcher";
import type { ProfileApi } from "./api";

const people = [
  { id: 1, name: "Анна" },
  { id: 2, name: "Борис" },
];

describe("имя профиля", () => {
  it("пустое и из пробелов не проходит", () => {
    expect(validateProfileName("", people)).not.toBeNull();
    expect(validateProfileName("   ", people)).not.toBeNull();
  });

  it("слишком длинное не проходит, ровно 40 проходит", () => {
    expect(validateProfileName("а".repeat(41), people)).not.toBeNull();
    expect(validateProfileName("а".repeat(40), people)).toBeNull();
  });

  it("повтор без учёта регистра и пробелов не проходит", () => {
    expect(validateProfileName(" анна ", people)).not.toBeNull();
    expect(validateProfileName("Вера", people)).toBeNull();
  });

  it("при переименовании своё имя можно оставить или сменить регистр", () => {
    expect(validateProfileName("АННА", people, 1)).toBeNull();
    expect(validateProfileName("Борис", people, 1)).not.toBeNull();
  });
});

describe("переключатель профиля", () => {
  const api: ProfileApi = {
    list: async () => people,
    current: async () => people[0],
    create: async () => 3,
    rename: async () => {},
    remove: async () => 1,
    switchTo: async () => {},
  };

  it("до загрузки показывает заглушку и неактивную кнопку", () => {
    const html = renderToString(
      <ProfileProvider api={api}>
        <ProfileSwitcher />
      </ProfileProvider>,
    );
    expect(html).toContain("Загрузка…");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-haspopup="menu"');
  });
});
