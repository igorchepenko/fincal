-- Платежи и повторяемость (миграция 0005).
--
-- Правило повторения теперь хранится строкой RRULE (RFC 5545), например
-- 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR'. Колонки frequency и interval_n остаются и
-- дублируют FREQ и INTERVAL, чтобы старые запросы и проверки продолжали работать.
-- Период серии: starts_on и ends_on. Для серий, создаваемых приложением, обе даты
-- обязательны (это проверяет код: SQLite не умеет сделать NOT NULL у существующей колонки).
--
-- Старые правила (их никто не создавал из интерфейса) получают строку RRULE из frequency и interval_n.

ALTER TABLE recurrence_rules ADD COLUMN rrule TEXT NOT NULL DEFAULT '';

UPDATE recurrence_rules
SET rrule = 'FREQ=' || upper(frequency) || ';INTERVAL=' || interval_n;

-- Список платежей по счёту и статусу за период: фильтры раздела «Платежи».
CREATE INDEX idx_transactions_owner_status_day ON transactions(owner_id, status, planned_on);
