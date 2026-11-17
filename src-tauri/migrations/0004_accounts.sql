-- Счета (миграция 0004): четыре типа, цвет, иконка, комментарий, флажок «в итоге»,
-- архив, баланс как корректировка «баланс на дату».
--
-- SQLite не умеет менять CHECK у колонки, поэтому таблица пересоздаётся по рецепту из
-- документации (create new, copy, drop old, rename). Миграция выполняется при выключенных
-- внешних ключах (это делает db::migrate), иначе DROP TABLE упрётся в ссылки из transactions.
--
-- Баланс: opening_balance_kop это остаток на конец дня balance_on (календарный день).
-- Текущий баланс = эта корректировка + выполненные платежи после balance_on.
-- Деньги в копейках. Кредитная карта хранит долг отрицательным числом (−25 000 ₽ = -2500000).

CREATE TABLE accounts_new (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id              INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    name                  TEXT NOT NULL,
    kind                  TEXT NOT NULL CHECK (kind IN ('debit_card', 'credit_card', 'cash', 'deposit')),
    currency              TEXT NOT NULL DEFAULT 'RUB',
    opening_balance_kop   INTEGER NOT NULL DEFAULT 0,
    balance_on            TEXT NOT NULL DEFAULT (date('now')),
    comment               TEXT NOT NULL DEFAULT '',
    color                 TEXT NOT NULL DEFAULT 'slate',
    icon                  TEXT NOT NULL DEFAULT 'wallet',
    include_in_total      INTEGER NOT NULL DEFAULT 1 CHECK (include_in_total IN (0, 1)),
    sort_order            INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    archived_at           TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at            TEXT,
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

-- Старые счета: «card» стала дебетовой картой; balance_on = 1970-01-01, чтобы все выполненные
-- платежи, как и раньше, учитывались в балансе.
INSERT INTO accounts_new
    (id, owner_id, name, kind, currency, opening_balance_kop, balance_on, icon, sort_order,
     status, archived_at, created_at, updated_at, deleted_at)
SELECT id, owner_id, name,
       CASE kind WHEN 'card' THEN 'debit_card' ELSE kind END,
       currency, opening_balance_kop, '1970-01-01',
       CASE kind WHEN 'card' THEN 'card' WHEN 'cash' THEN 'cash' ELSE 'deposit' END,
       sort_order, status,
       CASE status WHEN 'archived' THEN updated_at ELSE NULL END,
       created_at, updated_at, deleted_at
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE INDEX idx_accounts_owner ON accounts(owner_id, status);

CREATE TRIGGER accounts_touch AFTER UPDATE ON accounts
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;
