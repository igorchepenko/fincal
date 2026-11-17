import type { Profile } from "./api";

export const MAX_PROFILE_NAME = 40;

/** Текст ошибки для имени профиля или null, если имя подходит. Те же правила проверяет и Rust. */
export function validateProfileName(name: string, profiles: Profile[], exceptId?: number): string | null {
  const n = name.trim();
  if (!n) return "Введи имя профиля";
  if ([...n].length > MAX_PROFILE_NAME) return `Не длиннее ${MAX_PROFILE_NAME} символов`;
  const wanted = n.toLowerCase();
  if (profiles.some((p) => p.id !== exceptId && p.name.toLowerCase() === wanted)) {
    return "Профиль с таким именем уже есть";
  }
  return null;
}
