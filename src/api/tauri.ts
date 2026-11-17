import { invoke } from "@tauri-apps/api/core";

/** Единственная точка вызова Rust-команд. Экраны работают с базой только через неё. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "неизвестная ошибка");
  }
}
