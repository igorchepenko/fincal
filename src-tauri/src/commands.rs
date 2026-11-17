//! Tauri-команды: тонкая обёртка над `store`. Экраны вызывают только их.

use crate::payments::{self, CreatedPayments, NewPayment, PaymentFilter, PaymentList, PaymentPatch, RecurrenceInfo, RecurrencePreview, RecurrenceSpec, Scope, UpdateResult};
use crate::profiles::{self, Profile};
use crate::store::{self, Account, AccountUpdate, Category, NewAccount, NewCategory, NewTransaction, Tag, Transaction};
use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};
use tauri::State;

pub struct Db(pub Mutex<Connection>);

type Res<T> = Result<T, String>;

fn err(e: store::StoreError) -> String {
    e.to_string()
}

fn lock<'a>(db: &'a State<'_, Db>) -> Res<MutexGuard<'a, Connection>> {
    db.inner().0.lock().map_err(|_| "база занята".to_string())
}

/// Соединение и id текущего профиля. Все команды с данными работают только с ним.
fn scoped<'a>(db: &'a State<'_, Db>) -> Res<(MutexGuard<'a, Connection>, i64)> {
    let conn = lock(db)?;
    let owner = profiles::current_owner_id(&conn).map_err(err)?;
    Ok((conn, owner))
}

#[tauri::command]
pub fn list_accounts(db: State<Db>) -> Res<Vec<Account>> {
    let (conn, owner) = scoped(&db)?;
    store::list_accounts(&*conn, owner).map_err(err)
}

#[tauri::command]
pub fn create_account(db: State<Db>, account: NewAccount) -> Res<i64> {
    let (conn, owner) = scoped(&db)?;
    store::create_account(&*conn, owner, &account).map_err(err)
}

#[tauri::command]
pub fn update_account(db: State<Db>, id: i64, update: AccountUpdate) -> Res<()> {
    let (conn, owner) = scoped(&db)?;
    store::update_account(&*conn, owner, id, &update).map_err(err)
}

#[tauri::command]
pub fn archive_account(db: State<Db>, id: i64, archived: bool) -> Res<()> {
    let (conn, owner) = scoped(&db)?;
    store::set_account_archived(&*conn, owner, id, archived).map_err(err)
}

#[tauri::command]
pub fn account_balance(db: State<Db>, account_id: i64) -> Res<i64> {
    let (conn, owner) = scoped(&db)?;
    store::account_balance_kop(&*conn, owner, account_id).map_err(err)
}

#[tauri::command]
pub fn list_categories(db: State<Db>) -> Res<Vec<Category>> {
    let (conn, owner) = scoped(&db)?;
    store::list_categories(&*conn, owner).map_err(err)
}

#[tauri::command]
pub fn create_category(db: State<Db>, category: NewCategory) -> Res<i64> {
    let (conn, owner) = scoped(&db)?;
    store::create_category(&*conn, owner, &category).map_err(err)
}

#[tauri::command]
pub fn list_transactions(db: State<Db>, from: String, to: String) -> Res<Vec<Transaction>> {
    let (conn, owner) = scoped(&db)?;
    store::list_transactions(&*conn, owner, &from, &to).map_err(err)
}

#[tauri::command]
pub fn create_transaction(db: State<Db>, transaction: NewTransaction) -> Res<i64> {
    let (mut conn, owner) = scoped(&db)?;
    store::create_transaction(&mut *conn, owner, &transaction).map_err(err)
}

#[tauri::command]
pub fn set_transaction_status(
    db: State<Db>,
    id: i64,
    status: String,
    actual_amount_kop: Option<i64>,
) -> Res<()> {
    let (conn, owner) = scoped(&db)?;
    store::set_transaction_status(&*conn, owner, id, &status, actual_amount_kop).map_err(err)
}

#[tauri::command]
pub fn delete_transaction(db: State<Db>, id: i64) -> Res<()> {
    let (conn, owner) = scoped(&db)?;
    store::delete_transaction(&*conn, owner, id).map_err(err)
}

#[tauri::command]
pub fn list_tags(db: State<Db>) -> Res<Vec<Tag>> {
    let (conn, owner) = scoped(&db)?;
    store::list_tags(&*conn, owner).map_err(err)
}

#[tauri::command]
pub fn create_tag(db: State<Db>, name: String) -> Res<i64> {
    let (conn, owner) = scoped(&db)?;
    store::create_tag(&*conn, owner, &name).map_err(err)
}

#[tauri::command]
pub fn set_transaction_tags(db: State<Db>, transaction_id: i64, tag_ids: Vec<i64>) -> Res<()> {
    let (mut conn, owner) = scoped(&db)?;
    store::set_transaction_tags(&mut *conn, owner, transaction_id, &tag_ids).map_err(err)
}

// ---------- Платежи ----------
// Экран «Платежи» работает только с этими командами. Статус платежа меняет
// `set_transaction_status` (выше): единственная функция смены статуса.

/// Создаёт одиночный платёж или всю серию (если есть `recurrence`).
#[tauri::command]
pub fn create_payment(db: State<Db>, payment: NewPayment) -> Res<CreatedPayments> {
    let (mut conn, owner) = scoped(&db)?;
    payments::create_payment(&mut *conn, owner, &payment).map_err(err)
}

/// Платежи за период по месяцам (с итогами) и правила серий. Фильтры: счёт, тип, статус.
#[tauri::command]
pub fn list_payments(db: State<Db>, filter: PaymentFilter) -> Res<PaymentList> {
    let (conn, owner) = scoped(&db)?;
    payments::list_payments(&*conn, owner, &filter).map_err(err)
}

/// События профиля: серии и одиночные платежи, по одной записи на событие.
#[tauri::command]
pub fn list_events(db: State<Db>, today: String) -> Res<Vec<payments::EventItem>> {
    let (conn, owner) = scoped(&db)?;
    payments::list_events(&*conn, owner, &today).map_err(err)
}

#[tauri::command]
pub fn get_payment(db: State<Db>, id: i64) -> Res<Transaction> {
    let (conn, owner) = scoped(&db)?;
    payments::get_payment(&*conn, owner, id).map_err(err)
}

/// Правило повторения серии по `rule_id` платежа.
#[tauri::command]
pub fn get_recurrence(db: State<Db>, rule_id: i64) -> Res<RecurrenceInfo> {
    let (conn, owner) = scoped(&db)?;
    payments::get_recurrence(&*conn, owner, rule_id).map_err(err)
}

/// Сколько платежей даст повторяемость и на какие даты. Ничего не пишет.
#[tauri::command]
pub fn preview_recurrence(recurrence: RecurrenceSpec) -> Res<RecurrencePreview> {
    payments::preview_recurrence(&recurrence).map_err(err)
}

/// Правка: `scope` = "this" (только этот) или "following" (этот и все следующие).
#[tauri::command]
pub fn update_payment(db: State<Db>, id: i64, patch: PaymentPatch, scope: Scope) -> Res<UpdateResult> {
    let (mut conn, owner) = scoped(&db)?;
    payments::update_payment(&mut *conn, owner, id, &patch, scope).map_err(err)
}

/// Удаление: `scope` как в `update_payment`. Возвращает число удалённых платежей.
#[tauri::command]
pub fn delete_payment(db: State<Db>, id: i64, scope: Scope) -> Res<usize> {
    let (mut conn, owner) = scoped(&db)?;
    payments::delete_payment(&mut *conn, owner, id, scope).map_err(err)
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Res<Option<String>> {
    let (conn, owner) = scoped(&db)?;
    store::get_setting(&*conn, owner, &key).map_err(err)
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Res<()> {
    let (conn, owner) = scoped(&db)?;
    store::set_setting(&*conn, owner, &key, &value).map_err(err)
}

// ---------- Профили ----------

#[tauri::command]
pub fn list_profiles(db: State<Db>) -> Res<Vec<Profile>> {
    profiles::list_profiles(&*lock(&db)?).map_err(err)
}

#[tauri::command]
pub fn get_current_profile(db: State<Db>) -> Res<Profile> {
    profiles::current_profile(&*lock(&db)?).map_err(err)
}

#[tauri::command]
pub fn create_profile(db: State<Db>, name: String) -> Res<i64> {
    profiles::create_profile(&*lock(&db)?, &name).map_err(err)
}

#[tauri::command]
pub fn rename_profile(db: State<Db>, id: i64, name: String) -> Res<()> {
    profiles::rename_profile(&*lock(&db)?, id, &name).map_err(err)
}

/// Возвращает id профиля, который стал текущим после удаления.
#[tauri::command]
pub fn delete_profile(db: State<Db>, id: i64) -> Res<i64> {
    profiles::delete_profile(&*lock(&db)?, id).map_err(err)
}

#[tauri::command]
pub fn switch_profile(db: State<Db>, id: i64) -> Res<()> {
    profiles::switch_profile(&*lock(&db)?, id).map_err(err)
}
