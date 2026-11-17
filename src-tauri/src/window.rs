//! Главное окно: при первом запуске растягиваем на рабочую область экрана (без menubar и Dock),
//! дальше помним размер и положение. Решения принимает `window_state`, здесь только обращения к Tauri.

use crate::commands::Db;
use crate::window_state::{self, Rect};
use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

fn area(r: &tauri::PhysicalRect<i32, u32>) -> Rect {
    Rect { x: r.position.x, y: r.position.y, w: r.size.width, h: r.size.height }
}

fn saved_rect(app: &AppHandle) -> Option<Rect> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|p| p.into_inner());
    let value: Option<String> = conn
        .query_row("SELECT value FROM app_meta WHERE key = ?1", [window_state::META_KEY], |r| r.get(0))
        .optional()
        .ok()
        .flatten();
    value.and_then(|v| window_state::decode(&v))
}

/// Ставит окно при запуске. Любая ошибка просто оставляет окно как в конфиге.
pub fn restore(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(Some(primary)) = win.primary_monitor() else { return };
    let Ok(monitors) = win.available_monitors() else { return };
    let areas: Vec<Rect> = monitors.iter().map(|m| area(m.work_area())).collect();
    let target = window_state::initial_rect(saved_rect(app), &areas, area(primary.work_area()));

    // Рабочая область задаёт внешний размер, а set_size принимает внутренний: вычитаем рамку и заголовок.
    let (Ok(outer), Ok(inner)) = (win.outer_size(), win.inner_size()) else { return };
    let frame_w = outer.width.saturating_sub(inner.width);
    let frame_h = outer.height.saturating_sub(inner.height);
    let _ = win.set_position(PhysicalPosition::new(target.x, target.y));
    let _ = win.set_size(PhysicalSize::new(
        target.w.saturating_sub(frame_w),
        target.h.saturating_sub(frame_h),
    ));
}

/// Запоминает текущие размер и положение. Развёрнутое на весь экран или свёрнутое окно не сохраняем.
pub fn save(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    if win.is_maximized().unwrap_or(false)
        || win.is_minimized().unwrap_or(false)
        || win.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else { return };
    let rect = Rect { x: pos.x, y: pos.y, w: size.width, h: size.height };
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|p| p.into_inner());
    let _ = conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![window_state::META_KEY, window_state::encode(rect)],
    );
}
