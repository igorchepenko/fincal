# FinCal

Десктоп-приложение для macOS: финансовый календарь поступлений и списаний личных средств. Только для личного использования.

Стек: Tauri 2 (Rust) + React + TypeScript + локальный SQLite. Без облака и сервера.

Файл базы `fincal.db` живёт только на твоём Mac (папка данных приложения) и в репозиторий не попадает. Репозиторий публичный: не клади сюда ключи, `.env`, дампы БД и реальные финансовые данные.

## Установка собранного приложения

Приложение не подписано Apple, поэтому после копирования нужно снять карантин.

1. Открой нужный запуск на вкладке **Actions** репозитория и скачай артефакт **FinCal-dmg** (это zip), распакуй его.
2. Открой `.dmg` и перетащи FinCal в папку **Applications**.
3. Выполни в Терминале:

```sh
xattr -cr /Applications/FinCal.app
```

4. Запусти FinCal из Launchpad или папки Applications.

## Разработка

Нужны Node.js 22+ и Rust (через [rustup](https://rustup.rs)), на macOS ещё Xcode Command Line Tools.

```sh
npm install
```

Запуск в режиме разработки:

```sh
npm run tauri dev
```

Тесты TypeScript:

```sh
npm test
```

Тесты Rust (миграции БД):

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

Локальная сборка `.dmg` (результат в `src-tauri/target/release/bundle/dmg/`):

```sh
npm run tauri build -- --bundles dmg
```

## Как устроено

- **База.** Схема меняется только нумерованными миграциями `src-tauri/migrations/NNNN_имя.sql`, их список в `src-tauri/src/db.rs`. Версия схемы хранится в `PRAGMA user_version`. Выпущенные миграции не редактируем.
- **История версий.** `src/releases.ts`, новые записи сверху. Тест проверяет, что верхняя запись совпадает с версией в `package.json`, `src-tauri/tauri.conf.json` и `src-tauri/Cargo.toml`. При выпуске новой версии меняй все четыре места.
- **CI.** GitHub Actions на каждый PR и push в `main`: тесты TS и Rust, сборка `.dmg`, загрузка в Artifacts.
