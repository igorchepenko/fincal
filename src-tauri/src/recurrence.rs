//! Календарь и повторяемость платежей. Чистые функции, без базы и без Tauri.
//!
//! Правило хранится в виде строки RRULE (RFC 5545), например
//! `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR`. Период серии (начало и конец) живёт отдельно,
//! в колонках `starts_on` / `ends_on`, поэтому `DTSTART`, `UNTIL` и `COUNT` в строке не
//! допускаются. Мы реализуем подмножество стандарта сами, а не берём crate `rrule`:
//! по RFC день месяца, которого нет (31-е в апреле), пропускается, а Игорю нужен перенос
//! на последний день месяца. Готовый crate так не умеет, а ещё тянет chrono и таблицы
//! часовых поясов, тогда как платёж это календарный день без часового пояса.
//!
//! Поддерживается:
//! * `FREQ` = DAILY | WEEKLY | MONTHLY | YEARLY, `INTERVAL` = N (1..=1000);
//! * `BYDAY` (только WEEKLY): дни недели `MO,TU,WE,TH,FR,SA,SU`, без порядковых номеров;
//! * `BYMONTHDAY` (только MONTHLY): числа 1..=31, а также -1 (последний день месяца).
//!
//! Отличия от RFC (сознательные):
//! * несуществующий день месяца переносится на последний день этого месяца;
//! * первое вхождение не обязано совпадать с началом периода: «по пятницам с понедельника»
//!   даёт первую пятницу, а не сам понедельник;
//! * неделя начинается с понедельника (WKST=MO), как в RFC по умолчанию.

use std::fmt;

/// Предел числа платежей в одной серии: защита от случайного «каждый день» на сотни лет.
pub const MAX_OCCURRENCES: usize = 20_000;
const MIN_YEAR: i32 = 1900;
const MAX_YEAR: i32 = 2200;
const MAX_INTERVAL: i64 = 1000;

// ---------- Календарные даты ----------

/// Календарный день без часового пояса.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Date {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

pub fn is_leap_year(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

pub fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if is_leap_year(y) {
                29
            } else {
                28
            }
        }
    }
}

impl Date {
    /// Строгий разбор `ГГГГ-ММ-ДД`: реальная дата (30 февраля и 29 февраля 2025 не пройдут).
    pub fn parse(s: &str) -> Option<Date> {
        let b = s.as_bytes();
        if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
            return None;
        }
        let digits = |r: std::ops::Range<usize>| -> Option<u32> {
            let part = &s[r];
            if part.bytes().all(|c| c.is_ascii_digit()) {
                part.parse().ok()
            } else {
                None
            }
        };
        let (y, m, d) = (digits(0..4)? as i32, digits(5..7)?, digits(8..10)?);
        if !(MIN_YEAR..=MAX_YEAR).contains(&y) || !(1..=12).contains(&m) || d < 1 || d > days_in_month(y, m) {
            return None;
        }
        Some(Date { year: y, month: m, day: d })
    }

    /// Число дней от 1970-01-01 (алгоритм days_from_civil).
    fn to_days(self) -> i64 {
        let y = i64::from(self.year) - i64::from(self.month <= 2);
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let m = i64::from(self.month);
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(self.day) - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }

    fn from_days(z: i64) -> Date {
        let z = z + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
        let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
        Date { year, month, day }
    }

    /// День недели: 0 = понедельник … 6 = воскресенье.
    pub fn weekday(self) -> u32 {
        // 1970-01-01 был четвергом (3).
        (self.to_days() + 3).rem_euclid(7) as u32
    }

    pub fn add_days(self, n: i64) -> Date {
        Date::from_days(self.to_days() + n)
    }

    #[cfg(test)]
    pub fn days_between(self, other: Date) -> i64 {
        other.to_days() - self.to_days()
    }
}

impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

// ---------- Правило ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Freq {
    pub fn as_str(self) -> &'static str {
        match self {
            Freq::Daily => "daily",
            Freq::Weekly => "weekly",
            Freq::Monthly => "monthly",
            Freq::Yearly => "yearly",
        }
    }

    pub fn parse(s: &str) -> Option<Freq> {
        match s {
            "daily" => Some(Freq::Daily),
            "weekly" => Some(Freq::Weekly),
            "monthly" => Some(Freq::Monthly),
            "yearly" => Some(Freq::Yearly),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub freq: Freq,
    pub interval: u32,
    /// 0 = понедельник … 6 = воскресенье; пусто = день недели начала периода.
    pub weekdays: Vec<u32>,
    /// 1..=31 или -1 (последний день месяца); пусто = число начала периода.
    pub month_days: Vec<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleError {
    BadRule,
    BadInterval,
    BadWeekday,
    BadMonthDay,
    WeekdaysNotWeekly,
    MonthDaysNotMonthly,
    BadDate,
    EndBeforeStart,
    TooMany,
    Empty,
}

impl RuleError {
    pub fn message(self) -> &'static str {
        match self {
            RuleError::BadRule => "неверное правило повторения",
            RuleError::BadInterval => "интервал повторения: целое число от 1 до 1000",
            RuleError::BadWeekday => "неверный день недели (нужны MO, TU, WE, TH, FR, SA, SU)",
            RuleError::BadMonthDay => "день месяца: число от 1 до 31 или -1 (последний день)",
            RuleError::WeekdaysNotWeekly => "дни недели можно задавать только для повторения по неделям",
            RuleError::MonthDaysNotMonthly => "дни месяца можно задавать только для повторения по месяцам",
            RuleError::BadDate => "дата должна быть настоящей датой в формате ГГГГ-ММ-ДД",
            RuleError::EndBeforeStart => "конец периода раньше его начала",
            RuleError::TooMany => "в серии больше 20 000 платежей: сократи период или увеличь интервал",
            RuleError::Empty => "в этом периоде нет ни одного платежа серии",
        }
    }
}

const WEEKDAY_CODES: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

pub fn weekday_code(n: u32) -> &'static str {
    WEEKDAY_CODES[n as usize % 7]
}

pub fn weekday_from_code(code: &str) -> Option<u32> {
    WEEKDAY_CODES.iter().position(|c| c.eq_ignore_ascii_case(code)).map(|i| i as u32)
}

impl Rule {
    /// Проверка и нормализация (сортировка, без повторов).
    pub fn new(freq: Freq, interval: i64, weekdays: &[u32], month_days: &[i32]) -> Result<Rule, RuleError> {
        if !(1..=MAX_INTERVAL).contains(&interval) {
            return Err(RuleError::BadInterval);
        }
        if weekdays.iter().any(|d| *d > 6) {
            return Err(RuleError::BadWeekday);
        }
        if month_days.iter().any(|d| *d != -1 && !(1..=31).contains(d)) {
            return Err(RuleError::BadMonthDay);
        }
        if !weekdays.is_empty() && freq != Freq::Weekly {
            return Err(RuleError::WeekdaysNotWeekly);
        }
        if !month_days.is_empty() && freq != Freq::Monthly {
            return Err(RuleError::MonthDaysNotMonthly);
        }
        let mut wd = weekdays.to_vec();
        wd.sort_unstable();
        wd.dedup();
        let mut md = month_days.to_vec();
        // Обычные числа по возрастанию, затем «последний день».
        md.sort_unstable_by_key(|d| if *d == -1 { 99 } else { *d });
        md.dedup();
        Ok(Rule { freq, interval: interval as u32, weekdays: wd, month_days: md })
    }

    /// Каноническая строка RRULE: она и хранится в базе.
    pub fn to_rrule(&self) -> String {
        let freq = match self.freq {
            Freq::Daily => "DAILY",
            Freq::Weekly => "WEEKLY",
            Freq::Monthly => "MONTHLY",
            Freq::Yearly => "YEARLY",
        };
        let mut s = format!("FREQ={freq};INTERVAL={}", self.interval);
        if !self.weekdays.is_empty() {
            let codes: Vec<&str> = self.weekdays.iter().map(|d| weekday_code(*d)).collect();
            s.push_str(&format!(";BYDAY={}", codes.join(",")));
        }
        if !self.month_days.is_empty() {
            let days: Vec<String> = self.month_days.iter().map(|d| d.to_string()).collect();
            s.push_str(&format!(";BYMONTHDAY={}", days.join(",")));
        }
        s
    }

    pub fn parse(rrule: &str) -> Result<Rule, RuleError> {
        let mut freq = None;
        let mut interval: i64 = 1;
        let mut weekdays = vec![];
        let mut month_days = vec![];
        for part in rrule.trim().split(';').filter(|p| !p.trim().is_empty()) {
            let (key, value) = part.split_once('=').ok_or(RuleError::BadRule)?;
            match key.trim().to_ascii_uppercase().as_str() {
                "FREQ" => {
                    freq = Some(match value.trim().to_ascii_uppercase().as_str() {
                        "DAILY" => Freq::Daily,
                        "WEEKLY" => Freq::Weekly,
                        "MONTHLY" => Freq::Monthly,
                        "YEARLY" => Freq::Yearly,
                        _ => return Err(RuleError::BadRule),
                    })
                }
                "INTERVAL" => interval = value.trim().parse().map_err(|_| RuleError::BadInterval)?,
                "BYDAY" => {
                    for code in value.split(',') {
                        weekdays.push(weekday_from_code(code.trim()).ok_or(RuleError::BadWeekday)?);
                    }
                }
                "BYMONTHDAY" => {
                    for d in value.split(',') {
                        month_days.push(d.trim().parse::<i32>().map_err(|_| RuleError::BadMonthDay)?);
                    }
                }
                // DTSTART/UNTIL/COUNT: период серии хранится отдельно; остальное не поддерживаем.
                _ => return Err(RuleError::BadRule),
            }
        }
        Rule::new(freq.ok_or(RuleError::BadRule)?, interval, &weekdays, &month_days)
    }

    /// Все даты серии в периоде `[start, end]` включительно, по возрастанию.
    /// Пустой результат не ошибка (его решает вызывающий код). Больше `MAX_OCCURRENCES` даёт ошибку.
    pub fn occurrences(&self, start: Date, end: Date) -> Result<Vec<Date>, RuleError> {
        if end < start {
            return Err(RuleError::EndBeforeStart);
        }
        let mut out: Vec<Date> = Vec::new();
        let step = i64::from(self.interval);
        let push = |out: &mut Vec<Date>, d: Date| -> Result<(), RuleError> {
            if out.len() >= MAX_OCCURRENCES {
                return Err(RuleError::TooMany);
            }
            out.push(d);
            Ok(())
        };
        match self.freq {
            Freq::Daily => {
                let mut d = start;
                while d <= end {
                    push(&mut out, d)?;
                    d = d.add_days(step);
                }
            }
            Freq::Weekly => {
                let wds: Vec<u32> = if self.weekdays.is_empty() { vec![start.weekday()] } else { self.weekdays.clone() };
                // Понедельник недели начала: от него считаются недели интервала.
                let mut week = start.add_days(-i64::from(start.weekday()));
                while week <= end {
                    for wd in &wds {
                        let d = week.add_days(i64::from(*wd));
                        if d >= start && d <= end {
                            push(&mut out, d)?;
                        }
                    }
                    week = week.add_days(7 * step);
                }
            }
            Freq::Monthly => {
                let first_month = i64::from(start.year) * 12 + i64::from(start.month) - 1;
                let mut k: i64 = 0;
                loop {
                    let idx = first_month + k * step;
                    let (y, m) = ((idx.div_euclid(12)) as i32, (idx.rem_euclid(12)) as u32 + 1);
                    if y > end.year || (y == end.year && m > end.month) {
                        break;
                    }
                    let dim = days_in_month(y, m);
                    let wanted: Vec<i32> = if self.month_days.is_empty() { vec![start.day as i32] } else { self.month_days.clone() };
                    let mut days: Vec<u32> = wanted
                        .iter()
                        .map(|d| if *d < 0 { dim } else { (*d as u32).min(dim) })
                        .collect();
                    days.sort_unstable();
                    days.dedup();
                    for day in days {
                        let d = Date { year: y, month: m, day };
                        if d >= start && d <= end {
                            push(&mut out, d)?;
                        }
                    }
                    k += 1;
                }
            }
            Freq::Yearly => {
                let mut k: i64 = 0;
                loop {
                    let y = i64::from(start.year) + k * step;
                    if y > i64::from(end.year) {
                        break;
                    }
                    let y = y as i32;
                    let d = Date { year: y, month: start.month, day: start.day.min(days_in_month(y, start.month)) };
                    if d >= start && d <= end {
                        push(&mut out, d)?;
                    }
                    k += 1;
                }
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Date {
        Date::parse(s).unwrap()
    }

    fn run(rrule: &str, from: &str, to: &str) -> Vec<String> {
        Rule::parse(rrule).unwrap().occurrences(d(from), d(to)).unwrap().iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn parses_only_real_dates() {
        assert!(Date::parse("2024-02-29").is_some());
        assert!(Date::parse("2025-02-29").is_none());
        assert!(Date::parse("2100-02-29").is_none(), "2100 не високосный");
        assert!(Date::parse("2000-02-29").is_some(), "2000 високосный");
        assert!(Date::parse("2026-04-31").is_none());
        assert!(Date::parse("2026-13-01").is_none());
        assert!(Date::parse("2026-1-01").is_none());
        assert!(Date::parse("2026-01-01x").is_none());
        assert!(Date::parse("+026-01-01").is_none());
        assert!(Date::parse("1800-01-01").is_none());
    }

    #[test]
    fn weekday_and_days_arithmetic() {
        assert_eq!(d("1970-01-01").weekday(), 3, "четверг");
        assert_eq!(d("2026-03-02").weekday(), 0, "понедельник");
        assert_eq!(d("2026-03-01").weekday(), 6, "воскресенье");
        assert_eq!(d("2024-02-28").add_days(2).to_string(), "2024-03-01");
        assert_eq!(d("2023-02-28").add_days(1).to_string(), "2023-03-01");
        assert_eq!(d("2026-12-31").add_days(1).to_string(), "2027-01-01");
        assert_eq!(d("2026-01-01").add_days(-1).to_string(), "2025-12-31");
        assert_eq!(d("2024-01-01").days_between(d("2025-01-01")), 366);
        // Круговой обход на широком диапазоне.
        let mut x = d("1900-01-01");
        for _ in 0..200_000 {
            let next = x.add_days(1);
            assert_eq!(Date::from_days(next.to_days()), next);
            assert!(next > x);
            x = next;
        }
    }

    #[test]
    fn weekly_march_has_four_or_five() {
        // Март 2026: 1 марта это воскресенье, воскресений пять.
        assert_eq!(run("FREQ=WEEKLY", "2026-03-01", "2026-03-31"), ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"]);
        // Начало во вторник: вторников в марте 2026 пять (3, 10, 17, 24, 31).
        assert_eq!(run("FREQ=WEEKLY", "2026-03-03", "2026-03-31").len(), 5);
        // А среда, 4 марта: 4, 11, 18, 25, всего четыре.
        assert_eq!(run("FREQ=WEEKLY", "2026-03-04", "2026-03-31"), ["2026-03-04", "2026-03-11", "2026-03-18", "2026-03-25"]);
    }

    #[test]
    fn period_bounds_are_inclusive() {
        assert_eq!(run("FREQ=DAILY", "2026-03-01", "2026-03-01"), ["2026-03-01"]);
        assert_eq!(run("FREQ=DAILY", "2026-03-30", "2026-04-02"), ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02"]);
        assert_eq!(run("FREQ=WEEKLY", "2026-03-01", "2026-03-15").last().unwrap(), "2026-03-15");
        assert_eq!(run("FREQ=WEEKLY", "2026-03-01", "2026-03-14").last().unwrap(), "2026-03-08");
        assert!(Rule::parse("FREQ=DAILY").unwrap().occurrences(d("2026-03-02"), d("2026-03-01")).is_err());
    }

    #[test]
    fn daily_with_interval() {
        assert_eq!(run("FREQ=DAILY;INTERVAL=3", "2026-02-26", "2026-03-10"), ["2026-02-26", "2026-03-01", "2026-03-04", "2026-03-07", "2026-03-10"]);
        // Через границу високосного года: 2024-02-28 + 2 дня = 29 февраля.
        assert_eq!(run("FREQ=DAILY;INTERVAL=1", "2024-02-28", "2024-03-01"), ["2024-02-28", "2024-02-29", "2024-03-01"]);
        assert_eq!(run("FREQ=DAILY", "2023-02-28", "2023-03-01"), ["2023-02-28", "2023-03-01"]);
    }

    #[test]
    fn weekly_with_weekdays_and_interval() {
        // Пн и пт каждую неделю.
        assert_eq!(
            run("FREQ=WEEKLY;BYDAY=FR,MO", "2026-03-02", "2026-03-16"),
            ["2026-03-02", "2026-03-06", "2026-03-09", "2026-03-13", "2026-03-16"]
        );
        // Каждые 2 недели, Вт и Чт; старт в среду 4 марта: первая неделя (2–8 марта) даёт только Чт 5.
        assert_eq!(
            run("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH", "2026-03-04", "2026-04-02"),
            ["2026-03-05", "2026-03-17", "2026-03-19", "2026-03-31", "2026-04-02"]
        );
        // Без BYDAY берётся день недели начала.
        assert_eq!(run("FREQ=WEEKLY;INTERVAL=2", "2026-03-04", "2026-04-02"), ["2026-03-04", "2026-03-18", "2026-04-01"]);
        // Начало не совпадает с днём недели правила: первое вхождение позже начала.
        assert_eq!(run("FREQ=WEEKLY;BYDAY=FR", "2026-03-02", "2026-03-10"), ["2026-03-06"]);
        // Неделя начинается с понедельника: старт в воскресенье, Пн той же недели уже в прошлом.
        assert_eq!(run("FREQ=WEEKLY;BYDAY=MO,SU", "2026-03-08", "2026-03-16"), ["2026-03-08", "2026-03-09", "2026-03-15", "2026-03-16"]);
    }

    #[test]
    fn monthly_clamps_missing_day_to_last_day() {
        // 31-е: в феврале 28 (2026), в апреле 30, Дальше не «дрейфует».
        assert_eq!(
            run("FREQ=MONTHLY", "2026-01-31", "2026-06-30"),
            ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]
        );
        // Високосный год: 29 февраля есть; в 2025 перенос на 28.
        assert_eq!(run("FREQ=MONTHLY;BYMONTHDAY=29", "2024-01-01", "2024-03-31"), ["2024-01-29", "2024-02-29", "2024-03-29"]);
        assert_eq!(run("FREQ=MONTHLY;BYMONTHDAY=29", "2025-01-01", "2025-03-31"), ["2025-01-29", "2025-02-28", "2025-03-29"]);
        // 30 и 31: в феврале оба в 28, дубликата нет.
        assert_eq!(
            run("FREQ=MONTHLY;BYMONTHDAY=30,31", "2026-02-01", "2026-02-28"),
            ["2026-02-28"]
        );
        assert_eq!(
            run("FREQ=MONTHLY;BYMONTHDAY=30,31", "2026-04-01", "2026-04-30"),
            ["2026-04-30"]
        );
        assert_eq!(
            run("FREQ=MONTHLY;BYMONTHDAY=30,31", "2026-03-01", "2026-03-31"),
            ["2026-03-30", "2026-03-31"]
        );
    }

    #[test]
    fn monthly_last_day_and_several_days() {
        assert_eq!(
            run("FREQ=MONTHLY;BYMONTHDAY=-1", "2024-01-01", "2024-04-30"),
            ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]
        );
        // Аванс и зарплата: 5 и 20.
        assert_eq!(
            run("FREQ=MONTHLY;BYMONTHDAY=20,5", "2026-03-10", "2026-05-10"),
            ["2026-03-20", "2026-04-05", "2026-04-20", "2026-05-05"]
        );
    }

    #[test]
    fn monthly_interval_and_year_rollover() {
        assert_eq!(
            run("FREQ=MONTHLY;INTERVAL=3", "2026-11-15", "2027-12-31"),
            ["2026-11-15", "2027-02-15", "2027-05-15", "2027-08-15", "2027-11-15"]
        );
        assert_eq!(run("FREQ=MONTHLY;INTERVAL=1", "2026-12-31", "2027-01-31"), ["2026-12-31", "2027-01-31"]);
        // Первый месяц: число раньше начала периода пропускается.
        assert_eq!(run("FREQ=MONTHLY;BYMONTHDAY=1", "2026-03-15", "2026-05-31"), ["2026-04-01", "2026-05-01"]);
        // Период короче месяца без попадания даёт пустой список.
        assert!(run("FREQ=MONTHLY;BYMONTHDAY=25", "2026-03-01", "2026-03-24").is_empty());
    }

    #[test]
    fn yearly_leap_day() {
        assert_eq!(
            run("FREQ=YEARLY", "2024-02-29", "2028-12-31"),
            ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]
        );
        assert_eq!(run("FREQ=YEARLY;INTERVAL=2", "2026-05-01", "2031-05-01"), ["2026-05-01", "2028-05-01", "2030-05-01"]);
    }

    #[test]
    fn long_series_over_a_year() {
        // Ежемесячно на 5 лет вперёд: 61 платёж, последний ровно на границе.
        let v = run("FREQ=MONTHLY;BYMONTHDAY=15", "2026-01-01", "2031-01-31");
        assert_eq!(v.len(), 61);
        assert_eq!(v.first().unwrap(), "2026-01-15");
        assert_eq!(v.last().unwrap(), "2031-01-15");
        // Каждый день ровно год: 365 или 366.
        assert_eq!(run("FREQ=DAILY", "2025-01-01", "2025-12-31").len(), 365);
        assert_eq!(run("FREQ=DAILY", "2024-01-01", "2024-12-31").len(), 366);
        // Тысячи записей: каждый день 10 лет (3652 дня, два лишних високосных 2028 и 2032 внутри).
        assert_eq!(run("FREQ=DAILY", "2026-01-01", "2035-12-31").len(), 3652);
    }

    #[test]
    fn too_many_is_an_error() {
        let r = Rule::parse("FREQ=DAILY").unwrap();
        assert_eq!(r.occurrences(d("1900-01-01"), d("2200-12-31")), Err(RuleError::TooMany));
        assert_eq!(r.occurrences(d("2026-01-01"), d("2026-01-01")).unwrap().len(), 1);
    }

    #[test]
    fn rrule_roundtrip_and_validation() {
        let r = Rule::parse("freq=weekly;interval=2;byday=fr,mo").unwrap();
        assert_eq!(r.to_rrule(), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR");
        assert_eq!(Rule::parse(&r.to_rrule()).unwrap(), r);
        let m = Rule::parse("FREQ=MONTHLY;BYMONTHDAY=-1,31,5").unwrap();
        assert_eq!(m.to_rrule(), "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=5,31,-1");
        assert_eq!(Rule::parse("FREQ=DAILY").unwrap().to_rrule(), "FREQ=DAILY;INTERVAL=1");

        assert!(Rule::parse("").is_err());
        assert!(Rule::parse("INTERVAL=2").is_err());
        assert!(Rule::parse("FREQ=HOURLY").is_err());
        assert!(Rule::parse("FREQ=DAILY;COUNT=3").is_err());
        assert!(Rule::parse("FREQ=DAILY;UNTIL=20260101").is_err());
        assert_eq!(Rule::parse("FREQ=DAILY;INTERVAL=0"), Err(RuleError::BadInterval));
        assert_eq!(Rule::parse("FREQ=DAILY;INTERVAL=-2"), Err(RuleError::BadInterval));
        assert_eq!(Rule::parse("FREQ=DAILY;INTERVAL=1001"), Err(RuleError::BadInterval));
        assert_eq!(Rule::parse("FREQ=WEEKLY;BYDAY=1MO"), Err(RuleError::BadWeekday));
        assert_eq!(Rule::parse("FREQ=DAILY;BYDAY=MO"), Err(RuleError::WeekdaysNotWeekly));
        assert_eq!(Rule::parse("FREQ=WEEKLY;BYMONTHDAY=1"), Err(RuleError::MonthDaysNotMonthly));
        assert_eq!(Rule::parse("FREQ=MONTHLY;BYMONTHDAY=0"), Err(RuleError::BadMonthDay));
        assert_eq!(Rule::parse("FREQ=MONTHLY;BYMONTHDAY=32"), Err(RuleError::BadMonthDay));
        assert_eq!(Rule::parse("FREQ=MONTHLY;BYMONTHDAY=-2"), Err(RuleError::BadMonthDay));
    }
}
