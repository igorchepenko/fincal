// История версий. Новые записи добавляй СВЕРХУ.
// Тест src/releases.test.ts проверяет, что верхняя запись совпадает
// с версией в package.json, tauri.conf.json и Cargo.toml.

export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  notes: string[];
}

export const releases: Release[] = [
  {
    version: "0.1.0",
    date: "2026-11-16",
    notes: [
      "Каркас приложения: Tauri + React + TypeScript",
      "Локальная база SQLite с нумерованными миграциями",
    ],
  },
];

export const currentVersion = releases[0].version;
