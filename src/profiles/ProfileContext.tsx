import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { tauriProfileApi, type Profile, type ProfileApi } from "./api";

export interface ProfileState {
  /** Профиль, который открыт сейчас. Пока не загружен, null. */
  current: Profile | null;
  profiles: Profile[];
  error: string | null;
  create(name: string): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
  switchTo(id: number): Promise<void>;
}

const Ctx = createContext<ProfileState | null>(null);

/**
 * Текущий профиль приложения. Экраны берут из него `current.id` и перезагружают данные при смене
 * (Shell перемонтирует рабочую область по `key`, так что экран заново читает базу).
 * Сами данные Rust отбирает по текущему профилю, id в команды передавать не нужно.
 */
export function useProfiles(): ProfileState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProfiles вызван вне ProfileProvider");
  return v;
}

export function ProfileProvider({ api = tauriProfileApi, children }: { api?: ProfileApi; children: ReactNode }) {
  const [current, setCurrent] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [list, cur] = await Promise.all([api.list(), api.current()]);
    setProfiles(list);
    setCurrent(cur);
    setError(null);
  }, [api]);

  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
  }, [reload]);

  const value = useMemo<ProfileState>(
    () => ({
      current,
      profiles,
      error,
      create: async (name) => {
        const id = await api.create(name);
        await api.switchTo(id);
        await reload();
      },
      rename: async (id, name) => {
        await api.rename(id, name);
        await reload();
      },
      remove: async (id) => {
        await api.remove(id);
        await reload();
      },
      switchTo: async (id) => {
        await api.switchTo(id);
        await reload();
      },
    }),
    [api, current, profiles, error, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
