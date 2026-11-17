mod auth;
mod commands;
mod db;
mod payments;
mod profiles;
mod recurrence;
mod lock;
mod lock_commands;
mod store;
mod window;
mod window_state;

use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let mut conn = db::open(&dir.join("fincal.db"))?;
            db::migrate(&mut conn)?;
            // Настройки блокировки читаем до показа окна: если она включена, окно стартует закрытым.
            let lock_settings = lock::LockSettings::load(&conn).unwrap_or_default();
            app.manage(lock::Lock::new(lock_settings, auth::system()));
            app.manage(commands::Db(std::sync::Mutex::new(conn)));
            window::restore(app.handle());
            lock_commands::start_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::create_account,
            commands::update_account,
            commands::archive_account,
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
            commands::create_payment,
            commands::list_payments,
            commands::get_payment,
            commands::get_recurrence,
            commands::preview_recurrence,
            commands::update_payment,
            commands::delete_payment,
            commands::get_setting,
            commands::set_setting,
            commands::list_profiles,
            commands::get_current_profile,
            commands::create_profile,
            commands::rename_profile,
            commands::delete_profile,
            commands::switch_profile,
            lock_commands::lock_status,
            lock_commands::unlock,
            lock_commands::set_lock_settings,
        ])
        .build(tauri::generate_context!())
        .expect("ошибка запуска FinCal")
        .run(|app, event| match event {
            // Положение окна пишем при закрытии и выходе: во время перетаскивания база не нагружается.
            RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { .. }, .. } if label == "main" => {
                window::save(app)
            }
            RunEvent::ExitRequested { .. } => window::save(app),
            _ => {}
        });
}
