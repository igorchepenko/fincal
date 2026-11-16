-- Первая миграция: служебная таблица. Таблицы календаря появятся позже.
CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
