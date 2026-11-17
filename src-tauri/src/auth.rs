//! Проверка владельца Mac: Touch ID или пароль учётной записи macOS.
//!
//! На macOS вызывается системный фреймворк LocalAuthentication (LAContext) напрямую
//! из Rust, без плагинов и без веб-интерфейса: система сама рисует окно Touch ID,
//! а в нём кнопку «Ввести пароль». Политика `DeviceOwnerAuthentication` значит
//! «Touch ID, а если его нет или он не сработал — пароль macOS».
//!
//! Логика блокировки работает через трейт `Authenticator`, поэтому в тестах
//! вместо системного окна подставляется заглушка.

use serde::Serialize;

/// Что умеет этот Mac.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// Проверка владельца вообще возможна (Touch ID или пароль).
    pub available: bool,
    /// Touch ID есть и настроен; иначе система спросит пароль.
    pub touch_id: bool,
    /// Почему проверка недоступна (текст от системы).
    pub reason: Option<String>,
}

pub trait Authenticator: Send + Sync {
    fn status(&self) -> AuthStatus;
    /// Показывает системное окно и ждёт ответа. Ok(true) — владелец подтверждён,
    /// Ok(false) — пользователь отменил, Err — система не смогла проверить.
    /// `reason` система показывает как «FinCal пытается {reason}».
    fn authenticate(&self, reason: &str) -> Result<bool, String>;
}

/// Аутентификатор для этой платформы.
pub fn system() -> Box<dyn Authenticator> {
    #[cfg(target_os = "macos")]
    {
        Box::new(mac::MacAuth)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Box::new(Unsupported)
    }
}

#[cfg(not(target_os = "macos"))]
struct Unsupported;

#[cfg(not(target_os = "macos"))]
impl Authenticator for Unsupported {
    fn status(&self) -> AuthStatus {
        AuthStatus { available: false, touch_id: false, reason: Some("доступно только на macOS".into()) }
    }
    fn authenticate(&self, _reason: &str) -> Result<bool, String> {
        Err("доступно только на macOS".into())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{AuthStatus, Authenticator};
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LABiometryType, LAContext, LAPolicy};
    use std::sync::{mpsc, Mutex};

    // Коды LAError, которые означают «отменили», а не «сломалось».
    const USER_CANCEL: isize = -2;
    const SYSTEM_CANCEL: isize = -4;
    const APP_CANCEL: isize = -9;

    pub struct MacAuth;

    fn describe(e: &NSError) -> String {
        e.localizedDescription().to_string()
    }

    impl Authenticator for MacAuth {
        fn status(&self) -> AuthStatus {
            // SAFETY: LAContext создаётся и используется в одном потоке и живёт до конца функции.
            let ctx = unsafe { LAContext::new() };
            match unsafe { ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication) } {
                Ok(()) => {
                    let touch_id = unsafe {
                        ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics).is_ok()
                            && ctx.biometryType() == LABiometryType::TouchID
                    };
                    AuthStatus { available: true, touch_id, reason: None }
                }
                Err(e) => AuthStatus { available: false, touch_id: false, reason: Some(describe(&e)) },
            }
        }

        fn authenticate(&self, reason: &str) -> Result<bool, String> {
            // SAFETY: контекст живёт, пока мы ждём ответа в rx.recv() ниже.
            let ctx = unsafe { LAContext::new() };
            unsafe { ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication) }
                .map_err(|e| describe(&e))?;

            let (tx, rx) = mpsc::channel::<Result<bool, String>>();
            let tx = Mutex::new(Some(tx));
            // Система вызывает этот блок один раз, в своём служебном потоке.
            let reply = RcBlock::new(move |ok: Bool, err: *mut NSError| {
                let result = if ok.as_bool() {
                    Ok(true)
                } else if err.is_null() {
                    Ok(false)
                } else {
                    // SAFETY: при ok == false система передаёт действительный NSError.
                    let e = unsafe { &*err };
                    match e.code() {
                        USER_CANCEL | SYSTEM_CANCEL | APP_CANCEL => Ok(false),
                        _ => Err(describe(e)),
                    }
                };
                if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                    let _ = tx.send(result);
                }
            });
            unsafe {
                ctx.evaluatePolicy_localizedReason_reply(
                    LAPolicy::DeviceOwnerAuthentication,
                    &NSString::from_str(reason),
                    &reply,
                );
            }
            rx.recv().map_err(|_| "проверка прервана".to_string())?
        }
    }
}
