// Типы и чистые функции блокировки. Совпадают с Rust (src-tauri/src/lock.rs).

export type LockMode = "always" | "after";

export interface LockSettings {
  enabled: boolean;
  mode: LockMode;
  minutes: number;
}

export interface AuthStatus {
  /** Проверка владельца возможна: Touch ID или пароль macOS. */
  available: boolean;
  /** Touch ID есть и настроен; иначе система спросит пароль. */
  touchId: boolean;
  reason: string | null;
}

export interface LockStatus {
  locked: boolean;
  settings: LockSettings;
  auth: AuthStatus;
}

export const MAX_MINUTES = 1440;

export const lockModes: { id: LockMode; title: string }[] = [
  { id: "always", title: "При каждом открытии" },
  { id: "after", title: "Если свёрнуто дольше" },
];

/** Минуты из поля ввода: целое от 1 до 1440, иначе null. */
export function parseMinutes(input: string): number | null {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_MINUTES ? n : null;
}

/** Подпись под переключателем в настройках. */
export function authHint(auth: AuthStatus): string {
  if (!auth.available) {
    return "На этом Mac нельзя проверить владельца" + (auth.reason ? `: ${auth.reason}` : ".");
  }
  return auth.touchId
    ? "Открывать по Touch ID. Если палец не распознан, можно ввести пароль macOS."
    : "Touch ID не настроен, поэтому macOS будет спрашивать пароль учётной записи.";
}

/** Как открыть: подпись на кнопке экрана блокировки. */
export function unlockLabel(touchId: boolean): string {
  return touchId ? "Открыть по Touch ID" : "Открыть паролем macOS";
}
