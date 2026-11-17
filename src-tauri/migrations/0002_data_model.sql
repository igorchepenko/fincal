-- Модель данных FinCal (миграция 0002).
-- Правила:
--  * id у каждой сущности, ссылки между таблицами только по id;
--  * деньги: целые копейки (INTEGER) + код валюты (сейчас только RUB);
--  * моменты времени (created_at, updated_at, completed_at, deleted_at) в UTC,
--    формат ISO 8601 'YYYY-MM-DDTHH:MM:SSZ';
--  * дата платежа planned_on это календарный день 'YYYY-MM-DD' без часового
--    пояса, чтобы платёж «20 числа» не уезжал на соседний день;
--  * мягкое удаление через deleted_at;
--  * owner_id в каждой таблице: сегодня один владелец (id = 1).

CREATE TABLE owners (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at TEXT
);
INSERT INTO owners (id, name) VALUES (1, 'Я');

-- Счета: карта, наличные, вклад.
CREATE TABLE accounts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id              INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    name                  TEXT NOT NULL,
    kind                  TEXT NOT NULL CHECK (kind IN ('card', 'cash', 'deposit')),
    currency              TEXT NOT NULL DEFAULT 'RUB',
    opening_balance_kop   INTEGER NOT NULL DEFAULT 0,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at            TEXT
);

-- Категории: у каждой свой тип (приход или расход), можно вкладывать друг в друга.
CREATE TABLE categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    name       TEXT NOT NULL,
    direction  TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
    parent_id  INTEGER REFERENCES categories(id),
    color      TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at TEXT
);

-- Правила повторения: «каждый N-й день/неделю/месяц/год».
CREATE TABLE recurrence_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    frequency   TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
    interval_n  INTEGER NOT NULL DEFAULT 1 CHECK (interval_n >= 1),
    starts_on   TEXT NOT NULL,
    ends_on     TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at  TEXT
);

-- Платежи: плановые и фактические в одной таблице.
-- Сумма плана всегда есть; фактическая сумма появляется при проведении.
-- Перевод между своими счетами: direction = 'transfer' и to_account_id.
CREATE TABLE transactions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id           INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    account_id         INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id      INTEGER REFERENCES accounts(id),
    category_id        INTEGER REFERENCES categories(id),
    rule_id            INTEGER REFERENCES recurrence_rules(id),
    direction          TEXT NOT NULL CHECK (direction IN ('income', 'expense', 'transfer')),
    title              TEXT NOT NULL,
    note               TEXT,
    amount_kop         INTEGER NOT NULL CHECK (amount_kop > 0),
    actual_amount_kop  INTEGER CHECK (actual_amount_kop IS NULL OR actual_amount_kop > 0),
    currency           TEXT NOT NULL DEFAULT 'RUB',
    planned_on         TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'skipped')),
    completed_at       TEXT,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at         TEXT,
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CHECK ((direction = 'transfer') = (to_account_id IS NOT NULL)),
    CHECK (to_account_id IS NULL OR to_account_id <> account_id),
    CHECK (direction <> 'transfer' OR category_id IS NULL)
);
CREATE INDEX idx_transactions_planned_on ON transactions(owner_id, planned_on);
CREATE INDEX idx_transactions_account ON transactions(account_id);
-- Одно правило даёт не больше одного платежа в день: генерация безопасна к повтору.
CREATE UNIQUE INDEX idx_transactions_rule_day
    ON transactions(rule_id, planned_on) WHERE rule_id IS NOT NULL AND deleted_at IS NULL;

-- Теги и связь «многие ко многим» с платежами.
CREATE TABLE tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at TEXT
);
CREATE UNIQUE INDEX idx_tags_name ON tags(owner_id, name) WHERE deleted_at IS NULL;

CREATE TABLE transaction_tags (
    owner_id       INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    tag_id         INTEGER NOT NULL REFERENCES tags(id),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at     TEXT,
    PRIMARY KEY (transaction_id, tag_id)
);

-- Настройки: одно хранилище «ключ → значение» на владельца.
CREATE TABLE settings (
    owner_id   INTEGER NOT NULL DEFAULT 1 REFERENCES owners(id),
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at TEXT,
    PRIMARY KEY (owner_id, key)
);
-- Автообновление updated_at при любой правке строки.

CREATE TRIGGER owners_touch AFTER UPDATE ON owners
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE owners SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER accounts_touch AFTER UPDATE ON accounts
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE accounts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER categories_touch AFTER UPDATE ON categories
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER recurrence_rules_touch AFTER UPDATE ON recurrence_rules
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE recurrence_rules SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER transactions_touch AFTER UPDATE ON transactions
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE transactions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER tags_touch AFTER UPDATE ON tags
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE tags SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER settings_touch AFTER UPDATE ON settings
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE settings SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER transaction_tags_touch AFTER UPDATE ON transaction_tags
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE transaction_tags SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE rowid = NEW.rowid;
END;
