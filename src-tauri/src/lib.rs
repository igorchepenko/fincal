mod db;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let mut conn = rusqlite::Connection::open(dir.join("fincal.db"))?;
            db::migrate(&mut conn)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ошибка запуска FinCal");
}
