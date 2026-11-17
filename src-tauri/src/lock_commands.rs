//! Tauri-команды и наблюдатель окна для блокировки. Решения принимает `lock.rs`,
//! здесь только связка с окном, базой и событиями для веб-интерфейса.

use crate::commands::Db;
use crate::lock::{Lock, LockSettings, LockStatus};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

/// Событие для веб-интерфейса: true — окно закрыто, false — открыто.
pub const EVENT: &str = "lock-changed";

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Раз в секунду смотрит, свёрнуто ли окно или скрыто, и закрывает его по настройкам.
/// Закрываем, пока окно не видно, чтобы после разворачивания данные не мелькнули.
pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Some(w) = app.get_webview_window("main") {
            let hidden = w.is_minimized().unwrap_or(false) || !w.is_visible().unwrap_or(true);
            if app.state::<Lock>().observe(now(), hidden) {
                let _ = app.emit(EVENT, true);
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}

#[tauri::command]
pub fn lock_status(lock: State<Lock>) -> LockStatus {
    lock.status()
}

/// Показывает системное окно Touch ID (или пароля macOS). true — открыто.
#[tauri::command]
pub async fn unlock(app: AppHandle) -> Result<bool, String> {
    let a = app.clone();
    let ok = tauri::async_runtime::spawn_blocking(move || a.state::<Lock>().unlock())
        .await
        .map_err(|e| e.to_string())??;
    if ok {
        let _ = app.emit(EVENT, false);
    }
    Ok(ok)
}

/// Сохраняет настройки блокировки. None — пользователь отменил проверку.
#[tauri::command]
pub async fn set_lock_settings(app: AppHandle, settings: LockSettings) -> Result<Option<LockStatus>, String> {
    let a = app.clone();
    let approved = tauri::async_runtime::spawn_blocking(move || a.state::<Lock>().authorize_change(settings))
        .await
        .map_err(|e| e.to_string())??;
    let Some(new) = approved else { return Ok(None) };
    {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "база занята".to_string())?;
        new.save(&conn).map_err(|e| e.to_string())?;
    }
    let lock = app.state::<Lock>();
    lock.apply(new);
    let status = lock.status();
    let _ = app.emit(EVENT, status.locked);
    Ok(Some(status))
}
