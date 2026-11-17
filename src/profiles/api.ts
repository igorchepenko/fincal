import { call } from "../api/tauri";

export interface Profile {
  id: number;
  name: string;
}

/** Операции с профилями. В тестах подставляется заглушка. */
export interface ProfileApi {
  list(): Promise<Profile[]>;
  current(): Promise<Profile>;
  create(name: string): Promise<number>;
  rename(id: number, name: string): Promise<void>;
  /** Возвращает id профиля, который стал текущим. */
  remove(id: number): Promise<number>;
  switchTo(id: number): Promise<void>;
}

export const tauriProfileApi: ProfileApi = {
  list: () => call<Profile[]>("list_profiles"),
  current: () => call<Profile>("get_current_profile"),
  create: (name) => call<number>("create_profile", { name }),
  rename: (id, name) => call<void>("rename_profile", { id, name }),
  remove: (id) => call<number>("delete_profile", { id }),
  switchTo: (id) => call<void>("switch_profile", { id }),
};
