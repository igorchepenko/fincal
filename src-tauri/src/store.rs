//! Слой данных: единственное место, где приложение читает и пишет таблицы.
//! Экраны вызывают Tauri-команды (см. `commands.rs`), а те — функции отсюда.
//! Деньги: целые копейки. Моменты времени: UTC. Удаление: мягкое.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const OWNER_ID: i64 = 1;

#[derive(Debug)]
pub enum StoreError {
    Db(rusqlite::Error),
    Invalid(&'static str),
    NotFound,
}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Db(e)
    }
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Db(e) => write!(f, "ошибка базы: {e}"),
            StoreError::Invalid(m) => write!(f, "неверные данные: {m}"),
            StoreError::NotFound => write!(f, "запись не найдена"),
        }
    }
}

impl std::error::Error for StoreError {}

pub type Result<T> = std::result::Result<T, StoreError>;

// ---------- Счета ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub opening_balance_kop: i64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct NewAccount {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub opening_balance_kop: i64,
}

fn account_from_row(r: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        currency: r.get(3)?,
        opening_balance_kop: r.get(4)?,
        status: r.get(5)?,
    })
}

pub fn create_account(conn: &Connection, a: &NewAccount) -> Result<i64> {
    if a.name.trim().is_empty() {
        return Err(StoreError::Invalid("пустое название счёта"));
    }
    conn.execute(
        "INSERT INTO accounts (owner_id, name, kind, opening_balance_kop) VALUES (?1, ?2, ?3, ?4)",
        params![OWNER_ID, a.name.trim(), a.kind, a.opening_balance_kop],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_accounts(conn: &Connection) -> Result<Vec<Account>> {
    let mut st = conn.prepare(
        "SELECT id, name, kind, currency, opening_balance_kop, status FROM accounts
         WHERE owner_id = ?1 AND deleted_at IS NULL ORDER BY sort_order, id",
    )?;
    let rows = st.query_map([OWNER_ID], account_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---------- Категории ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub direction: String,
    pub parent_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct NewCategory {
    pub name: String,
    pub direction: String,
    pub parent_id: Option<i64>,
}

pub fn create_category(conn: &Connection, c: &NewCategory) -> Result<i64> {
    if c.name.trim().is_empty() {
        return Err(StoreError::Invalid("пустое название категории"));
    }
    conn.execute(
        "INSERT INTO categories (owner_id, name, direction, parent_id) VALUES (?1, ?2, ?3, ?4)",
        params![OWNER_ID, c.name.trim(), c.direction, c.parent_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_categories(conn: &Connection) -> Result<Vec<Category>> {
    let mut st = conn.prepare(
        "SELECT id, name, direction, parent_id FROM categories
         WHERE owner_id = ?1 AND deleted_at IS NULL ORDER BY sort_order, id",
    )?;
    let rows = st.query_map([OWNER_ID], |r| {
        Ok(Category {
            id: r.get(0)?,
            name: r.get(1)?,
            direction: r.get(2)?,
            parent_id: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---------- Платежи ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Transaction {
    pub id: i64,
    pub account_id: i64,
    pub to_account_id: Option<i64>,
    pub category_id: Option<i64>,
    pub rule_id: Option<i64>,
    pub direction: String,
    pub title: String,
    pub note: Option<String>,
    pub amount_kop: i64,
    pub actual_amount_kop: Option<i64>,
    pub currency: String,
    pub planned_on: String,
    pub status: String,
    pub completed_at: Option<String>,
    pub tag_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct NewTransaction {
    pub account_id: i64,
    pub to_account_id: Option<i64>,
    pub category_id: Option<i64>,
    pub rule_id: Option<i64>,
    pub direction: String,
    pub title: String,
    pub note: Option<String>,
    pub amount_kop: i64,
    pub planned_on: String,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}

fn is_valid_day(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let num = |r: std::ops::Range<usize>| s[r].parse::<u32>().ok();
    match (num(0..4), num(5..7), num(8..10)) {
        (Some(_), Some(m), Some(d)) => (1..=12).contains(&m) && (1..=31).contains(&d),
        _ => false,
    }
}

pub fn create_transaction(conn: &mut Connection, t: &NewTransaction) -> Result<i64> {
    if t.title.trim().is_empty() {
        return Err(StoreError::Invalid("пустое название платежа"));
    }
    if t.amount_kop <= 0 {
        return Err(StoreError::Invalid("сумма должна быть больше нуля"));
    }
    if !is_valid_day(&t.planned_on) {
        return Err(StoreError::Invalid("дата должна быть в формате ГГГГ-ММ-ДД"));
    }
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO transactions
           (owner_id, account_id, to_account_id, category_id, rule_id, direction, title, note, amount_kop, planned_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            OWNER_ID, t.account_id, t.to_account_id, t.category_id, t.rule_id,
            t.direction, t.title.trim(), t.note, t.amount_kop, t.planned_on
        ],
    )?;
    let id = tx.last_insert_rowid();
    for tag in &t.tag_ids {
        tx.execute(
            "INSERT INTO transaction_tags (owner_id, transaction_id, tag_id) VALUES (?1, ?2, ?3)",
            params![OWNER_ID, id, tag],
        )?;
    }
    tx.commit()?;
    Ok(id)
}

fn tag_ids_of(conn: &Connection, transaction_id: i64) -> Result<Vec<i64>> {
    let mut st = conn.prepare(
        "SELECT tag_id FROM transaction_tags
         WHERE transaction_id = ?1 AND deleted_at IS NULL ORDER BY tag_id",
    )?;
    let rows = st.query_map([transaction_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

const TX_COLUMNS: &str = "id, account_id, to_account_id, category_id, rule_id, direction, title, note,
    amount_kop, actual_amount_kop, currency, planned_on, status, completed_at";

fn tx_from_row(r: &Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: r.get(0)?,
        account_id: r.get(1)?,
        to_account_id: r.get(2)?,
        category_id: r.get(3)?,
        rule_id: r.get(4)?,
        direction: r.get(5)?,
        title: r.get(6)?,
        note: r.get(7)?,
        amount_kop: r.get(8)?,
        actual_amount_kop: r.get(9)?,
        currency: r.get(10)?,
        planned_on: r.get(11)?,
        status: r.get(12)?,
        completed_at: r.get(13)?,
        tag_ids: vec![],
    })
}

pub fn get_transaction(conn: &Connection, id: i64) -> Result<Transaction> {
    let sql = format!(
        "SELECT {TX_COLUMNS} FROM transactions WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL"
    );
    let mut t = conn
        .query_row(&sql, params![id, OWNER_ID], tx_from_row)
        .optional()?
        .ok_or(StoreError::NotFound)?;
    t.tag_ids = tag_ids_of(conn, id)?;
    Ok(t)
}

/// Платежи за период [from, to] включительно (даты ГГГГ-ММ-ДД), по дате и id.
pub fn list_transactions(conn: &Connection, from: &str, to: &str) -> Result<Vec<Transaction>> {
    let sql = format!(
        "SELECT {TX_COLUMNS} FROM transactions
         WHERE owner_id = ?1 AND deleted_at IS NULL AND planned_on BETWEEN ?2 AND ?3
         ORDER BY planned_on, id"
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params![OWNER_ID, from, to], tx_from_row)?;
    let mut out: Vec<Transaction> = rows.collect::<rusqlite::Result<_>>()?;
    for t in &mut out {
        t.tag_ids = tag_ids_of(conn, t.id)?;
    }
    Ok(out)
}

/// Единственный способ сменить статус платежа. Сам выставляет `completed_at`
/// и фактическую сумму: для «выполнен» берётся `actual_amount_kop` или, если её
/// нет, плановая сумма; при возврате в «запланирован» факт сбрасывается.
pub fn set_transaction_status(
    conn: &Connection,
    id: i64,
    status: &str,
    actual_amount_kop: Option<i64>,
) -> Result<()> {
    if let Some(a) = actual_amount_kop {
        if a <= 0 {
            return Err(StoreError::Invalid("сумма должна быть больше нуля"));
        }
    }
    let n = match status {
        "completed" => conn.execute(
            "UPDATE transactions
             SET status = 'completed',
                 completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                 actual_amount_kop = COALESCE(?3, amount_kop)
             WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
            params![id, OWNER_ID, actual_amount_kop],
        )?,
        "planned" | "skipped" => conn.execute(
            "UPDATE transactions
             SET status = ?3, completed_at = NULL, actual_amount_kop = NULL
             WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
            params![id, OWNER_ID, status],
        )?,
        _ => return Err(StoreError::Invalid("неизвестный статус")),
    };
    if n == 0 {
        return Err(StoreError::NotFound);
    }
    Ok(())
}

/// Мягкое удаление платежа (строка остаётся в базе с `deleted_at`).
pub fn delete_transaction(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute(
        "UPDATE transactions SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
        params![id, OWNER_ID],
    )?;
    if n == 0 {
        return Err(StoreError::NotFound);
    }
    Ok(())
}

// ---------- Теги ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

pub fn create_tag(conn: &Connection, name: &str) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(StoreError::Invalid("пустое название тега"));
    }
    conn.execute(
        "INSERT INTO tags (owner_id, name) VALUES (?1, ?2)",
        params![OWNER_ID, name.trim()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>> {
    let mut st = conn.prepare(
        "SELECT id, name FROM tags WHERE owner_id = ?1 AND deleted_at IS NULL ORDER BY name",
    )?;
    let rows = st.query_map([OWNER_ID], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Заменяет набор тегов платежа. Снятые теги помечаются deleted_at, снятый тег
/// можно вернуть: строка связи оживает.
pub fn set_transaction_tags(conn: &mut Connection, transaction_id: i64, tag_ids: &[i64]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE transaction_tags SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE transaction_id = ?1 AND deleted_at IS NULL",
        [transaction_id],
    )?;
    for tag in tag_ids {
        tx.execute(
            "INSERT INTO transaction_tags (owner_id, transaction_id, tag_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(transaction_id, tag_id) DO UPDATE SET deleted_at = NULL",
            params![OWNER_ID, transaction_id, tag],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ---------- Правила повторения ----------

#[derive(Debug, Deserialize)]
pub struct NewRule {
    pub frequency: String,
    #[serde(default = "one")]
    pub interval_n: i64,
    pub starts_on: String,
    pub ends_on: Option<String>,
}

fn one() -> i64 {
    1
}

pub fn create_rule(conn: &Connection, r: &NewRule) -> Result<i64> {
    if !is_valid_day(&r.starts_on) || r.ends_on.as_deref().is_some_and(|d| !is_valid_day(d)) {
        return Err(StoreError::Invalid("дата должна быть в формате ГГГГ-ММ-ДД"));
    }
    conn.execute(
        "INSERT INTO recurrence_rules (owner_id, frequency, interval_n, starts_on, ends_on)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![OWNER_ID, r.frequency, r.interval_n, r.starts_on, r.ends_on],
    )?;
    Ok(conn.last_insert_rowid())
}

// ---------- Настройки ----------

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM settings WHERE owner_id = ?1 AND key = ?2 AND deleted_at IS NULL",
            params![OWNER_ID, key],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (owner_id, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value, deleted_at = NULL",
        params![OWNER_ID, key, value],
    )?;
    Ok(())
}

// ---------- Остатки ----------

/// Текущий остаток счёта в копейках: начальный + выполненные платежи.
/// Для выполненных берётся фактическая сумма (если нет, плановая).
pub fn account_balance_kop(conn: &Connection, account_id: i64) -> Result<i64> {
    let opening: i64 = conn
        .query_row(
            "SELECT opening_balance_kop FROM accounts WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
            params![account_id, OWNER_ID],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(StoreError::NotFound)?;
    let delta: i64 = conn.query_row(
        "SELECT COALESCE(SUM(CASE
            WHEN direction = 'income'  AND account_id    = ?1 THEN  COALESCE(actual_amount_kop, amount_kop)
            WHEN direction = 'expense' AND account_id    = ?1 THEN -COALESCE(actual_amount_kop, amount_kop)
            WHEN direction = 'transfer' AND account_id   = ?1 THEN -COALESCE(actual_amount_kop, amount_kop)
            WHEN direction = 'transfer' AND to_account_id = ?1 THEN  COALESCE(actual_amount_kop, amount_kop)
            ELSE 0 END), 0)
         FROM transactions
         WHERE owner_id = ?2 AND deleted_at IS NULL AND status = 'completed'
           AND (account_id = ?1 OR to_account_id = ?1)",
        params![account_id, OWNER_ID],
        |r| r.get(0),
    )?;
    Ok(opening + delta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    fn account(conn: &Connection, name: &str, kind: &str, opening: i64) -> i64 {
        create_account(conn, &NewAccount { name: name.into(), kind: kind.into(), opening_balance_kop: opening }).unwrap()
    }

    fn new_tx(account_id: i64, direction: &str, amount: i64, day: &str) -> NewTransaction {
        NewTransaction {
            account_id,
            to_account_id: None,
            category_id: None,
            rule_id: None,
            direction: direction.into(),
            title: "Тест".into(),
            note: None,
            amount_kop: amount,
            planned_on: day.into(),
            tag_ids: vec![],
        }
    }

    #[test]
    fn default_owner_exists_and_currency_is_rub() {
        let conn = fresh();
        let id = account(&conn, "Карта", "card", 0);
        let a = list_accounts(&conn).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].id, id);
        assert_eq!(a[0].currency, "RUB");
    }

    #[test]
    fn rejects_bad_input() {
        let mut conn = fresh();
        let acc = account(&conn, "Карта", "card", 0);
        assert!(create_account(&conn, &NewAccount { name: " ".into(), kind: "card".into(), opening_balance_kop: 0 }).is_err());
        assert!(create_account(&conn, &NewAccount { name: "X".into(), kind: "crypto".into(), opening_balance_kop: 0 }).is_err());
        assert!(create_transaction(&mut conn, &new_tx(acc, "expense", 0, "2030-01-10")).is_err());
        assert!(create_transaction(&mut conn, &new_tx(acc, "expense", -5, "2030-01-10")).is_err());
        assert!(create_transaction(&mut conn, &new_tx(acc, "expense", 100, "10.01.2030")).is_err());
        // Несуществующий счёт: внешний ключ не даёт создать платёж.
        assert!(create_transaction(&mut conn, &new_tx(999, "expense", 100, "2030-01-10")).is_err());
        // Перевод без второго счёта запрещён на уровне базы.
        assert!(create_transaction(&mut conn, &new_tx(acc, "transfer", 100, "2030-01-10")).is_err());
    }

    #[test]
    fn transaction_roundtrip_with_tags_and_period_filter() {
        let mut conn = fresh();
        let acc = account(&conn, "Карта", "card", 0);
        let cat = create_category(&conn, &NewCategory { name: "Продукты".into(), direction: "expense".into(), parent_id: None }).unwrap();
        let tag = create_tag(&conn, "семья").unwrap();
        let mut t = new_tx(acc, "expense", 150_000, "2030-02-05");
        t.category_id = Some(cat);
        t.tag_ids = vec![tag];
        let id = create_transaction(&mut conn, &t).unwrap();
        create_transaction(&mut conn, &new_tx(acc, "income", 5_000_000, "2030-03-01")).unwrap();

        let feb = list_transactions(&conn, "2030-02-01", "2030-02-28").unwrap();
        assert_eq!(feb.len(), 1);
        assert_eq!(feb[0].id, id);
        assert_eq!(feb[0].amount_kop, 150_000);
        assert_eq!(feb[0].status, "planned");
        assert_eq!(feb[0].tag_ids, vec![tag]);
        assert_eq!(list_transactions(&conn, "2030-02-01", "2030-03-31").unwrap().len(), 2);
    }

    #[test]
    fn status_change_sets_and_clears_completed_at() {
        let mut conn = fresh();
        let acc = account(&conn, "Карта", "card", 0);
        let id = create_transaction(&mut conn, &new_tx(acc, "expense", 10_000, "2030-02-05")).unwrap();

        set_transaction_status(&conn, id, "completed", Some(9_950)).unwrap();
        let t = get_transaction(&conn, id).unwrap();
        assert_eq!(t.status, "completed");
        assert!(t.completed_at.as_deref().is_some_and(|s| s.ends_with('Z') && s.len() == 20));
        assert_eq!(t.actual_amount_kop, Some(9_950));
        assert_eq!(t.amount_kop, 10_000);

        set_transaction_status(&conn, id, "planned", None).unwrap();
        let t = get_transaction(&conn, id).unwrap();
        assert_eq!(t.status, "planned");
        assert_eq!(t.completed_at, None);
        assert_eq!(t.actual_amount_kop, None);

        set_transaction_status(&conn, id, "completed", None).unwrap();
        assert_eq!(get_transaction(&conn, id).unwrap().actual_amount_kop, Some(10_000));

        assert!(set_transaction_status(&conn, id, "done", None).is_err());
        assert!(matches!(set_transaction_status(&conn, 777, "completed", None), Err(StoreError::NotFound)));
        // Прямая правка статуса мимо функции нарушает проверку базы.
        assert!(conn.execute("UPDATE transactions SET status = 'completed', completed_at = NULL WHERE id = ?1", [id]).is_err());
    }

    #[test]
    fn soft_delete_hides_but_keeps_row() {
        let mut conn = fresh();
        let acc = account(&conn, "Карта", "card", 0);
        let id = create_transaction(&mut conn, &new_tx(acc, "expense", 100, "2030-02-05")).unwrap();
        delete_transaction(&conn, id).unwrap();
        assert!(list_transactions(&conn, "2030-01-01", "2030-12-31").unwrap().is_empty());
        assert!(matches!(get_transaction(&conn, id), Err(StoreError::NotFound)));
        let (cnt, deleted): (i64, Option<String>) = conn
            .query_row("SELECT COUNT(*), MAX(deleted_at) FROM transactions", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(cnt, 1);
        assert!(deleted.is_some());
        assert!(matches!(delete_transaction(&conn, id), Err(StoreError::NotFound)));
    }

    #[test]
    fn balances_across_accounts_and_transfer() {
        let mut conn = fresh();
        let card = account(&conn, "Карта", "card", 100_000);
        let cash = account(&conn, "Наличные", "cash", 0);
        let deposit = account(&conn, "Вклад", "deposit", 1_000_000);

        let salary = create_transaction(&mut conn, &new_tx(card, "income", 500_000, "2030-02-01")).unwrap();
        let shop = create_transaction(&mut conn, &new_tx(card, "expense", 30_000, "2030-02-02")).unwrap();
        let planned_only = create_transaction(&mut conn, &new_tx(card, "expense", 999_999, "2030-02-03")).unwrap();
        let mut tr = new_tx(card, "transfer", 200_000, "2030-02-04");
        tr.to_account_id = Some(cash);
        let transfer = create_transaction(&mut conn, &tr).unwrap();
        for id in [salary, shop, transfer] {
            set_transaction_status(&conn, id, "completed", None).unwrap();
        }
        let _ = planned_only; // плановый платёж на остаток не влияет

        assert_eq!(account_balance_kop(&conn, card).unwrap(), 100_000 + 500_000 - 30_000 - 200_000);
        assert_eq!(account_balance_kop(&conn, cash).unwrap(), 200_000);
        assert_eq!(account_balance_kop(&conn, deposit).unwrap(), 1_000_000);
        assert!(matches!(account_balance_kop(&conn, 424242), Err(StoreError::NotFound)));
    }

    #[test]
    fn tags_replace_and_restore() {
        let mut conn = fresh();
        let acc = account(&conn, "Карта", "card", 0);
        let id = create_transaction(&mut conn, &new_tx(acc, "expense", 100, "2030-02-05")).unwrap();
        let a = create_tag(&conn, "работа").unwrap();
        let b = create_tag(&conn, "отпуск").unwrap();
        assert!(create_tag(&conn, "работа").is_err(), "имена тегов уникальны");

        set_transaction_tags(&mut conn, id, &[a, b]).unwrap();
        assert_eq!(get_transaction(&conn, id).unwrap().tag_ids, vec![a, b]);
        set_transaction_tags(&mut conn, id, &[b]).unwrap();
        assert_eq!(get_transaction(&conn, id).unwrap().tag_ids, vec![b]);
        set_transaction_tags(&mut conn, id, &[a, b]).unwrap();
        assert_eq!(get_transaction(&conn, id).unwrap().tag_ids, vec![a, b]);
    }

    #[test]
    fn recurrence_rule_links_and_prevents_duplicates() {
        let mut conn = fresh();
        let acc = account(&conn, "Карта", "card", 0);
        let rule = create_rule(&conn, &NewRule { frequency: "monthly".into(), interval_n: 1, starts_on: "2030-01-15".into(), ends_on: None }).unwrap();
        assert!(create_rule(&conn, &NewRule { frequency: "hourly".into(), interval_n: 1, starts_on: "2030-01-15".into(), ends_on: None }).is_err());
        let mut t = new_tx(acc, "expense", 4_500_000, "2030-01-15");
        t.rule_id = Some(rule);
        create_transaction(&mut conn, &t).unwrap();
        assert!(create_transaction(&mut conn, &t).is_err(), "дубль по правилу и дню");
        t.planned_on = "2030-02-15".into();
        create_transaction(&mut conn, &t).unwrap();
    }

    #[test]
    fn settings_are_key_value() {
        let conn = fresh();
        assert_eq!(get_setting(&conn, "theme").unwrap(), None);
        set_setting(&conn, "theme", "dark").unwrap();
        set_setting(&conn, "theme", "light").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap().as_deref(), Some("light"));
    }

    #[test]
    fn updated_at_trigger_and_timestamps_are_utc() {
        let conn = fresh();
        let id = account(&conn, "Карта", "card", 0);
        conn.execute("UPDATE accounts SET created_at = '2000-01-01T00:00:00Z', updated_at = '2000-01-01T00:00:00Z' WHERE id = ?1", [id]).unwrap();
        conn.execute("UPDATE accounts SET name = 'Зарплатная' WHERE id = ?1", [id]).unwrap();
        let (c, u): (String, String) = conn
            .query_row("SELECT created_at, updated_at FROM accounts WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(c, "2000-01-01T00:00:00Z");
        assert!(u.as_str() > "2020" && u.ends_with('Z'), "updated_at обновился: {u}");
    }

    #[test]
    fn every_data_table_has_owner_and_timestamps() {
        let conn = fresh();
        for table in ["accounts", "categories", "recurrence_rules", "transactions", "tags", "transaction_tags", "settings"] {
            let cols: Vec<String> = conn
                .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            for c in ["owner_id", "created_at", "updated_at", "deleted_at"] {
                assert!(cols.iter().any(|x| x == c), "{table}.{c}");
            }
        }
    }
}
