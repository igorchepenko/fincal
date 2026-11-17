-- Профили (миграция 0003). Профиль = строка owners, у профиля только имя.
-- Имена живых профилей не повторяются (регистр сверяет код, SQLite его для кириллицы не различает).
CREATE UNIQUE INDEX idx_owners_name ON owners(name) WHERE deleted_at IS NULL;

-- Какой профиль открыт сейчас. Это настройка всего приложения, а не профиля,
-- поэтому живёт в app_meta (ключ → значение), а не в settings.
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('current_owner_id', '1');
