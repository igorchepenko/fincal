// Вызовы Rust-команд блокировки. Само окно Touch ID показывает macOS.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LockSettings, LockStatus } from "./model";

/** Запущено ли внутри приложения (а не в браузере при разработке). */
export function inApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const getLockStatus = () => invoke<LockStatus>("lock_status");

/** true — открыто, false — пользователь отменил. */
export const unlock = () => invoke<boolean>("unlock");

/** null — пользователь отменил проверку, настройки не изменились. */
export const saveLockSettings = (settings: LockSettings) =>
  invoke<LockStatus | null>("set_lock_settings", { settings });

export const onLockChanged = (cb: (locked: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("lock-changed", (e) => cb(e.payload));
