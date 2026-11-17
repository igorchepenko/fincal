//! Профили: имя и раздельные данные. Профиль хранится как строка `owners`,
//! все остальные таблицы ссылаются на неё через `owner_id`.
//! Какой профиль открыт сейчас, запоминается в `app_meta` (общая настройка приложения).
//! Другие модули получают текущего владельца одним вызовом `current_owner_id`.

use crate::store::{Result, StoreError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const CURRENT_KEY: &str = "current_owner_id";
const MAX_NAME_CHARS: usize = 40;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Profile {
    pub id: i64,
    pub name: String,
}

fn clean_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(StoreError::Invalid("пустое имя профиля"));
    }
    if n.chars().count() > MAX_NAME_CHARS {
        return Err(StoreError::Invalid("имя профиля длиннее 40 символов"));
    }
    Ok(n.to_string())
}

pub fn list_profiles(conn: &Connection) -> Result<Vec<Profile>> {
    let mut st = conn.prepare("SELECT id, name FROM owners WHERE deleted_at IS NULL ORDER BY id")?;
    let rows = st.query_map([], |r| Ok(Profile { id: r.get(0)?, name: r.get(1)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn ensure_name_free(conn: &Connection, name: &str, except_id: Option<i64>) -> Result<()> {
    let wanted = name.to_lowercase();
    let taken = list_profiles(conn)?
        .into_iter()
        .any(|p| Some(p.id) != except_id && p.name.to_lowercase() == wanted);
    if taken {
        Err(StoreError::Invalid("профиль с таким именем уже есть"))
    } else {
        Ok(())
    }
}

fn exists(conn: &Connection, id: i64) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM owners WHERE id = ?1 AND deleted_at IS NULL", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

fn write_current(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![CURRENT_KEY, id.to_string()],
    )?;
    Ok(())
}

/// Id текущего профиля: по нему другие модули отбирают данные (`owner_id`).
/// Если запомненного профиля нет или он удалён, берётся первый живой и запоминается.
/// Если живых профилей нет совсем (база правилась вручную), создаётся профиль «Я».
pub fn current_owner_id(conn: &Connection) -> Result<i64> {
    let saved: Option<i64> = conn
        .query_row("SELECT value FROM app_meta WHERE key = ?1", [CURRENT_KEY], |r| r.get::<_, String>(0))
        .optional()?
        .and_then(|v| v.parse().ok());
    if let Some(id) = saved {
        if exists(conn, id)? {
            return Ok(id);
        }
    }
    let id = match list_profiles(conn)?.first() {
        Some(p) => p.id,
        None => create_profile(conn, "Я")?,
    };
    write_current(conn, id)?;
    Ok(id)
}

pub fn current_profile(conn: &Connection) -> Result<Profile> {
    let id = current_owner_id(conn)?;
    list_profiles(conn)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or(StoreError::NotFound)
}

pub fn switch_profile(conn: &Connection, id: i64) -> Result<()> {
    if !exists(conn, id)? {
        return Err(StoreError::NotFound);
    }
    write_current(conn, id)
}

pub fn create_profile(conn: &Connection, name: &str) -> Result<i64> {
    let name = clean_name(name)?;
    ensure_name_free(conn, &name, None)?;
    conn.execute("INSERT INTO owners (name) VALUES (?1)", [&name])?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_profile(conn: &Connection, id: i64, name: &str) -> Result<()> {
    let name = clean_name(name)?;
    ensure_name_free(conn, &name, Some(id))?;
    let n = conn.execute(
        "UPDATE owners SET name = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, name],
    )?;
    if n == 0 {
        return Err(StoreError::NotFound);
    }
    Ok(())
}

/// Мягкое удаление: профиль скрывается, его данные остаются в базе (`owner_id` не трогаем).
/// Последний живой профиль удалить нельзя. Если удалён текущий, открывается первый из оставшихся.
/// Возвращает id профиля, который теперь текущий.
pub fn delete_profile(conn: &Connection, id: i64) -> Result<i64> {
    let alive = list_profiles(conn)?;
    if !alive.iter().any(|p| p.id == id) {
        return Err(StoreError::NotFound);
    }
    if alive.len() == 1 {
        return Err(StoreError::Invalid("нельзя удалить единственный профиль"));
    }
    conn.execute(
        "UPDATE owners SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1",
        [id],
    )?;
    current_owner_id(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::store::{self, NewAccount};

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    fn account(conn: &Connection, owner: i64, name: &str) -> i64 {
        store::create_account(conn, owner, &NewAccount { name: name.into(), kind: "card".into(), opening_balance_kop: 0 }).unwrap()
    }

    #[test]
    fn first_launch_has_default_profile_selected() {
        let conn = fresh();
        let list = list_profiles(&conn).unwrap();
        assert_eq!(list, vec![Profile { id: 1, name: "Я".into() }]);
        assert_eq!(current_owner_id(&conn).unwrap(), 1);
        assert_eq!(current_profile(&conn).unwrap().name, "Я");
    }

    #[test]
    fn create_validates_and_rejects_duplicates_ignoring_case() {
        let conn = fresh();
        assert!(create_profile(&conn, "  ").is_err());
        assert!(create_profile(&conn, &"а".repeat(41)).is_err());
        let id = create_profile(&conn, "  Маша ").unwrap();
        assert!(list_profiles(&conn).unwrap().iter().any(|p| p.id == id && p.name == "Маша"));
        assert!(create_profile(&conn, "маша").is_err(), "кириллица без учёта регистра");
        assert!(create_profile(&conn, "Я").is_err());
    }

    #[test]
    fn rename_keeps_data_and_checks_names() {
        let conn = fresh();
        let anna = create_profile(&conn, "Анна").unwrap();
        account(&conn, anna, "Карта Анны");
        rename_profile(&conn, anna, "Анна К.").unwrap();
        assert_eq!(store::list_accounts(&conn, anna).unwrap().len(), 1);
        assert!(rename_profile(&conn, anna, "Я").is_err());
        rename_profile(&conn, anna, "АННА К.").unwrap(); // свой же имя в другом регистре можно
        assert!(rename_profile(&conn, anna, " ").is_err());
        assert!(matches!(rename_profile(&conn, 999, "Кто-то"), Err(StoreError::NotFound)));
    }

    #[test]
    fn switch_is_remembered_and_validated() {
        let conn = fresh();
        let b = create_profile(&conn, "Борис").unwrap();
        assert_eq!(current_owner_id(&conn).unwrap(), 1, "создание не переключает");
        switch_profile(&conn, b).unwrap();
        assert_eq!(current_owner_id(&conn).unwrap(), b);
        assert!(matches!(switch_profile(&conn, 999), Err(StoreError::NotFound)));
        assert_eq!(current_owner_id(&conn).unwrap(), b);
    }

    #[test]
    fn data_of_profiles_is_fully_separate() {
        let mut conn = fresh();
        let b = create_profile(&conn, "Борис").unwrap();
        let acc_a = account(&conn, 1, "Моя карта");
        let acc_b = account(&conn, b, "Карта Бориса");
        let cat_a = store::create_category(&conn, 1, &store::NewCategory { name: "Еда".into(), direction: "expense".into(), parent_id: None }).unwrap();
        let tag_a = store::create_tag(&conn, 1, "семья").unwrap();
        store::create_tag(&conn, b, "семья").unwrap(); // то же имя тега у другого профиля допустимо
        store::set_setting(&conn, 1, "theme", "dark").unwrap();

        assert_eq!(store::list_accounts(&conn, 1).unwrap().len(), 1);
        assert_eq!(store::list_accounts(&conn, b).unwrap()[0].id, acc_b);
        assert!(store::list_categories(&conn, b).unwrap().is_empty());
        assert_eq!(store::get_setting(&conn, b, "theme").unwrap(), None);

        let tx = |account_id, category_id| store::NewTransaction {
            account_id, to_account_id: None, category_id, rule_id: None, direction: "expense".into(),
            title: "Тест".into(), note: None, amount_kop: 100, planned_on: "2030-01-10".into(), tag_ids: vec![],
        };
        let id_a = store::create_transaction(&mut conn, 1, &tx(acc_a, Some(cat_a))).unwrap();
        // Чужие счёт и категория подставить нельзя.
        assert!(store::create_transaction(&mut conn, b, &tx(acc_a, None)).is_err());
        assert!(store::create_transaction(&mut conn, b, &tx(acc_b, Some(cat_a))).is_err());
        assert!(store::list_transactions(&conn, b, "2030-01-01", "2030-12-31").unwrap().is_empty());
        assert!(matches!(store::get_transaction(&conn, b, id_a), Err(StoreError::NotFound)));
        assert!(matches!(store::delete_transaction(&conn, b, id_a), Err(StoreError::NotFound)));
        assert!(matches!(store::set_transaction_status(&conn, b, id_a, "completed", None), Err(StoreError::NotFound)));
        assert!(matches!(store::account_balance_kop(&conn, b, acc_a), Err(StoreError::NotFound)));
        assert!(store::set_transaction_tags(&mut conn, b, id_a, &[]).is_err());
        assert!(store::set_transaction_tags(&mut conn, 1, id_a, &[tag_a]).is_ok());
        assert_eq!(store::list_transactions(&conn, 1, "2030-01-01", "2030-12-31").unwrap().len(), 1);
    }

    #[test]
    fn delete_is_soft_and_moves_current() {
        let conn = fresh();
        let b = create_profile(&conn, "Борис").unwrap();
        account(&conn, b, "Карта Бориса");
        switch_profile(&conn, b).unwrap();

        let now_current = delete_profile(&conn, b).unwrap();
        assert_eq!(now_current, 1);
        assert_eq!(current_owner_id(&conn).unwrap(), 1);
        assert_eq!(list_profiles(&conn).unwrap().len(), 1);
        assert!(matches!(switch_profile(&conn, b), Err(StoreError::NotFound)));
        assert!(matches!(delete_profile(&conn, b), Err(StoreError::NotFound)));

        // Строки остаются в базе.
        let (cnt, deleted): (i64, Option<String>) = conn
            .query_row("SELECT COUNT(*), MAX(deleted_at) FROM owners WHERE id = ?1", [b], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(cnt, 1);
        assert!(deleted.is_some_and(|s| s.ends_with('Z')));
        let kept: i64 = conn.query_row("SELECT COUNT(*) FROM accounts WHERE owner_id = ?1", [b], |r| r.get(0)).unwrap();
        assert_eq!(kept, 1);

        // Имя удалённого профиля освобождается.
        create_profile(&conn, "Борис").unwrap();
    }

    #[test]
    fn last_profile_cannot_be_deleted() {
        let conn = fresh();
        assert!(delete_profile(&conn, 1).is_err());
        assert_eq!(list_profiles(&conn).unwrap().len(), 1);
    }

    #[test]
    fn current_falls_back_when_saved_profile_is_gone() {
        let conn = fresh();
        let b = create_profile(&conn, "Борис").unwrap();
        switch_profile(&conn, b).unwrap();
        conn.execute("UPDATE owners SET deleted_at = '2030-01-01T00:00:00Z' WHERE id = ?1", [b]).unwrap();
        assert_eq!(current_owner_id(&conn).unwrap(), 1);
        conn.execute("UPDATE app_meta SET value = 'мусор' WHERE key = 'current_owner_id'", []).unwrap();
        assert_eq!(current_owner_id(&conn).unwrap(), 1);
    }
}
