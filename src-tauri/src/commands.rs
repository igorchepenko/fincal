//! Tauri-команды: тонкая обёртка над `store`. Экраны вызывают только их.

use crate::store::{self, Account, Category, NewAccount, NewCategory, NewRule, NewTransaction, Tag, Transaction};
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

#[tauri::command]
pub fn list_accounts(db: State<Db>) -> Res<Vec<Account>> {
    store::list_accounts(&*lock(&db)?).map_err(err)
}

#[tauri::command]
pub fn create_account(db: State<Db>, account: NewAccount) -> Res<i64> {
    store::create_account(&*lock(&db)?, &account).map_err(err)
}

#[tauri::command]
pub fn account_balance(db: State<Db>, account_id: i64) -> Res<i64> {
    store::account_balance_kop(&*lock(&db)?, account_id).map_err(err)
}

#[tauri::command]
pub fn list_categories(db: State<Db>) -> Res<Vec<Category>> {
    store::list_categories(&*lock(&db)?).map_err(err)
}

#[tauri::command]
pub fn create_category(db: State<Db>, category: NewCategory) -> Res<i64> {
    store::create_category(&*lock(&db)?, &category).map_err(err)
}

#[tauri::command]
pub fn list_transactions(db: State<Db>, from: String, to: String) -> Res<Vec<Transaction>> {
    store::list_transactions(&*lock(&db)?, &from, &to).map_err(err)
}

#[tauri::command]
pub fn create_transaction(db: State<Db>, transaction: NewTransaction) -> Res<i64> {
    store::create_transaction(&mut *lock(&db)?, &transaction).map_err(err)
}

#[tauri::command]
pub fn set_transaction_status(
    db: State<Db>,
    id: i64,
    status: String,
    actual_amount_kop: Option<i64>,
) -> Res<()> {
    store::set_transaction_status(&*lock(&db)?, id, &status, actual_amount_kop).map_err(err)
}

#[tauri::command]
pub fn delete_transaction(db: State<Db>, id: i64) -> Res<()> {
    store::delete_transaction(&*lock(&db)?, id).map_err(err)
}

#[tauri::command]
pub fn list_tags(db: State<Db>) -> Res<Vec<Tag>> {
    store::list_tags(&*lock(&db)?).map_err(err)
}

#[tauri::command]
pub fn create_tag(db: State<Db>, name: String) -> Res<i64> {
    store::create_tag(&*lock(&db)?, &name).map_err(err)
}

#[tauri::command]
pub fn set_transaction_tags(db: State<Db>, transaction_id: i64, tag_ids: Vec<i64>) -> Res<()> {
    store::set_transaction_tags(&mut *lock(&db)?, transaction_id, &tag_ids).map_err(err)
}

#[tauri::command]
pub fn create_rule(db: State<Db>, rule: NewRule) -> Res<i64> {
    store::create_rule(&*lock(&db)?, &rule).map_err(err)
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Res<Option<String>> {
    store::get_setting(&*lock(&db)?, &key).map_err(err)
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Res<()> {
    store::set_setting(&*lock(&db)?, &key, &value).map_err(err)
}
