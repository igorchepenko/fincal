//! Размер и положение главного окна. Чистая логика без Tauri, чтобы её можно было проверить тестами.
//!
//! Все числа в физических пикселях. Прямоугольник — внешний (вместе с заголовком окна).
//! Первый запуск: окно занимает всю рабочую область экрана (visible frame: без menubar и Dock).
//! Дальше возвращаем сохранённые размер и позицию, если они всё ещё помещаются на каком-то из экранов.

/// Ключ в `app_meta`, где хранится строка вида `x,y,w,h`.
pub const META_KEY: &str = "window.rect";

/// Меньше этого окно не восстанавливаем: считаем сохранённое значение испорченным.
pub const MIN_W: u32 = 940;
pub const MIN_H: u32 = 480;
/// Сколько окна обязано оставаться видимым на экране, иначе его не вытащить мышью.
const MIN_VISIBLE_W: i64 = 200;
const MIN_VISIBLE_H: i64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

pub fn encode(r: Rect) -> String {
    format!("{},{},{},{}", r.x, r.y, r.w, r.h)
}

pub fn decode(s: &str) -> Option<Rect> {
    let mut it = s.split(',').map(|p| p.trim());
    let x = it.next()?.parse().ok()?;
    let y = it.next()?.parse().ok()?;
    let w = it.next()?.parse().ok()?;
    let h = it.next()?.parse().ok()?;
    if it.next().is_some() {
        return None;
    }
    Some(Rect { x, y, w, h })
}

fn overlap(a: Rect, b: Rect) -> (i64, i64) {
    let left = (a.x as i64).max(b.x as i64);
    let right = (a.x as i64 + a.w as i64).min(b.x as i64 + b.w as i64);
    let top = (a.y as i64).max(b.y as i64);
    let bottom = (a.y as i64 + a.h as i64).min(b.y as i64 + b.h as i64);
    ((right - left).max(0), (bottom - top).max(0))
}

/// Подходит ли сохранённый прямоугольник: не меньше минимума и заметно виден хотя бы на одном экране.
pub fn is_usable(saved: Rect, areas: &[Rect]) -> bool {
    saved.w >= MIN_W
        && saved.h >= MIN_H
        && areas.iter().any(|&a| {
            let (ow, oh) = overlap(saved, a);
            ow >= MIN_VISIBLE_W && oh >= MIN_VISIBLE_H
        })
}

/// Куда поставить окно при запуске.
/// `areas` — рабочие области всех экранов, `primary` — рабочая область основного.
pub fn initial_rect(saved: Option<Rect>, areas: &[Rect], primary: Rect) -> Rect {
    match saved {
        Some(r) if is_usable(r, areas) => r,
        _ => primary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Экран 1440×900 с menubar сверху (25) и Dock снизу (70): рабочая область 1440×805.
    const PRIMARY: Rect = Rect { x: 0, y: 25, w: 1440, h: 805 };

    #[test]
    fn first_launch_fills_work_area() {
        assert_eq!(initial_rect(None, &[PRIMARY], PRIMARY), PRIMARY);
    }

    #[test]
    fn saved_rect_is_restored() {
        let saved = Rect { x: 100, y: 80, w: 1000, h: 700 };
        assert_eq!(initial_rect(Some(saved), &[PRIMARY], PRIMARY), saved);
    }

    #[test]
    fn saved_rect_on_missing_screen_falls_back() {
        // Раньше окно стояло на втором мониторе, который отключили.
        let saved = Rect { x: 3000, y: 0, w: 1200, h: 800 };
        assert_eq!(initial_rect(Some(saved), &[PRIMARY], PRIMARY), PRIMARY);
    }

    #[test]
    fn saved_rect_on_second_screen_is_kept() {
        let second = Rect { x: 1440, y: 0, w: 1920, h: 1055 };
        let saved = Rect { x: 1600, y: 100, w: 1200, h: 800 };
        assert_eq!(initial_rect(Some(saved), &[PRIMARY, second], PRIMARY), saved);
    }

    #[test]
    fn tiny_or_offscreen_rect_is_rejected() {
        let tiny = Rect { x: 0, y: 25, w: 100, h: 100 };
        assert!(!is_usable(tiny, &[PRIMARY]));
        // Почти целиком за краем экрана: торчит только 50 px.
        let edge = Rect { x: 1390, y: 100, w: 1000, h: 700 };
        assert!(!is_usable(edge, &[PRIMARY]));
    }

    #[test]
    fn encode_decode_round_trip_and_garbage() {
        let r = Rect { x: -20, y: 30, w: 1100, h: 700 };
        assert_eq!(decode(&encode(r)), Some(r));
        assert_eq!(decode("мусор"), None);
        assert_eq!(decode("1,2,3"), None);
        assert_eq!(decode("1,2,3,4,5"), None);
        assert_eq!(decode("1,2,-3,4"), None);
    }
}
