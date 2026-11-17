export type ThemeMode = "system" | "light" | "dark";

export const themeModes: { id: ThemeMode; title: string }[] = [
  { id: "system", title: "Авто" },
  { id: "light", title: "Светлая" },
  { id: "dark", title: "Тёмная" },
];

const KEY = "fincal.theme";

export function parseTheme(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

/** Атрибут data-theme для <html>: null значит «следовать системе». */
export function themeAttribute(mode: ThemeMode): "light" | "dark" | null {
  return mode === "system" ? null : mode;
}

export function loadTheme(): ThemeMode {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return "system";
  }
}

export function saveTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* хранилище недоступно: тема просто не запомнится */
  }
}

export function applyTheme(mode: ThemeMode): void {
  const attr = themeAttribute(mode);
  const root = document.documentElement;
  if (attr) root.setAttribute("data-theme", attr);
  else root.removeAttribute("data-theme");
}
