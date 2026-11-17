//! Блокировка приложения: когда закрывать окно и как открывать.
//!
//! Блокировка общая для всего приложения, а не для профиля, поэтому настройки
//! лежат в общей key-value таблице `app_meta` (ключи `lock.*`), а не в `settings`. Время меряется по часам системы в секундах,
//! чтобы сон Mac тоже считался: монотонные часы macOS во сне стоят.
//!
//! Всё, что здесь решается, не зависит от Tauri и системного окна Touch ID
//! и проверяется тестами с заглушкой `Authenticator`.

use crate::auth::{AuthStatus, Authenticator};
use crate::store;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub const KEY_ENABLED: &str = "lock.enabled";
pub const KEY_MODE: &str = "lock.mode";
pub const KEY_MINUTES: &str = "lock.minutes";

pub const DEFAULT_MINUTES: u32 = 5;
pub const MAX_MINUTES: u32 = 1440;

/// Перерыв между проверками больше этого считаем сном Mac:
/// пока он спал, окно никто не видел, значит это то же, что «свёрнуто».
pub const SLEEP_GAP_SECS: u64 = 90;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LockMode {
    /// Спрашивать при каждом открытии и разворачивании.
    Always,
    /// Спрашивать, если окно было свёрнуто или скрыто дольше `minutes`.
    After,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LockSettings {
    pub enabled: bool,
    pub mode: LockMode,
    pub minutes: u32,
}

impl Default for LockSettings {
    fn default() -> Self {
        LockSettings { enabled: false, mode: LockMode::Always, minutes: DEFAULT_MINUTES }
    }
}

fn get_meta(conn: &Connection, key: &str) -> store::Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> store::Result<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

impl LockSettings {
    pub fn normalized(mut self) -> Self {
        self.minutes = self.minutes.clamp(1, MAX_MINUTES);
        self
    }

    pub fn load(conn: &Connection) -> store::Result<Self> {
        let d = LockSettings::default();
        let enabled = get_meta(conn, KEY_ENABLED)?.as_deref() == Some("true");
        let mode = match get_meta(conn, KEY_MODE)?.as_deref() {
            Some("after") => LockMode::After,
            _ => LockMode::Always,
        };
        let minutes = get_meta(conn, KEY_MINUTES)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(d.minutes);
        Ok(LockSettings { enabled, mode, minutes }.normalized())
    }

    pub fn save(&self, conn: &Connection) -> store::Result<()> {
        let s = self.normalized();
        set_meta(conn, KEY_ENABLED, if s.enabled { "true" } else { "false" })?;
        set_meta(conn, KEY_MODE, match s.mode {
            LockMode::Always => "always",
            LockMode::After => "after",
        })?;
        set_meta(conn, KEY_MINUTES, &s.minutes.to_string())
    }
}

/// Заблокировано ли окно и с какого момента его не видно.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LockState {
    locked: bool,
    hidden_since: Option<u64>,
    last_seen: Option<u64>,
}

impl LockState {
    /// Состояние при запуске: если блокировка включена, сразу закрыто.
    pub fn on_launch(settings: &LockSettings) -> Self {
        LockState { locked: settings.enabled, ..Default::default() }
    }

    pub fn is_locked(&self) -> bool {
        self.locked
    }

    /// Очередное наблюдение за окном: `hidden` — свёрнуто или скрыто (⌘H).
    /// Возвращает true, если окно только что заблокировалось.
    pub fn observe(&mut self, now: u64, hidden: bool, s: &LockSettings) -> bool {
        if let Some(last) = self.last_seen {
            if now.saturating_sub(last) > SLEEP_GAP_SECS && self.hidden_since.is_none() {
                self.hidden_since = Some(last);
            }
        }
        self.last_seen = Some(now);
        if hidden && self.hidden_since.is_none() {
            self.hidden_since = Some(now);
        }

        let was = self.locked;
        if s.enabled {
            if let Some(since) = self.hidden_since {
                let due = match s.mode {
                    LockMode::Always => true,
                    LockMode::After => now.saturating_sub(since) >= u64::from(s.minutes) * 60,
                };
                if due {
                    self.locked = true;
                }
            }
        }
        if !hidden {
            self.hidden_since = None;
        }
        self.locked && !was
    }

    pub fn unlock(&mut self) {
        self.locked = false;
    }

    /// Блокировку выключили — открываем окно.
    pub fn apply_settings(&mut self, s: &LockSettings) {
        if !s.enabled {
            self.locked = false;
        }
    }
}

/// Что видит экран: заблокировано ли, настройки и возможности Mac.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    pub locked: bool,
    pub settings: LockSettings,
    pub auth: AuthStatus,
}

pub const REASON_UNLOCK: &str = "открыть ваши финансы";
pub const REASON_ENABLE: &str = "включить блокировку";
pub const REASON_DISABLE: &str = "выключить блокировку";

/// Блокировка целиком: состояние, кэш настроек и аутентификатор.
pub struct Lock {
    state: Mutex<LockState>,
    settings: Mutex<LockSettings>,
    auth: Box<dyn Authenticator>,
}

impl Lock {
    pub fn new(settings: LockSettings, auth: Box<dyn Authenticator>) -> Self {
        Lock { state: Mutex::new(LockState::on_launch(&settings)), settings: Mutex::new(settings), auth }
    }

    fn st(&self) -> std::sync::MutexGuard<'_, LockState> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn settings(&self) -> LockSettings {
        *self.settings.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn is_locked(&self) -> bool {
        self.st().is_locked()
    }

    pub fn status(&self) -> LockStatus {
        LockStatus { locked: self.is_locked(), settings: self.settings(), auth: self.auth.status() }
    }

    /// Наблюдение за окном. true — окно только что заблокировалось.
    pub fn observe(&self, now: u64, hidden: bool) -> bool {
        let s = self.settings();
        self.st().observe(now, hidden, &s)
    }

    /// Просит Touch ID или пароль и открывает окно. Ok(false) — отменили.
    /// Вызывать не из главного потока: ждёт, пока пользователь ответит.
    pub fn unlock(&self) -> Result<bool, String> {
        if !self.is_locked() {
            return Ok(true);
        }
        let ok = self.auth.authenticate(REASON_UNLOCK)?;
        if ok {
            self.st().unlock();
        }
        Ok(ok)
    }

    /// Проверяет новые настройки. Включение и выключение блокировки требуют
    /// Touch ID или пароля: так нельзя снять защиту, просто подойдя к Mac.
    /// Ok(None) — пользователь отменил, ничего не меняем.
    pub fn authorize_change(&self, new: LockSettings) -> Result<Option<LockSettings>, String> {
        let new = new.normalized();
        let old = self.settings();
        if new.enabled != old.enabled {
            if new.enabled && !self.auth.status().available {
                return Err("на этом Mac нельзя проверить владельца: нет ни Touch ID, ни пароля".into());
            }
            let reason = if new.enabled { REASON_ENABLE } else { REASON_DISABLE };
            if !self.auth.authenticate(reason)? {
                return Ok(None);
            }
        }
        Ok(Some(new))
    }

    /// Применяет уже сохранённые настройки.
    pub fn apply(&self, new: LockSettings) {
        *self.settings.lock().unwrap_or_else(|p| p.into_inner()) = new;
        self.st().apply_settings(&new);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// Заглушка вместо системного окна Touch ID.
    struct Fake {
        available: bool,
        answer: Result<bool, String>,
        asked: Arc<AtomicUsize>,
    }

    impl Authenticator for Fake {
        fn status(&self) -> AuthStatus {
            AuthStatus { available: self.available, touch_id: self.available, reason: None }
        }
        fn authenticate(&self, _reason: &str) -> Result<bool, String> {
            self.asked.fetch_add(1, Ordering::SeqCst);
            self.answer.clone()
        }
    }

    fn fake(answer: Result<bool, String>) -> (Box<Fake>, Arc<AtomicUsize>) {
        let asked = Arc::new(AtomicUsize::new(0));
        (Box::new(Fake { available: true, answer, asked: asked.clone() }), asked)
    }

    fn on(mode: LockMode, minutes: u32) -> LockSettings {
        LockSettings { enabled: true, mode, minutes }
    }

    #[test]
    fn launch_is_locked_only_when_enabled() {
        assert!(LockState::on_launch(&on(LockMode::Always, 5)).is_locked());
        assert!(!LockState::on_launch(&LockSettings::default()).is_locked());
    }

    #[test]
    fn always_mode_locks_as_soon_as_hidden() {
        let s = on(LockMode::Always, 5);
        let mut st = LockState::default();
        assert!(!st.observe(100, false, &s));
        assert!(st.observe(101, true, &s), "свернули — сразу закрыто");
        assert!(st.is_locked());
        assert!(!st.observe(102, false, &s), "развернули — остаётся закрытым");
        assert!(st.is_locked());
    }

    #[test]
    fn after_mode_waits_n_minutes() {
        let s = on(LockMode::After, 5);
        let mut st = LockState::default();
        st.observe(0, true, &s);
        assert!(!st.observe(299, true, &s), "4:59 — ещё открыто");
        assert!(st.observe(300, true, &s), "5:00 — закрыто, пока окно свёрнуто");
        assert!(st.is_locked());
    }

    #[test]
    fn after_mode_short_hide_does_not_lock() {
        let s = on(LockMode::After, 5);
        let mut st = LockState::default();
        st.observe(0, true, &s);
        st.observe(60, false, &s);
        st.observe(70, true, &s);
        assert!(!st.observe(70 + 299, true, &s), "отсчёт начинается заново с последнего сворачивания");
        assert!(!st.is_locked());
    }

    #[test]
    fn visible_window_never_locks() {
        let s = on(LockMode::After, 1);
        let mut st = LockState::default();
        for t in (0..3600).step_by(1) {
            st.observe(t, false, &s);
        }
        assert!(!st.is_locked());
    }

    #[test]
    fn mac_sleep_counts_as_hidden() {
        let mut st = LockState::default();
        st.observe(0, false, &on(LockMode::Always, 5));
        assert!(st.observe(600, false, &on(LockMode::Always, 5)), "проснулись через 10 минут");

        let mut st = LockState::default();
        let s = on(LockMode::After, 15);
        st.observe(0, false, &s);
        assert!(!st.observe(600, false, &s), "спали 10 минут, а порог 15");
        assert!(!st.is_locked());
    }

    #[test]
    fn disabled_never_locks() {
        let s = LockSettings::default();
        let mut st = LockState::default();
        st.observe(0, true, &s);
        st.observe(100_000, false, &s);
        assert!(!st.is_locked());
    }

    #[test]
    fn unlock_asks_and_opens() {
        let (auth, asked) = fake(Ok(true));
        let lock = Lock::new(on(LockMode::Always, 5), auth);
        assert!(lock.is_locked());
        assert_eq!(lock.unlock(), Ok(true));
        assert!(!lock.is_locked());
        assert_eq!(asked.load(Ordering::SeqCst), 1);
        assert_eq!(lock.unlock(), Ok(true), "уже открыто — не спрашиваем");
        assert_eq!(asked.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn cancel_or_error_keeps_locked() {
        let (auth, _) = fake(Ok(false));
        let lock = Lock::new(on(LockMode::Always, 5), auth);
        assert_eq!(lock.unlock(), Ok(false));
        assert!(lock.is_locked());

        let (auth, _) = fake(Err("сбой".into()));
        let lock = Lock::new(on(LockMode::Always, 5), auth);
        assert!(lock.unlock().is_err());
        assert!(lock.is_locked());
    }

    #[test]
    fn enabling_and_disabling_require_auth() {
        let (auth, asked) = fake(Ok(true));
        let lock = Lock::new(LockSettings::default(), auth);
        let new = lock.authorize_change(on(LockMode::Always, 5)).unwrap().unwrap();
        lock.apply(new);
        assert_eq!(asked.load(Ordering::SeqCst), 1);
        assert!(!lock.is_locked(), "включение не закрывает окно сразу");

        // Смена режима и минут без включения/выключения — без проверки.
        let new = lock.authorize_change(on(LockMode::After, 10)).unwrap().unwrap();
        lock.apply(new);
        assert_eq!(asked.load(Ordering::SeqCst), 1);

        let new = lock.authorize_change(LockSettings::default()).unwrap().unwrap();
        lock.apply(new);
        assert_eq!(asked.load(Ordering::SeqCst), 2);
        assert!(!lock.settings().enabled);
    }

    #[test]
    fn cancelled_change_is_not_applied() {
        let (auth, _) = fake(Ok(false));
        let lock = Lock::new(on(LockMode::Always, 5), auth);
        assert_eq!(lock.authorize_change(LockSettings::default()), Ok(None));
        assert!(lock.settings().enabled);
    }

    #[test]
    fn cannot_enable_without_auth_available() {
        let asked = Arc::new(AtomicUsize::new(0));
        let auth = Box::new(Fake { available: false, answer: Ok(true), asked: asked.clone() });
        let lock = Lock::new(LockSettings::default(), auth);
        assert!(lock.authorize_change(on(LockMode::Always, 5)).is_err());
        assert_eq!(asked.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn disabling_opens_window() {
        let (auth, _) = fake(Ok(true));
        let lock = Lock::new(on(LockMode::Always, 5), auth);
        lock.apply(LockSettings::default());
        assert!(!lock.is_locked());
    }

    #[test]
    fn settings_round_trip_and_defaults() {
        let mut conn = crate::db::open(std::path::Path::new(":memory:")).unwrap();
        crate::db::migrate(&mut conn).unwrap();
        assert_eq!(LockSettings::load(&conn).unwrap(), LockSettings::default());

        let s = LockSettings { enabled: true, mode: LockMode::After, minutes: 15 };
        s.save(&conn).unwrap();
        assert_eq!(LockSettings::load(&conn).unwrap(), s);
        assert_eq!(get_meta(&conn, KEY_MODE).unwrap().as_deref(), Some("after"));
        let in_profile: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings WHERE key LIKE 'lock.%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(in_profile, 0, "не в настройках профиля");
    }

    #[test]
    fn minutes_are_clamped() {
        let s = LockSettings { enabled: true, mode: LockMode::After, minutes: 0 }.normalized();
        assert_eq!(s.minutes, 1);
        let s = LockSettings { enabled: true, mode: LockMode::After, minutes: 99_999 }.normalized();
        assert_eq!(s.minutes, MAX_MINUTES);
    }

    #[test]
    fn settings_serialize_for_ui() {
        let json = serde_json::to_string(&on(LockMode::After, 7)).unwrap();
        assert_eq!(json, r#"{"enabled":true,"mode":"after","minutes":7}"#);
    }
}
