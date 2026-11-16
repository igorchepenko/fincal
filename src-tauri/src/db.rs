//! Схема базы через нумерованные миграции.
//! Версия схемы хранится в `PRAGMA user_version`. Чтобы добавить миграцию:
//! создай `migrations/NNNN_имя.sql` и добавь её в конец списка MIGRATIONS.
//! Уже выпущенные миграции не редактируем.

use rusqlite::Connection;

pub const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_init",
    include_str!("../migrations/0001_init.sql"),
)];

/// Применяет все ещё не применённые миграции, каждую в своей транзакции.
pub fn migrate(conn: &mut Connection) -> rusqlite::Result<u32> {
    let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, (_, sql)) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as u32;
        if version <= current {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
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
}
