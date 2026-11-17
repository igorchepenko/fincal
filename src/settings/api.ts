import { call } from "../api/tauri";

/** Настройки текущего профиля (таблица settings). В тестах подставляется заглушка. */
export interface SettingsApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const tauriSettingsApi: SettingsApi = {
  get: (key) => call<string | null>("get_setting", { key }),
  set: (key, value) => call<void>("set_setting", { key, value }),
};
