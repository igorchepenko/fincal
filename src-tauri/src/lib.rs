mod commands;
mod db;
mod store;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let mut conn = db::open(&dir.join("fincal.db"))?;
            db::migrate(&mut conn)?;
            app.manage(commands::Db(std::sync::Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::create_account,
            commands::account_balance,
            commands::list_categories,
            commands::create_category,
            commands::list_transactions,
            commands::create_transaction,
            commands::set_transaction_status,
            commands::delete_transaction,
            commands::list_tags,
            commands::create_tag,
            commands::set_transaction_tags,
            commands::create_rule,
            commands::get_setting,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска FinCal");
}
