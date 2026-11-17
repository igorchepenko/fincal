//! Платежи: создание (в том числе серии), список по месяцам, правка и удаление
//! «только этот» / «этот и все следующие». Всё пишет в базу через `store`-таблицы,
//! расчёт дат серии делает `recurrence`.
//!
//! Правила:
//! * тип платежа: `income` (поступление) или `expense` (списание);
//! * сумма в копейках, дата это календарный день `ГГГГ-ММ-ДД`;
//! * статус меняется только через `store::set_transaction_status` (команда
//!   `set_transaction_status`), баланс счёта считают только выполненные платежи;
//! * серия это правило (`recurrence_rules`) и столько строк `transactions`, сколько дат
//!   попало в период; каждая строка живёт сама (у неё свой статус, сумма, комментарий);
//! * «все следующие» никогда не трогает платежи, которые уже выполнены или пропущены,
//!   и платежи до выбранной даты.

use crate::recurrence::{weekday_code, weekday_from_code, Date, Freq, Rule, RuleError};
use crate::store::{self, require, tx_from_row, Result, StoreError, Transaction, TX_COLUMNS};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

const MAX_TITLE_CHARS: usize = 200;
const MAX_NOTE_CHARS: usize = 2000;
/// 100 млрд рублей в копейках: защита от опечатки и от переполнения сумм.
const MAX_AMOUNT_KOP: i64 = 10_000_000_000_000;

fn rule_err(e: RuleError) -> StoreError {
    StoreError::Invalid(e.message())
}

fn parse_day(s: &str) -> Result<Date> {
    Date::parse(s).ok_or_else(|| rule_err(RuleError::BadDate))
}

fn day_text(d: Date) -> String {
    d.to_string()
}

// ---------- Типы ----------

/// Повторяемость, как её задаёт экран.
#[derive(Debug, Clone, Deserialize)]
pub struct RecurrenceSpec {
    /// `daily`, `weekly`, `monthly` или `yearly`.
    pub frequency: String,
    /// Каждые N дней/недель/месяцев/лет, по умолчанию 1.
    #[serde(default = "one")]
    pub interval: i64,
    /// Дни недели `MO`…`SU` (только для `weekly`); пусто = день недели первого платежа.
    #[serde(default)]
    pub weekdays: Vec<String>,
    /// Числа месяца 1..=31 или -1 = последний день (только для `monthly`); пусто = число первого платежа.
    /// Если числа в месяце нет, платёж переносится на последний день месяца.
    #[serde(default)]
    pub month_days: Vec<i32>,
    /// Начало периода. При создании обязательно; при правке серии: с какой даты начать новую серию.
    pub starts_on: Option<String>,
    /// Конец периода (включительно). При создании обязателен; при правке по умолчанию берётся прежний.
    pub ends_on: Option<String>,
}

fn one() -> i64 {
    1
}

/// Правило серии, как его показывает экран.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RecurrenceInfo {
    pub rule_id: i64,
    pub rrule: String,
    pub frequency: String,
    pub interval: u32,
    pub weekdays: Vec<String>,
    pub month_days: Vec<i32>,
    pub starts_on: String,
    pub ends_on: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewPayment {
    pub title: String,
    /// `income` или `expense`.
    pub direction: String,
    pub amount_kop: i64,
    pub account_id: i64,
    /// Дата одиночного платежа. Для серии не нужна: даты задаёт `recurrence`.
    pub planned_on: Option<String>,
    pub note: Option<String>,
    pub recurrence: Option<RecurrenceSpec>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct CreatedPayments {
    /// Правило серии (нет у одиночного платежа).
    pub rule_id: Option<i64>,
    /// Сколько платежей создано.
    pub count: usize,
    /// Id первого (самого раннего) созданного платежа.
    pub first_id: i64,
}

/// Правка платежа: передаются только изменяемые поля.
#[derive(Debug, Default, Deserialize)]
pub struct PaymentPatch {
    pub title: Option<String>,
    pub direction: Option<String>,
    pub amount_kop: Option<i64>,
    pub account_id: Option<i64>,
    /// Новая дата. При «только этот» переносит один платёж; при «этот и все следующие»
    /// это начало новой серии (она заменяет серию с выбранной даты).
    pub planned_on: Option<String>,
    /// Комментарий; пустая строка очищает его.
    pub note: Option<String>,
    /// Новое правило повторения: только для «этот и все следующие» у платежа из серии.
    pub recurrence: Option<RecurrenceSpec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    /// Только выбранный платёж.
    This,
    /// Выбранный и все следующие платежи серии.
    Following,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct UpdateResult {
    /// Сколько платежей изменено (при «этот и все следующие» с новой серией: сколько создано).
    pub changed: usize,
    /// Id новой серии, если старая была разбита.
    pub new_rule_id: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct PaymentFilter {
    pub from: String,
    pub to: String,
    pub account_id: Option<i64>,
    pub direction: Option<String>,
    pub status: Option<String>,
    /// Только платежи одной серии (событие-серия).
    pub rule_id: Option<i64>,
    /// Только один платёж (событие-разовый платёж).
    pub payment_id: Option<i64>,
}

#[derive(Debug, Default, Serialize, PartialEq)]
pub struct MonthTotals {
    pub count: usize,
    pub skipped_count: usize,
    /// Запланированные поступления и списания (плановая сумма).
    pub planned_income_kop: i64,
    pub planned_expense_kop: i64,
    /// Выполненные (фактическая сумма, а если её нет, плановая).
    pub completed_income_kop: i64,
    pub completed_expense_kop: i64,
}

#[derive(Debug, Serialize)]
pub struct MonthGroup {
    /// `ГГГГ-ММ`.
    pub month: String,
    pub totals: MonthTotals,
    pub payments: Vec<Transaction>,
}

#[derive(Debug, Serialize)]
pub struct PaymentList {
    /// Месяцы по возрастанию; месяцы без платежей не возвращаются.
    pub months: Vec<MonthGroup>,
    /// Правила серий, встретившихся в списке (по `rule_id` платежа).
    pub rules: Vec<RecurrenceInfo>,
    pub total_count: usize,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct RecurrencePreview {
    pub count: usize,
    pub first: Option<String>,
    pub last: Option<String>,
    /// Первые даты (до 60) для подсказки на экране.
    pub dates: Vec<String>,
}

// ---------- Проверки ----------

fn check_title(t: &str) -> Result<String> {
    let t = t.trim();
    if t.is_empty() {
        return Err(StoreError::Invalid("пустое название платежа"));
    }
    if t.chars().count() > MAX_TITLE_CHARS {
        return Err(StoreError::Invalid("название платежа длиннее 200 символов"));
    }
    Ok(t.to_string())
}

fn check_direction(d: &str) -> Result<()> {
    if d == "income" || d == "expense" {
        Ok(())
    } else {
        Err(StoreError::Invalid("тип платежа: поступление (income) или списание (expense)"))
    }
}

fn check_amount(a: i64) -> Result<()> {
    if a <= 0 {
        return Err(StoreError::Invalid("сумма должна быть больше нуля"));
    }
    if a > MAX_AMOUNT_KOP {
        return Err(StoreError::Invalid("слишком большая сумма"));
    }
    Ok(())
}

/// Комментарий: пустой после обрезки пробелов = нет комментария.
fn check_note(n: &str) -> Result<Option<String>> {
    let n = n.trim();
    if n.chars().count() > MAX_NOTE_CHARS {
        return Err(StoreError::Invalid("комментарий длиннее 2000 символов"));
    }
    Ok(if n.is_empty() { None } else { Some(n.to_string()) })
}

/// Счёт принадлежит профилю и не в архиве.
fn check_account(conn: &Connection, owner: i64, id: i64) -> Result<()> {
    require(conn, "accounts", id, owner, "счёт не найден")?;
    let archived: bool = conn.query_row("SELECT status = 'archived' FROM accounts WHERE id = ?1", [id], |r| r.get(0))?;
    if archived {
        return Err(StoreError::Invalid("счёт в архиве"));
    }
    Ok(())
}

fn build_rule(spec: &RecurrenceSpec) -> Result<Rule> {
    let freq = Freq::parse(&spec.frequency).ok_or(StoreError::Invalid("частота: daily, weekly, monthly или yearly"))?;
    let weekdays = spec
        .weekdays
        .iter()
        .map(|c| weekday_from_code(c.trim()).ok_or(rule_err(RuleError::BadWeekday)))
        .collect::<Result<Vec<u32>>>()?;
    Rule::new(freq, spec.interval, &weekdays, &spec.month_days).map_err(rule_err)
}

/// Подсказка для экрана: сколько платежей даст повторяемость и на какие даты (ничего не пишет).
pub fn preview_recurrence(spec: &RecurrenceSpec) -> Result<RecurrencePreview> {
    let rule = build_rule(spec)?;
    let start = parse_day(spec.starts_on.as_deref().ok_or(StoreError::Invalid("укажи начало периода"))?)?;
    let end = parse_day(spec.ends_on.as_deref().ok_or(StoreError::Invalid("укажи конец периода"))?)?;
    let dates = rule.occurrences(start, end).map_err(rule_err)?;
    Ok(RecurrencePreview {
        count: dates.len(),
        first: dates.first().map(|d| day_text(*d)),
        last: dates.last().map(|d| day_text(*d)),
        dates: dates.iter().take(60).map(|d| day_text(*d)).collect(),
    })
}

// ---------- Запись серии ----------

/// Поля, общие для всех платежей серии.
struct Template {
    account_id: i64,
    direction: String,
    title: String,
    note: Option<String>,
    amount_kop: i64,
}

fn insert_rule(conn: &Connection, owner: i64, rule: &Rule, start: Date, end: Date) -> Result<i64> {
    conn.execute(
        "INSERT INTO recurrence_rules (owner_id, frequency, interval_n, rrule, starts_on, ends_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![owner, rule.freq.as_str(), rule.interval, rule.to_rrule(), day_text(start), day_text(end)],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Вставляет платежи серии одной подготовленной командой (вызывать внутри транзакции).
/// Возвращает id первого. `tag_ids` копируются на каждый платёж.
fn insert_series(conn: &Connection, owner: i64, rule_id: Option<i64>, dates: &[Date], t: &Template, tag_ids: &[i64]) -> Result<i64> {
    let mut ins = conn.prepare_cached(
        "INSERT INTO transactions (owner_id, account_id, rule_id, direction, title, note, amount_kop, planned_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    let mut tag = conn.prepare_cached("INSERT INTO transaction_tags (owner_id, transaction_id, tag_id) VALUES (?1, ?2, ?3)")?;
    let mut first = 0;
    for (i, d) in dates.iter().enumerate() {
        ins.execute(params![owner, t.account_id, rule_id, t.direction, t.title, t.note, t.amount_kop, day_text(*d)])?;
        let id = conn.last_insert_rowid();
        if i == 0 {
            first = id;
        }
        for tg in tag_ids {
            tag.execute(params![owner, id, tg])?;
        }
    }
    Ok(first)
}

/// Создаёт одиночный платёж или всю серию за один раз (одна транзакция базы).
pub fn create_payment(conn: &mut Connection, owner: i64, p: &NewPayment) -> Result<CreatedPayments> {
    let title = check_title(&p.title)?;
    check_direction(&p.direction)?;
    check_amount(p.amount_kop)?;
    let note = match &p.note {
        Some(n) => check_note(n)?,
        None => None,
    };
    check_account(conn, owner, p.account_id)?;
    let tpl = Template { account_id: p.account_id, direction: p.direction.clone(), title, note, amount_kop: p.amount_kop };

    match &p.recurrence {
        None => {
            let day = parse_day(p.planned_on.as_deref().ok_or(StoreError::Invalid("укажи дату платежа"))?)?;
            let tx = conn.transaction()?;
            let first_id = insert_series(&tx, owner, None, &[day], &tpl, &[])?;
            tx.commit()?;
            Ok(CreatedPayments { rule_id: None, count: 1, first_id })
        }
        Some(spec) => {
            let rule = build_rule(spec)?;
            let start = parse_day(spec.starts_on.as_deref().ok_or(StoreError::Invalid("укажи начало периода"))?)?;
            let end = parse_day(spec.ends_on.as_deref().ok_or(StoreError::Invalid("укажи конец периода"))?)?;
            let dates = rule.occurrences(start, end).map_err(rule_err)?;
            if dates.is_empty() {
                return Err(rule_err(RuleError::Empty));
            }
            let tx = conn.transaction()?;
            let rule_id = insert_rule(&tx, owner, &rule, start, end)?;
            let first_id = insert_series(&tx, owner, Some(rule_id), &dates, &tpl, &[])?;
            tx.commit()?;
            Ok(CreatedPayments { rule_id: Some(rule_id), count: dates.len(), first_id })
        }
    }
}

// ---------- Чтение ----------

fn rule_info(rule_id: i64, rrule: &str, freq: &str, interval: u32, starts_on: String, ends_on: Option<String>) -> RecurrenceInfo {
    // Строку разбираем, чтобы отдать экрану готовые поля. Если разобрать не вышло
    // (чужая запись), отдаём колонки как есть.
    match Rule::parse(rrule) {
        Ok(r) => RecurrenceInfo {
            rule_id,
            rrule: r.to_rrule(),
            frequency: r.freq.as_str().to_string(),
            interval: r.interval,
            weekdays: r.weekdays.iter().map(|d| weekday_code(*d).to_string()).collect(),
            month_days: r.month_days,
            starts_on,
            ends_on,
        },
        Err(_) => RecurrenceInfo { rule_id, rrule: rrule.to_string(), frequency: freq.to_string(), interval, weekdays: vec![], month_days: vec![], starts_on, ends_on },
    }
}

pub fn get_recurrence(conn: &Connection, owner: i64, rule_id: i64) -> Result<RecurrenceInfo> {
    conn.query_row(
        "SELECT id, rrule, frequency, interval_n, starts_on, ends_on FROM recurrence_rules
         WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
        params![rule_id, owner],
        |r| Ok(rule_info(r.get(0)?, &r.get::<_, String>(1)?, &r.get::<_, String>(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    )
    .optional()?
    .ok_or(StoreError::NotFound)
}

pub fn get_payment(conn: &Connection, owner: i64, id: i64) -> Result<Transaction> {
    store::get_transaction(conn, owner, id)
}

fn add_to_totals(t: &mut MonthTotals, p: &Transaction) {
    t.count += 1;
    let income = p.direction == "income";
    match p.status.as_str() {
        "planned" => {
            if income {
                t.planned_income_kop += p.amount_kop
            } else {
                t.planned_expense_kop += p.amount_kop
            }
        }
        "completed" => {
            let a = p.actual_amount_kop.unwrap_or(p.amount_kop);
            if income {
                t.completed_income_kop += a
            } else {
                t.completed_expense_kop += a
            }
        }
        _ => t.skipped_count += 1,
    }
}

/// Платежи за период [from, to] (включительно), сгруппированные по месяцам.
/// Фильтры: счёт, тип, статус. Один запрос для платежей, один для тегов, один для правил.
pub fn list_payments(conn: &Connection, owner: i64, f: &PaymentFilter) -> Result<PaymentList> {
    let (from, to) = (parse_day(&f.from)?, parse_day(&f.to)?);
    if to < from {
        return Err(rule_err(RuleError::EndBeforeStart));
    }
    let mut sql = format!(
        "SELECT {TX_COLUMNS} FROM transactions
         WHERE owner_id = ?1 AND deleted_at IS NULL AND direction IN ('income', 'expense')
           AND planned_on BETWEEN ?2 AND ?3"
    );
    let mut args: Vec<Value> = vec![owner.into(), day_text(from).into(), day_text(to).into()];
    if let Some(a) = f.account_id {
        args.push(a.into());
        sql.push_str(&format!(" AND account_id = ?{}", args.len()));
    }
    if let Some(d) = &f.direction {
        check_direction(d)?;
        args.push(d.clone().into());
        sql.push_str(&format!(" AND direction = ?{}", args.len()));
    }
    if let Some(s) = &f.status {
        if !["planned", "completed", "skipped"].contains(&s.as_str()) {
            return Err(StoreError::Invalid("неизвестный статус"));
        }
        args.push(s.clone().into());
        sql.push_str(&format!(" AND status = ?{}", args.len()));
    }
    if let Some(r) = f.rule_id {
        args.push(r.into());
        sql.push_str(&format!(" AND rule_id = ?{}", args.len()));
    }
    if let Some(i) = f.payment_id {
        args.push(i.into());
        sql.push_str(&format!(" AND id = ?{}", args.len()));
    }
    sql.push_str(" ORDER BY planned_on, id");
    let mut st = conn.prepare(&sql)?;
    let mut payments: Vec<Transaction> = st.query_map(params_from_iter(args.iter()), tx_from_row)?.collect::<rusqlite::Result<_>>()?;

    // Теги одним запросом на период.
    let mut tags: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut st = conn.prepare(
        "SELECT tt.transaction_id, tt.tag_id FROM transaction_tags tt
         JOIN transactions t ON t.id = tt.transaction_id
         WHERE tt.deleted_at IS NULL AND t.owner_id = ?1 AND t.deleted_at IS NULL AND t.planned_on BETWEEN ?2 AND ?3
         ORDER BY tt.tag_id",
    )?;
    for row in st.query_map(params![owner, day_text(from), day_text(to)], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (tx_id, tag_id) = row?;
        tags.entry(tx_id).or_default().push(tag_id);
    }

    let total_count = payments.len();
    let mut rule_ids: Vec<i64> = payments.iter().filter_map(|p| p.rule_id).collect();
    rule_ids.sort_unstable();
    rule_ids.dedup();

    let mut groups: BTreeMap<String, MonthGroup> = BTreeMap::new();
    for mut p in payments.drain(..) {
        p.tag_ids = tags.remove(&p.id).unwrap_or_default();
        let month = p.planned_on[..7].to_string();
        let g = groups.entry(month.clone()).or_insert_with(|| MonthGroup { month, totals: MonthTotals::default(), payments: vec![] });
        add_to_totals(&mut g.totals, &p);
        g.payments.push(p);
    }

    let mut rules = Vec::with_capacity(rule_ids.len());
    for id in rule_ids {
        if let Ok(r) = get_recurrence(conn, owner, id) {
            rules.push(r);
        }
    }
    Ok(PaymentList { months: groups.into_values().collect(), rules, total_count })
}

// ---------- События ----------

/// Событие: серия платежей (правило) или одиночный платёж.
#[derive(Debug, Serialize, PartialEq)]
pub struct EventItem {
    /// `r<id правила>` для серии, `t<id платежа>` для одиночного платежа.
    pub key: String,
    pub rule: Option<RecurrenceInfo>,
    /// Платёж, по которому событие показывается и правится: ближайший запланированный
    /// с `today` и позже, иначе самый ранний запланированный, иначе самый поздний платёж.
    pub representative: Transaction,
    pub total: usize,
    pub planned: usize,
    pub completed: usize,
    pub skipped: usize,
    pub first_on: String,
    pub last_on: String,
    /// Дата ближайшего запланированного платежа с `today` и позже.
    pub next_on: Option<String>,
}

struct EventAcc {
    rule_id: Option<i64>,
    pick: Transaction,
    total: usize,
    planned: usize,
    completed: usize,
    skipped: usize,
    first_on: String,
    last_on: String,
    next_on: Option<String>,
}

fn pick_rank(p: &Transaction, today: &str) -> (u8, String) {
    // Меньше = лучше: ближайший будущий запланированный, потом любой запланированный, потом остальные (поздние первыми).
    if p.status == "planned" && p.planned_on.as_str() >= today {
        (0, p.planned_on.clone())
    } else if p.status == "planned" {
        (1, p.planned_on.clone())
    } else {
        // Инвертируем дату, чтобы самый поздний шёл первым.
        (2, p.planned_on.chars().map(|c| if c.is_ascii_digit() { char::from(b'9' - (c as u8 - b'0')) } else { c }).collect())
    }
}

/// Все события профиля: серии (один элемент на правило) и одиночные платежи.
/// Сначала события, у которых есть будущий запланированный платёж (по дате ближайшего),
/// затем остальные (по дате последнего платежа, свежие первыми).
pub fn list_events(conn: &Connection, owner: i64, today: &str) -> Result<Vec<EventItem>> {
    let today = day_text(parse_day(today)?);
    let sql = format!(
        "SELECT {TX_COLUMNS} FROM transactions
         WHERE owner_id = ?1 AND deleted_at IS NULL AND direction IN ('income', 'expense')
         ORDER BY planned_on, id"
    );
    let mut st = conn.prepare(&sql)?;
    let rows: Vec<Transaction> = st.query_map(params![owner], tx_from_row)?.collect::<rusqlite::Result<_>>()?;

    let mut by_rule: BTreeMap<i64, EventAcc> = BTreeMap::new();
    let mut singles: Vec<EventAcc> = Vec::new();
    for p in rows {
        let key = p.rule_id;
        let upcoming = p.status == "planned" && p.planned_on.as_str() >= today.as_str();
        let acc = match key {
            Some(r) => by_rule.entry(r).or_insert_with(|| EventAcc {
                rule_id: Some(r),
                pick: p.clone(),
                total: 0,
                planned: 0,
                completed: 0,
                skipped: 0,
                first_on: p.planned_on.clone(),
                last_on: p.planned_on.clone(),
                next_on: None,
            }),
            None => {
                singles.push(EventAcc {
                    rule_id: None,
                    pick: p.clone(),
                    total: 0,
                    planned: 0,
                    completed: 0,
                    skipped: 0,
                    first_on: p.planned_on.clone(),
                    last_on: p.planned_on.clone(),
                    next_on: None,
                });
                singles.last_mut().unwrap()
            }
        };
        acc.total += 1;
        match p.status.as_str() {
            "planned" => acc.planned += 1,
            "completed" => acc.completed += 1,
            _ => acc.skipped += 1,
        }
        // Платежи идут по возрастанию даты: первая встреченная дата это начало, последняя это конец.
        acc.last_on = p.planned_on.clone();
        if upcoming && acc.next_on.is_none() {
            acc.next_on = Some(p.planned_on.clone());
        }
        if pick_rank(&p, &today) < pick_rank(&acc.pick, &today) {
            acc.pick = p;
        }
    }

    let mut out: Vec<EventItem> = Vec::with_capacity(by_rule.len() + singles.len());
    for acc in by_rule.into_values().chain(singles) {
        let rule = match acc.rule_id {
            Some(id) => get_recurrence(conn, owner, id).ok(),
            None => None,
        };
        let key = match acc.rule_id {
            Some(id) => format!("r{id}"),
            None => format!("t{}", acc.pick.id),
        };
        out.push(EventItem {
            key,
            rule,
            representative: acc.pick,
            total: acc.total,
            planned: acc.planned,
            completed: acc.completed,
            skipped: acc.skipped,
            first_on: acc.first_on,
            last_on: acc.last_on,
            next_on: acc.next_on,
        });
    }
    out.sort_by(|a, b| match (&a.next_on, &b.next_on) {
        (Some(x), Some(y)) => x.cmp(y).then_with(|| a.key.cmp(&b.key)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.last_on.cmp(&a.last_on).then_with(|| a.key.cmp(&b.key)),
    });
    Ok(out)
}

// ---------- Правка и удаление ----------

/// Мягко удаляет невыполненные платежи серии начиная с `cut` и подгоняет правило:
/// конец периода становится днём перед `cut` (или датой последнего оставшегося после `cut`
/// выполненного платежа), а правило без платежей удаляется. Возвращает число удалённых платежей.
fn truncate_series(conn: &Connection, owner: i64, rule_id: i64, cut: Date) -> Result<usize> {
    let cut_text = day_text(cut);
    let deleted = conn.execute(
        "UPDATE transactions SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE owner_id = ?1 AND rule_id = ?2 AND deleted_at IS NULL AND status = 'planned' AND planned_on >= ?3",
        params![owner, rule_id, cut_text],
    )?;
    let (left, last_kept): (i64, Option<String>) = conn.query_row(
        "SELECT count(*), max(planned_on) FROM transactions WHERE owner_id = ?1 AND rule_id = ?2 AND deleted_at IS NULL",
        params![owner, rule_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if left == 0 {
        conn.execute(
            "UPDATE recurrence_rules SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1 AND owner_id = ?2",
            params![rule_id, owner],
        )?;
    } else {
        let starts: String = conn.query_row("SELECT starts_on FROM recurrence_rules WHERE id = ?1 AND owner_id = ?2", params![rule_id, owner], |r| r.get(0))?;
        // Конец периода: день перед разрезом, но не раньше последнего оставшегося платежа и начала серии.
        let mut end = day_text(cut.add_days(-1));
        if let Some(k) = last_kept {
            if k > end {
                end = k;
            }
        }
        if end < starts {
            end = starts;
        }
        conn.execute("UPDATE recurrence_rules SET ends_on = ?3 WHERE id = ?1 AND owner_id = ?2", params![rule_id, owner, end])?;
    }
    Ok(deleted)
}

/// Правка платежа. См. `Scope` и `PaymentPatch`.
pub fn update_payment(conn: &mut Connection, owner: i64, id: i64, patch: &PaymentPatch, scope: Scope) -> Result<UpdateResult> {
    let target = store::get_transaction(conn, owner, id)?;
    if target.direction != "income" && target.direction != "expense" {
        return Err(StoreError::Invalid("правятся только поступления и списания"));
    }
    // Проверка полей патча.
    let title = patch.title.as_deref().map(check_title).transpose()?;
    if let Some(d) = &patch.direction {
        check_direction(d)?;
    }
    if let Some(a) = patch.amount_kop {
        check_amount(a)?;
    }
    if let Some(a) = patch.account_id {
        check_account(conn, owner, a)?;
    }
    let note: Option<Option<String>> = patch.note.as_deref().map(check_note).transpose()?;
    let new_day = patch.planned_on.as_deref().map(parse_day).transpose()?;
    let cut = parse_day(&target.planned_on)?;

    let series_scope = scope == Scope::Following && target.rule_id.is_some();

    if !series_scope {
        // Один платёж. Повторяемость у него менять нельзя.
        if patch.recurrence.is_some() {
            return Err(StoreError::Invalid(
                "повторяемость меняется только у платежа из серии и только для «этот и все следующие»",
            ));
        }
        if let (Some(rule), Some(day)) = (target.rule_id, new_day) {
            let clash: Option<i64> = conn
                .query_row(
                    "SELECT id FROM transactions WHERE rule_id = ?1 AND planned_on = ?2 AND id <> ?3 AND deleted_at IS NULL",
                    params![rule, day_text(day), id],
                    |r| r.get(0),
                )
                .optional()?;
            if clash.is_some() {
                return Err(StoreError::Invalid("в этот день у серии уже есть платёж"));
            }
        }
        let n = conn.execute(
            "UPDATE transactions SET title = ?3, direction = ?4, amount_kop = ?5, account_id = ?6, planned_on = ?7, note = ?8
             WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
            params![
                id,
                owner,
                title.unwrap_or(target.title),
                patch.direction.clone().unwrap_or(target.direction),
                patch.amount_kop.unwrap_or(target.amount_kop),
                patch.account_id.unwrap_or(target.account_id),
                new_day.map(day_text).unwrap_or(target.planned_on),
                note.unwrap_or(target.note),
            ],
        )?;
        return Ok(UpdateResult { changed: n, new_rule_id: None });
    }

    let rule_id = target.rule_id.unwrap();
    let needs_split = patch.recurrence.is_some() || new_day.is_some_and(|d| d != cut);

    if !needs_split {
        // Только поля: правим невыполненные платежи серии с этой даты, правило не трогаем.
        let n = conn.execute(
            "UPDATE transactions
             SET title = COALESCE(?4, title), direction = COALESCE(?5, direction),
                 amount_kop = COALESCE(?6, amount_kop), account_id = COALESCE(?7, account_id),
                 note = CASE WHEN ?8 THEN ?9 ELSE note END
             WHERE owner_id = ?1 AND rule_id = ?2 AND deleted_at IS NULL AND status = 'planned' AND planned_on >= ?3",
            params![
                owner,
                rule_id,
                day_text(cut),
                title,
                patch.direction,
                patch.amount_kop,
                patch.account_id,
                note.is_some(),
                note.clone().flatten(),
            ],
        )?;
        return Ok(UpdateResult { changed: n, new_rule_id: None });
    }

    // Разбиение серии: старая заканчивается перед выбранной датой, с неё стартует новая.
    let (old_start, old_end, old_rrule): (String, Option<String>, String) = conn.query_row(
        "SELECT starts_on, ends_on, rrule FROM recurrence_rules WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
        params![rule_id, owner],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let _ = old_start;
    let (rule, spec_start, spec_end) = match &patch.recurrence {
        Some(spec) => (
            build_rule(spec)?,
            spec.starts_on.as_deref().map(parse_day).transpose()?,
            spec.ends_on.as_deref().or(old_end.as_deref()).map(parse_day).transpose()?,
        ),
        None => (Rule::parse(&old_rrule).map_err(rule_err)?, None, old_end.as_deref().map(parse_day).transpose()?),
    };
    let end = spec_end.ok_or(StoreError::Invalid("у серии нет конца периода: укажи его"))?;
    let start = spec_start.or(new_day).unwrap_or(cut);
    if start < cut {
        return Err(StoreError::Invalid("новая серия не может начинаться раньше выбранного платежа"));
    }
    let mut dates = rule.occurrences(start, end).map_err(rule_err)?;
    // Выполненные и пропущенные платежи от выбранной даты остаются: на их дни новых не делаем.
    let mut st = conn.prepare(
        "SELECT planned_on FROM transactions
         WHERE owner_id = ?1 AND rule_id = ?2 AND deleted_at IS NULL AND status <> 'planned' AND planned_on >= ?3",
    )?;
    let kept: HashSet<String> = st.query_map(params![owner, rule_id, day_text(cut)], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    drop(st);
    dates.retain(|d| !kept.contains(&day_text(*d)));
    if dates.is_empty() {
        return Err(rule_err(RuleError::Empty));
    }

    let tpl = Template {
        account_id: patch.account_id.unwrap_or(target.account_id),
        direction: patch.direction.clone().unwrap_or(target.direction.clone()),
        title: title.unwrap_or(target.title.clone()),
        note: note.unwrap_or(target.note.clone()),
        amount_kop: patch.amount_kop.unwrap_or(target.amount_kop),
    };
    let tx = conn.transaction()?;
    truncate_series(&tx, owner, rule_id, cut)?;
    let new_rule = insert_rule(&tx, owner, &rule, start, end)?;
    insert_series(&tx, owner, Some(new_rule), &dates, &tpl, &target.tag_ids)?;
    tx.commit()?;
    Ok(UpdateResult { changed: dates.len(), new_rule_id: Some(new_rule) })
}

/// Удаление (мягкое). «Только этот»: один платёж. «Этот и все следующие»: невыполненные платежи
/// серии с этой даты; выполненные и пропущенные остаются. Возвращает число удалённых платежей.
pub fn delete_payment(conn: &mut Connection, owner: i64, id: i64, scope: Scope) -> Result<usize> {
    let target = store::get_transaction(conn, owner, id)?;
    match (scope, target.rule_id) {
        (Scope::Following, Some(rule_id)) => {
            let cut = parse_day(&target.planned_on)?;
            let tx = conn.transaction()?;
            let n = truncate_series(&tx, owner, rule_id, cut)?;
            tx.commit()?;
            Ok(n)
        }
        _ => {
            store::delete_transaction(conn, owner, id)?;
            Ok(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::store::{create_account, set_transaction_status, NewAccount, DEFAULT_OWNER_ID as O};

    fn fresh() -> (Connection, i64) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::migrate(&mut conn).unwrap();
        let acc = create_account(
            &conn,
            O,
            &NewAccount { name: "Карта".into(), kind: "debit_card".into(), opening_balance_kop: 100_000, balance_on: Some("2000-01-01".into()), ..Default::default() },
        )
        .unwrap();
        (conn, acc)
    }

    fn spec(freq: &str, from: &str, to: &str) -> RecurrenceSpec {
        RecurrenceSpec { frequency: freq.into(), interval: 1, weekdays: vec![], month_days: vec![], starts_on: Some(from.into()), ends_on: Some(to.into()) }
    }

    fn new(acc: i64, recurrence: Option<RecurrenceSpec>) -> NewPayment {
        NewPayment {
            title: "Аренда".into(),
            direction: "expense".into(),
            amount_kop: 5_000_00,
            account_id: acc,
            planned_on: Some("2030-01-10".into()),
            note: None,
            recurrence,
        }
    }

    fn days_of(conn: &Connection, rule: i64) -> Vec<String> {
        let mut st = conn.prepare("SELECT planned_on FROM transactions WHERE rule_id = ?1 AND deleted_at IS NULL ORDER BY planned_on").unwrap();
        st.query_map([rule], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    }

    fn all(conn: &Connection, from: &str, to: &str) -> Vec<Transaction> {
        let l = list_payments(conn, O, &PaymentFilter { from: from.into(), to: to.into(), ..Default::default() }).unwrap();
        l.months.into_iter().flat_map(|m| m.payments).collect()
    }

    fn id_on(conn: &Connection, rule: i64, day: &str) -> i64 {
        conn.query_row("SELECT id FROM transactions WHERE rule_id = ?1 AND planned_on = ?2 AND deleted_at IS NULL", params![rule, day], |r| r.get(0)).unwrap()
    }

    // ----- события -----

    #[test]
    fn events_group_series_and_singles() {
        let (mut conn, acc) = fresh();
        // Серия на март 2030: 4 пятницы (1, 8, 15, 22, 29 → 5 платежей).
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("weekly", "2030-03-01", "2030-03-31")))).unwrap();
        let rule = r.rule_id.unwrap();
        // Одиночный платёж в апреле и отдельный старый в январе.
        let mut later = new(acc, None);
        later.planned_on = Some("2030-04-10".into());
        later.title = "Апрель".into();
        let single = create_payment(&mut conn, O, &later).unwrap();
        let old = create_payment(&mut conn, O, &new(acc, None)).unwrap(); // 2030-01-10

        // Выполняем 1-й платёж серии и пропускаем 8-й.
        store::set_transaction_status(&conn, O, id_on(&conn, rule, "2030-03-01"), "completed", None).unwrap();
        store::set_transaction_status(&conn, O, id_on(&conn, rule, "2030-03-08"), "skipped", None).unwrap();

        let ev = list_events(&conn, O, "2030-03-10").unwrap();
        assert_eq!(ev.len(), 3);
        // Порядок: ближайший будущий (серия: 15 марта), потом апрельский; старый без будущего в конце.
        assert_eq!(ev[0].key, format!("r{rule}"));
        assert_eq!(ev[1].key, format!("t{}", single.first_id));
        assert_eq!(ev[2].key, format!("t{}", old.first_id));
        let s = &ev[0];
        assert_eq!((s.total, s.planned, s.completed, s.skipped), (5, 3, 1, 1));
        assert_eq!((s.first_on.as_str(), s.last_on.as_str()), ("2030-03-01", "2030-03-29"));
        assert_eq!(s.next_on.as_deref(), Some("2030-03-15"));
        assert_eq!(s.representative.planned_on, "2030-03-15");
        assert!(s.rule.is_some());
        assert!(ev[1].rule.is_none());
        assert_eq!(ev[1].next_on.as_deref(), Some("2030-04-10"));
        assert_eq!(ev[2].next_on, None);

        // Когда будущих нет, показываем самый ранний запланированный, а если запланированных нет, самый поздний.
        let ev = list_events(&conn, O, "2031-01-01").unwrap();
        assert_eq!(ev[0].next_on, None);
        assert!(ev.iter().all(|e| e.next_on.is_none()));
        let series = ev.iter().find(|e| e.key == format!("r{rule}")).unwrap();
        assert_eq!(series.representative.planned_on, "2030-03-15");
        for d in ["2030-03-15", "2030-03-22", "2030-03-29"] {
            store::set_transaction_status(&conn, O, id_on(&conn, rule, d), "completed", None).unwrap();
        }
        let ev = list_events(&conn, O, "2031-01-01").unwrap();
        let series = ev.iter().find(|e| e.key == format!("r{rule}")).unwrap();
        assert_eq!(series.representative.planned_on, "2030-03-29");
        assert!(list_events(&conn, O, "не дата").is_err());
        // Фильтры по событию: серия и одиночный платёж.
        let by = |rule_id, payment_id| {
            list_payments(&conn, O, &PaymentFilter { from: "2030-01-01".into(), to: "2030-12-31".into(), rule_id, payment_id, ..Default::default() }).unwrap().total_count
        };
        assert_eq!((by(Some(rule), None), by(None, Some(single.first_id)), by(None, None)), (5, 1, 7));
        // Удалённые платежи не считаются.
        delete_payment(&mut conn, O, old.first_id, Scope::This).unwrap();
        assert_eq!(list_events(&conn, O, "2030-03-10").unwrap().len(), 2);
    }

    // ----- создание -----

    #[test]
    fn single_payment() {
        let (mut conn, acc) = fresh();
        let r = create_payment(&mut conn, O, &new(acc, None)).unwrap();
        assert_eq!((r.rule_id, r.count), (None, 1));
        let p = get_payment(&conn, O, r.first_id).unwrap();
        assert_eq!((p.planned_on.as_str(), p.status.as_str(), p.amount_kop), ("2030-01-10", "planned", 500_000));
        assert!(p.rule_id.is_none());
    }

    #[test]
    fn rejects_bad_input() {
        let (mut conn, acc) = fresh();
        let bad = |f: &dyn Fn(&mut NewPayment)| {
            let mut p = new(acc, None);
            f(&mut p);
            p
        };
        for p in [
            bad(&|p| p.title = "  ".into()),
            bad(&|p| p.direction = "transfer".into()),
            bad(&|p| p.amount_kop = 0),
            bad(&|p| p.amount_kop = -5),
            bad(&|p| p.amount_kop = MAX_AMOUNT_KOP + 1),
            bad(&|p| p.account_id = 9999),
            bad(&|p| p.planned_on = None),
            bad(&|p| p.planned_on = Some("2030-02-30".into())),
            bad(&|p| p.note = Some("я".repeat(2001))),
        ] {
            assert!(create_payment(&mut conn, O, &p).is_err(), "{p:?}");
        }
        // Серия: нет периода, конец раньше начала, неверные поля.
        let mut s = spec("weekly", "2030-03-01", "2030-03-31");
        s.ends_on = None;
        assert!(create_payment(&mut conn, O, &new(acc, Some(s))).is_err());
        assert!(create_payment(&mut conn, O, &new(acc, Some(spec("weekly", "2030-03-31", "2030-03-01")))).is_err());
        assert!(create_payment(&mut conn, O, &new(acc, Some(spec("hourly", "2030-03-01", "2030-03-31")))).is_err());
        let mut s = spec("weekly", "2030-03-01", "2030-03-31");
        s.interval = 0;
        assert!(create_payment(&mut conn, O, &new(acc, Some(s))).is_err());
        let mut s = spec("monthly", "2030-03-01", "2030-03-31");
        s.weekdays = vec!["MO".into()];
        assert!(create_payment(&mut conn, O, &new(acc, Some(s))).is_err());
        // Ничего не создано.
        assert!(all(&conn, "2000-01-01", "2100-01-01").is_empty());
        let rules: i64 = conn.query_row("SELECT count(*) FROM recurrence_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(rules, 0);
    }

    #[test]
    fn empty_series_is_error() {
        let (mut conn, acc) = fresh();
        let mut s = spec("monthly", "2030-03-01", "2030-03-24");
        s.month_days = vec![25];
        assert!(create_payment(&mut conn, O, &new(acc, Some(s))).is_err());
    }

    #[test]
    fn archived_account_rejected() {
        let (mut conn, acc) = fresh();
        store::set_account_archived(&conn, O, acc, true).unwrap();
        assert!(create_payment(&mut conn, O, &new(acc, None)).is_err());
    }

    #[test]
    fn weekly_series_in_march() {
        // 1–31 марта 2030, раз в неделю (1 марта 2030 — пятница): 1, 8, 15, 22, 29.
        let (mut conn, acc) = fresh();
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("weekly", "2030-03-01", "2030-03-31")))).unwrap();
        assert_eq!(r.count, 5);
        assert_eq!(days_of(&conn, r.rule_id.unwrap()), ["2030-03-01", "2030-03-08", "2030-03-15", "2030-03-22", "2030-03-29"]);
        // С субботы 2 по 31: 4 платежа.
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("weekly", "2030-03-02", "2030-03-31")))).unwrap();
        assert_eq!(r.count, 5, "субботы: 2, 9, 16, 23, 30");
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("weekly", "2030-03-04", "2030-03-31")))).unwrap();
        assert_eq!(r.count, 4, "понедельники: 4, 11, 18, 25");
    }

    #[test]
    fn rule_row_is_consistent() {
        let (mut conn, acc) = fresh();
        let mut s = spec("weekly", "2030-03-04", "2030-04-30");
        s.interval = 2;
        s.weekdays = vec!["FR".into(), "MO".into()];
        let r = create_payment(&mut conn, O, &new(acc, Some(s))).unwrap();
        let info = get_recurrence(&conn, O, r.rule_id.unwrap()).unwrap();
        assert_eq!(info.rrule, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR");
        assert_eq!((info.frequency.as_str(), info.interval), ("weekly", 2));
        assert_eq!(info.weekdays, ["MO", "FR"]);
        assert_eq!((info.starts_on.as_str(), info.ends_on.as_deref()), ("2030-03-04", Some("2030-04-30")));
        let (f, n): (String, i64) = conn.query_row("SELECT frequency, interval_n FROM recurrence_rules", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((f.as_str(), n), ("weekly", 2));
    }

    #[test]
    fn monthly_31st_across_february_leap_and_not() {
        let (mut conn, acc) = fresh();
        let mut s = spec("monthly", "2031-12-31", "2032-03-31");
        s.month_days = vec![31];
        let r = create_payment(&mut conn, O, &new(acc, Some(s))).unwrap();
        assert_eq!(days_of(&conn, r.rule_id.unwrap()), ["2031-12-31", "2032-01-31", "2032-02-29", "2032-03-31"]);
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("monthly", "2030-01-31", "2030-04-30")))).unwrap();
        assert_eq!(days_of(&conn, r.rule_id.unwrap()), ["2030-01-31", "2030-02-28", "2030-03-31", "2030-04-30"]);
    }

    #[test]
    fn long_series_thousands_of_rows() {
        // Каждый день 12 лет: 4383 платежа одной транзакцией.
        let (mut conn, acc) = fresh();
        let t0 = std::time::Instant::now();
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("daily", "2030-01-01", "2041-12-31")))).unwrap();
        assert_eq!(r.count, 4383);
        let listed = list_payments(&conn, O, &PaymentFilter { from: "2030-01-01".into(), to: "2041-12-31".into(), ..Default::default() }).unwrap();
        assert_eq!(listed.total_count, 4383);
        assert_eq!(listed.months.len(), 144);
        assert_eq!(listed.rules.len(), 1);
        assert!(t0.elapsed().as_secs() < 5, "серия на тысячи записей должна создаваться быстро: {:?}", t0.elapsed());
        // Дубли по правилу и дню невозможны.
        let dup = conn.execute("INSERT INTO transactions (owner_id, account_id, rule_id, direction, title, amount_kop, planned_on) VALUES (1, ?1, ?2, 'expense', 'x', 1, '2030-01-01')", params![acc, r.rule_id]);
        assert!(dup.is_err());
    }

    #[test]
    fn too_long_series_creates_nothing() {
        let (mut conn, acc) = fresh();
        assert!(create_payment(&mut conn, O, &new(acc, Some(spec("daily", "1950-01-01", "2150-12-31")))).is_err());
        assert!(all(&conn, "1900-01-01", "2200-12-31").is_empty());
    }

    #[test]
    fn preview_matches_creation() {
        let s = spec("weekly", "2030-03-01", "2030-03-31");
        let p = preview_recurrence(&s).unwrap();
        assert_eq!((p.count, p.first.as_deref(), p.last.as_deref()), (5, Some("2030-03-01"), Some("2030-03-29")));
        let long = preview_recurrence(&spec("daily", "2030-01-01", "2030-12-31")).unwrap();
        assert_eq!((long.count, long.dates.len()), (365, 60));
        assert!(preview_recurrence(&spec("weekly", "bad", "2030-03-31")).is_err());
    }

    // ----- список -----

    #[test]
    fn list_groups_by_month_with_totals_and_filters() {
        let (mut conn, acc) = fresh();
        let other = create_account(&conn, O, &NewAccount { name: "Наличные".into(), kind: "cash".into(), ..Default::default() }).unwrap();
        let rent = create_payment(&mut conn, O, &new(acc, Some(spec("monthly", "2030-01-10", "2030-03-10")))).unwrap();
        let mut salary = new(other, None);
        salary.direction = "income".into();
        salary.amount_kop = 90_000_00;
        salary.planned_on = Some("2030-02-05".into());
        let s = create_payment(&mut conn, O, &salary).unwrap();
        // Один платёж выполнен с другой суммой, один пропущен.
        set_transaction_status(&conn, O, id_on(&conn, rent.rule_id.unwrap(), "2030-01-10"), "completed", Some(5_200_00)).unwrap();
        set_transaction_status(&conn, O, id_on(&conn, rent.rule_id.unwrap(), "2030-03-10"), "skipped", None).unwrap();

        let l = list_payments(&conn, O, &PaymentFilter { from: "2030-01-01".into(), to: "2030-12-31".into(), ..Default::default() }).unwrap();
        assert_eq!(l.total_count, 4);
        let months: Vec<&str> = l.months.iter().map(|m| m.month.as_str()).collect();
        assert_eq!(months, ["2030-01", "2030-02", "2030-03"]);
        assert_eq!((l.months[0].totals.completed_expense_kop, l.months[0].totals.planned_expense_kop), (5_200_00, 0));
        assert_eq!((l.months[1].totals.planned_expense_kop, l.months[1].totals.planned_income_kop), (5_000_00, 90_000_00));
        assert_eq!((l.months[2].totals.skipped_count, l.months[2].totals.planned_expense_kop, l.months[2].totals.count), (1, 0, 1));
        assert_eq!(l.rules.len(), 1);
        assert_eq!(l.rules[0].rule_id, rent.rule_id.unwrap());

        let f = |a: Option<i64>, d: Option<&str>, st: Option<&str>| {
            list_payments(&conn, O, &PaymentFilter { from: "2030-01-01".into(), to: "2030-12-31".into(), account_id: a, direction: d.map(Into::into), status: st.map(Into::into), ..Default::default() })
                .unwrap()
                .total_count
        };
        assert_eq!(f(Some(other), None, None), 1);
        assert_eq!(f(None, Some("income"), None), 1);
        assert_eq!(f(None, None, Some("planned")), 2);
        assert_eq!(f(None, None, Some("completed")), 1);
        assert_eq!(f(Some(acc), Some("expense"), Some("skipped")), 1);
        let _ = s;
        // Границы периода включительны.
        let b = list_payments(&conn, O, &PaymentFilter { from: "2030-02-05".into(), to: "2030-02-10".into(), ..Default::default() }).unwrap();
        assert_eq!(b.total_count, 2);
        let b = list_payments(&conn, O, &PaymentFilter { from: "2030-02-06".into(), to: "2030-02-09".into(), ..Default::default() }).unwrap();
        assert_eq!(b.total_count, 0);
        assert!(list_payments(&conn, O, &PaymentFilter { from: "2030-02-06".into(), to: "2030-02-05".into(), ..Default::default() }).is_err());
        assert!(list_payments(&conn, O, &PaymentFilter { from: "x".into(), to: "2030-02-05".into(), ..Default::default() }).is_err());
    }

    #[test]
    fn profiles_are_isolated() {
        let (mut conn, acc) = fresh();
        let b = crate::profiles::create_profile(&conn, "Другой").unwrap();
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("weekly", "2030-03-01", "2030-03-31")))).unwrap();
        // Чужой счёт подставить нельзя; чужие платежи не видны и не правятся.
        assert!(create_payment(&mut conn, b, &new(acc, None)).is_err());
        assert_eq!(list_payments(&conn, b, &PaymentFilter { from: "2030-01-01".into(), to: "2030-12-31".into(), ..Default::default() }).unwrap().total_count, 0);
        assert!(update_payment(&mut conn, b, r.first_id, &PaymentPatch { title: Some("X".into()), ..Default::default() }, Scope::Following).is_err());
        assert!(delete_payment(&mut conn, b, r.first_id, Scope::Following).is_err());
        assert!(get_recurrence(&conn, b, r.rule_id.unwrap()).is_err());
    }

    // ----- баланс -----

    #[test]
    fn only_completed_payments_change_balance() {
        let (mut conn, acc) = fresh();
        let r = create_payment(&mut conn, O, &new(acc, Some(spec("monthly", "2030-01-10", "2030-03-10")))).unwrap();
        let rule = r.rule_id.unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000);
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-01-10"), "completed", None).unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000 - 500_000);
        // Фактическая сумма заменяет плановую.
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-02-10"), "completed", Some(450_000)).unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000 - 500_000 - 450_000);
        // Пропуск и возврат в план баланс не меняют/откатывают.
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-03-10"), "skipped", None).unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000 - 950_000);
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-02-10"), "planned", None).unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000 - 500_000);
        // Поступление прибавляет.
        let mut inc = new(acc, None);
        inc.direction = "income".into();
        let i = create_payment(&mut conn, O, &inc).unwrap();
        set_transaction_status(&conn, O, i.first_id, "completed", None).unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000 - 500_000 + 500_000);
    }

    // ----- правка -----

    fn monthly(conn: &mut Connection, acc: i64, from: &str, to: &str) -> i64 {
        create_payment(conn, O, &new(acc, Some(spec("monthly", from, to)))).unwrap().rule_id.unwrap()
    }

    #[test]
    fn edit_only_this_keeps_series() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-04-10");
        let id = id_on(&conn, rule, "2030-02-10");
        let r = update_payment(&mut conn, O, id, &PaymentPatch { amount_kop: Some(777), title: Some(" Свет ".into()), note: Some("Дорого".into()), ..Default::default() }, Scope::This).unwrap();
        assert_eq!(r, UpdateResult { changed: 1, new_rule_id: None });
        let p = get_payment(&conn, O, id).unwrap();
        assert_eq!((p.amount_kop, p.title.as_str(), p.note.as_deref(), p.rule_id), (777, "Свет", Some("Дорого"), Some(rule)));
        // Остальные не тронуты.
        let other = get_payment(&conn, O, id_on(&conn, rule, "2030-03-10")).unwrap();
        assert_eq!((other.amount_kop, other.title.as_str()), (500_000, "Аренда"));
        // Очистка комментария пустой строкой.
        update_payment(&mut conn, O, id, &PaymentPatch { note: Some("".into()), ..Default::default() }, Scope::This).unwrap();
        assert_eq!(get_payment(&conn, O, id).unwrap().note, None);
    }

    #[test]
    fn edit_only_this_can_move_date_but_not_onto_another() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-03-10");
        let id = id_on(&conn, rule, "2030-02-10");
        update_payment(&mut conn, O, id, &PaymentPatch { planned_on: Some("2030-02-12".into()), ..Default::default() }, Scope::This).unwrap();
        assert_eq!(days_of(&conn, rule), ["2030-01-10", "2030-02-12", "2030-03-10"]);
        let err = update_payment(&mut conn, O, id, &PaymentPatch { planned_on: Some("2030-03-10".into()), ..Default::default() }, Scope::This);
        assert!(err.is_err());
        assert!(update_payment(&mut conn, O, id, &PaymentPatch { planned_on: Some("2030-02-31".into()), ..Default::default() }, Scope::This).is_err());
        // Повторяемость при «только этот» менять нельзя.
        assert!(update_payment(&mut conn, O, id, &PaymentPatch { recurrence: Some(spec("daily", "2030-02-12", "2030-02-20")), ..Default::default() }, Scope::This).is_err());
    }

    #[test]
    fn edit_following_fields_only_changes_future_planned() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-05-10");
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-01-10"), "completed", None).unwrap();
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-04-10"), "completed", None).unwrap(); // выполнен в будущем
        let from = id_on(&conn, rule, "2030-03-10");
        let r = update_payment(&mut conn, O, from, &PaymentPatch { amount_kop: Some(600_000), title: Some("Аренда+".into()), ..Default::default() }, Scope::Following).unwrap();
        assert_eq!(r, UpdateResult { changed: 2, new_rule_id: None }); // 10.03 и 10.05, но не выполненный 10.04
        let by = |d: &str| get_payment(&conn, O, id_on(&conn, rule, d)).unwrap();
        assert_eq!((by("2030-01-10").amount_kop, by("2030-01-10").title.as_str()), (500_000, "Аренда"));
        assert_eq!(by("2030-02-10").amount_kop, 500_000);
        assert_eq!((by("2030-03-10").amount_kop, by("2030-03-10").title.as_str()), (600_000, "Аренда+"));
        assert_eq!(by("2030-04-10").amount_kop, 500_000, "выполненный не трогаем");
        assert_eq!(by("2030-05-10").amount_kop, 600_000);
    }

    #[test]
    fn edit_following_with_new_recurrence_splits_series() {
        let (mut conn, acc) = fresh();
        let old = monthly(&mut conn, acc, "2030-01-10", "2030-06-10");
        // Прошлое выполнено, март тоже выполнен (его трогать нельзя).
        set_transaction_status(&conn, O, id_on(&conn, old, "2030-01-10"), "completed", None).unwrap();
        set_transaction_status(&conn, O, id_on(&conn, old, "2030-03-10"), "completed", None).unwrap();
        let target = id_on(&conn, old, "2030-03-10");
        // С 10 марта: каждые 2 недели по пятницам, до 30 апреля, сумма 100.
        let mut s = spec("weekly", "2030-03-10", "2030-04-30");
        s.interval = 2;
        s.weekdays = vec!["FR".into()];
        s.starts_on = None;
        let r = update_payment(&mut conn, O, target, &PaymentPatch { amount_kop: Some(10_000), recurrence: Some(s), ..Default::default() }, Scope::Following).unwrap();
        let new_rule = r.new_rule_id.unwrap();
        assert_ne!(new_rule, old);
        // Новая серия: первая неделя 4–10 марта (пятница 8-го до старта 10-го, пропущена), затем +2 недели: 22.03, 05.04, 19.04.
        assert_eq!(days_of(&conn, new_rule), ["2030-03-22", "2030-04-05", "2030-04-19"]);
        assert_eq!(r.changed, 3);
        // Старая: январь, февраль и выполненный март остались; планы с 10.03 удалены; конец периода подвинут на выполненный март.
        assert_eq!(days_of(&conn, old), ["2030-01-10", "2030-02-10", "2030-03-10"]);
        let info = get_recurrence(&conn, O, old).unwrap();
        assert_eq!(info.ends_on.as_deref(), Some("2030-03-10"));
        assert_eq!(get_payment(&conn, O, target).unwrap().status, "completed");
        assert_eq!(get_payment(&conn, O, id_on(&conn, new_rule, "2030-03-22")).unwrap().amount_kop, 10_000);
        // Баланс: выполненные январь и март по прежней сумме.
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000 - 1_000_000);
        // Нигде нет апрельских, майских и июньских платежей по старому правилу.
        let l = all(&conn, "2030-04-01", "2030-12-31");
        assert!(l.iter().all(|p| p.rule_id == Some(new_rule)));
    }

    #[test]
    fn split_from_planned_payment_shortens_old_series() {
        let (mut conn, acc) = fresh();
        let old = monthly(&mut conn, acc, "2030-01-10", "2030-06-10");
        let target = id_on(&conn, old, "2030-04-10");
        // Новая сумма и сдвиг даты начала: 15-го числа, период тот же.
        let mut s = spec("monthly", "2030-04-15", "2030-06-30");
        s.ends_on = None; // берётся прежний конец, 2030-06-10
        s.month_days = vec![15];
        s.starts_on = Some("2030-04-15".into());
        let r = update_payment(&mut conn, O, target, &PaymentPatch { amount_kop: Some(1), recurrence: Some(s), ..Default::default() }, Scope::Following).unwrap();
        let nr = r.new_rule_id.unwrap();
        assert_eq!(days_of(&conn, nr), ["2030-04-15", "2030-05-15"], "15 июня позже конца периода 10 июня");
        assert_eq!(days_of(&conn, old), ["2030-01-10", "2030-02-10", "2030-03-10"]);
        assert_eq!(get_recurrence(&conn, O, old).unwrap().ends_on.as_deref(), Some("2030-04-09"));
        assert_eq!(get_recurrence(&conn, O, nr).unwrap().starts_on, "2030-04-15");
    }

    #[test]
    fn split_by_moving_start_date_only() {
        let (mut conn, acc) = fresh();
        let old = monthly(&mut conn, acc, "2030-01-10", "2030-04-10");
        let target = id_on(&conn, old, "2030-02-10");
        // Только новая дата платежа: серия сдвигается на 12-е, число берётся из новой даты.
        let r = update_payment(&mut conn, O, target, &PaymentPatch { planned_on: Some("2030-02-12".into()), ..Default::default() }, Scope::Following).unwrap();
        let nr = r.new_rule_id.unwrap();
        assert_eq!(days_of(&conn, nr), ["2030-02-12", "2030-03-12", "2030-04-12"].iter().take(2).copied().collect::<Vec<_>>(), "12 апреля позже конца 10 апреля");
        assert_eq!(days_of(&conn, old), ["2030-01-10"]);
        // Нельзя начать новую серию раньше выбранной даты.
        let t2 = id_on(&conn, nr, "2030-03-12");
        assert!(update_payment(&mut conn, O, t2, &PaymentPatch { planned_on: Some("2030-03-01".into()), ..Default::default() }, Scope::Following).is_err());
    }

    #[test]
    fn split_from_first_payment_deletes_old_rule() {
        let (mut conn, acc) = fresh();
        let old = monthly(&mut conn, acc, "2030-01-10", "2030-03-10");
        let first = id_on(&conn, old, "2030-01-10");
        let r = update_payment(&mut conn, O, first, &PaymentPatch { recurrence: Some(spec("monthly", "2030-01-10", "2030-02-10")), ..Default::default() }, Scope::Following).unwrap();
        assert_eq!(r.changed, 2);
        assert!(get_recurrence(&conn, O, old).is_err(), "старое правило без платежей удалено");
        assert_eq!(days_of(&conn, r.new_rule_id.unwrap()), ["2030-01-10", "2030-02-10"]);
        assert_eq!(all(&conn, "2030-01-01", "2030-12-31").len(), 2);
    }

    #[test]
    fn split_failure_changes_nothing() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-04-10");
        let id = id_on(&conn, rule, "2030-02-10");
        // Период без дат: ошибка до записи.
        let mut s = spec("monthly", "2030-02-10", "2030-02-11");
        s.month_days = vec![25];
        assert!(update_payment(&mut conn, O, id, &PaymentPatch { recurrence: Some(s), ..Default::default() }, Scope::Following).is_err());
        // Конец раньше начала.
        assert!(update_payment(&mut conn, O, id, &PaymentPatch { recurrence: Some(spec("monthly", "2030-02-10", "2030-02-01")), ..Default::default() }, Scope::Following).is_err());
        assert_eq!(days_of(&conn, rule), ["2030-01-10", "2030-02-10", "2030-03-10", "2030-04-10"]);
    }

    #[test]
    fn split_keeps_tags() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-03-10");
        let tag = store::create_tag(&conn, O, "дом").unwrap();
        let id = id_on(&conn, rule, "2030-02-10");
        store::set_transaction_tags(&mut conn, O, id, &[tag]).unwrap();
        let r = update_payment(&mut conn, O, id, &PaymentPatch { recurrence: Some(spec("monthly", "2030-02-10", "2030-03-10")), ..Default::default() }, Scope::Following).unwrap();
        let nr = r.new_rule_id.unwrap();
        let l = all(&conn, "2030-02-01", "2030-03-31");
        assert!(l.iter().all(|p| p.rule_id == Some(nr) && p.tag_ids == vec![tag]));
    }

    #[test]
    fn following_on_single_payment_acts_as_this_and_recurrence_rejected() {
        let (mut conn, acc) = fresh();
        let id = create_payment(&mut conn, O, &new(acc, None)).unwrap().first_id;
        let r = update_payment(&mut conn, O, id, &PaymentPatch { amount_kop: Some(42), ..Default::default() }, Scope::Following).unwrap();
        assert_eq!(r.changed, 1);
        assert_eq!(get_payment(&conn, O, id).unwrap().amount_kop, 42);
        assert!(update_payment(&mut conn, O, id, &PaymentPatch { recurrence: Some(spec("daily", "2030-01-10", "2030-01-12")), ..Default::default() }, Scope::Following).is_err());
    }

    #[test]
    fn edit_validates_fields() {
        let (mut conn, acc) = fresh();
        let id = create_payment(&mut conn, O, &new(acc, None)).unwrap().first_id;
        for p in [
            PaymentPatch { title: Some("".into()), ..Default::default() },
            PaymentPatch { amount_kop: Some(0), ..Default::default() },
            PaymentPatch { direction: Some("transfer".into()), ..Default::default() },
            PaymentPatch { account_id: Some(777), ..Default::default() },
        ] {
            assert!(update_payment(&mut conn, O, id, &p, Scope::This).is_err());
        }
        assert!(update_payment(&mut conn, O, 99999, &PaymentPatch::default(), Scope::This).is_err());
    }

    // ----- удаление -----

    #[test]
    fn delete_only_this() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-03-10");
        let target = id_on(&conn, rule, "2030-02-10");
        let n = delete_payment(&mut conn, O, target, Scope::This).unwrap();
        assert_eq!(n, 1);
        assert_eq!(days_of(&conn, rule), ["2030-01-10", "2030-03-10"]);
        // Строка осталась в базе с deleted_at (мягкое удаление).
        let soft: i64 = conn.query_row("SELECT count(*) FROM transactions WHERE rule_id = ?1 AND deleted_at IS NOT NULL", [rule], |r| r.get(0)).unwrap();
        assert_eq!(soft, 1);
        // Удалённый день можно создать снова (уникальность только среди живых).
        let id = id_on(&conn, rule, "2030-03-10");
        update_payment(&mut conn, O, id, &PaymentPatch { planned_on: Some("2030-02-10".into()), ..Default::default() }, Scope::This).unwrap();
    }

    #[test]
    fn delete_following_keeps_past_and_completed() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-06-10");
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-01-10"), "completed", None).unwrap();
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-04-10"), "completed", None).unwrap();
        set_transaction_status(&conn, O, id_on(&conn, rule, "2030-05-10"), "skipped", None).unwrap();
        let target = id_on(&conn, rule, "2030-03-10");
        let n = delete_payment(&mut conn, O, target, Scope::Following).unwrap();
        assert_eq!(n, 2, "10.03 и 10.06 (запланированные); выполненный и пропущенный остаются");
        assert_eq!(days_of(&conn, rule), ["2030-01-10", "2030-02-10", "2030-04-10", "2030-05-10"]);
        assert_eq!(get_recurrence(&conn, O, rule).unwrap().ends_on.as_deref(), Some("2030-05-10"));
    }

    #[test]
    fn delete_following_from_first_removes_rule() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-03-10");
        let target = id_on(&conn, rule, "2030-01-10");
        let n = delete_payment(&mut conn, O, target, Scope::Following).unwrap();
        assert_eq!(n, 3);
        assert!(get_recurrence(&conn, O, rule).is_err());
        assert!(all(&conn, "2030-01-01", "2030-12-31").is_empty());
    }

    #[test]
    fn delete_following_shortens_period_before_cut() {
        let (mut conn, acc) = fresh();
        let rule = monthly(&mut conn, acc, "2030-01-10", "2030-06-10");
        let target = id_on(&conn, rule, "2030-04-10");
        delete_payment(&mut conn, O, target, Scope::Following).unwrap();
        assert_eq!(days_of(&conn, rule), ["2030-01-10", "2030-02-10", "2030-03-10"]);
        assert_eq!(get_recurrence(&conn, O, rule).unwrap().ends_on.as_deref(), Some("2030-04-09"));
    }

    #[test]
    fn deleting_completed_payment_changes_balance() {
        let (mut conn, acc) = fresh();
        let id = create_payment(&mut conn, O, &new(acc, None)).unwrap().first_id;
        set_transaction_status(&conn, O, id, "completed", None).unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000 - 500_000);
        delete_payment(&mut conn, O, id, Scope::This).unwrap();
        assert_eq!(store::account_balance_kop(&conn, O, acc).unwrap(), 100_000);
    }

    #[test]
    fn migration_backfills_old_rules() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (i, (_, sql)) in db::MIGRATIONS.iter().take(4).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", (i + 1) as u32).unwrap();
        }
        conn.execute("INSERT INTO recurrence_rules (frequency, interval_n, starts_on) VALUES ('monthly', 3, '2030-01-15')", []).unwrap();
        db::migrate(&mut conn).unwrap();
        let rrule: String = conn.query_row("SELECT rrule FROM recurrence_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(rrule, "FREQ=MONTHLY;INTERVAL=3");
        assert!(Rule::parse(&rrule).is_ok());
    }
}
