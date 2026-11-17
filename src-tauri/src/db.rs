//! Схема базы через нумерованные миграции.
//! Версия схемы хранится в `PRAGMA user_version`. Чтобы добавить миграцию:
//! создай `migrations/NNNN_имя.sql` и добавь её в конец списка MIGRATIONS.
//! Уже выпущенные миграции не редактируем.

use rusqlite::Connection;

pub const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../migrations/0001_init.sql")),
    ("0002_data_model", include_str!("../migrations/0002_data_model.sql")),
    ("0003_profiles", include_str!("../migrations/0003_profiles.sql")),
    ("0004_accounts", include_str!("../migrations/0004_accounts.sql")),
    ("0005_payments", include_str!("../migrations/0005_payments.sql")),
];

/// Открывает файл базы и включает проверку внешних ключей.
pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    Ok(conn)
}

/// Применяет все ещё не применённые миграции, каждую в своей транзакции.
/// Внешние ключи на время миграции выключаются (иначе таблицу нельзя пересоздать, см. 0004),
/// а перед коммитом проверяются целиком: нарушение откатывает миграцию.
pub fn migrate(conn: &mut Connection) -> rusqlite::Result<u32> {
    let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let fk_was_on: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    for (i, (_, sql)) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as u32;
        if version <= current {
            continue;
        }
        // PRAGMA foreign_keys внутри транзакции не действует, поэтому переключаем до неё.
        conn.pragma_update(None, "foreign_keys", false)?;
        let result = (|| -> rusqlite::Result<()> {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            let violations: i64 = tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
            if violations > 0 {
                return Err(rusqlite::Error::ExecuteReturnedResults);
            }
            tx.pragma_update(None, "user_version", version)?;
            tx.commit()
        })();
        conn.pragma_update(None, "foreign_keys", fk_was_on)?;
        result?;
    }
    Ok(MIGRATIONS.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_numbered_in_order() {
        for (i, (name, _)) in MIGRATIONS.iter().enumerate() {
            assert!(name.starts_with(&format!("{:04}_", i + 1)), "{name}");
        }
    }

    #[test]
    fn migrate_creates_schema_and_sets_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        let v = migrate(&mut conn).unwrap();
        assert_eq!(v, MIGRATIONS.len() as u32);
        let user_version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(user_version, v);
        conn.execute("INSERT INTO app_meta (key, value) VALUES ('k', 'v')", [])
            .unwrap();
    }

    #[test]
    fn migrate_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
    }

    #[test]
    fn accounts_migration_keeps_old_rows_and_transactions() {
        // Схема 0003 с данными «старого» вида: тип card и платёж, ссылающийся на счёт.
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        for (i, (_, sql)) in MIGRATIONS.iter().take(3).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", (i + 1) as u32).unwrap();
        }
        conn.execute("INSERT INTO accounts (id, name, kind, opening_balance_kop) VALUES (7, 'Моя карта', 'card', 5000)", []).unwrap();
        conn.execute("INSERT INTO accounts (id, name, kind, status) VALUES (8, 'Старый вклад', 'deposit', 'archived')", []).unwrap();
        conn.execute(
            "INSERT INTO transactions (account_id, direction, title, amount_kop, planned_on) VALUES (7, 'expense', 'Кофе', 300, '2030-01-01')",
            [],
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        let (kind, icon, on, incl): (String, String, String, i64) = conn
            .query_row("SELECT kind, icon, balance_on, include_in_total FROM accounts WHERE id = 7", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap();
        assert_eq!((kind.as_str(), icon.as_str(), on.as_str(), incl), ("debit_card", "card", "1970-01-01", 1));
        let archived: Option<String> = conn.query_row("SELECT archived_at FROM accounts WHERE id = 8", [], |r| r.get(0)).unwrap();
        assert!(archived.is_some());
        let tx: i64 = conn.query_row("SELECT count(*) FROM transactions WHERE account_id = 7", [], |r| r.get(0)).unwrap();
        assert_eq!(tx, 1);
        // Ключи снова включены, ссылки целы.
        let fk: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert!(fk);
        let bad: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(bad, 0);
        assert!(conn.execute("INSERT INTO accounts (name, kind) VALUES ('X', 'card')", []).is_err());
    }
}
