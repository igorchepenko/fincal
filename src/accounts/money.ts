/** Деньги в приложении: целые копейки. Здесь перевод между копейками и текстом для экрана. */

const NBSP = " ";
const MINUS = "−";
const MAX_RUB_DIGITS = 12;

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** «−25 000 ₽», «12 345,67 ₽». Копейки показываются только когда они есть. Минус настоящий (−), не дефис. */
export function formatKop(kop: number): string {
  const abs = Math.abs(kop);
  const rub = Math.trunc(abs / 100);
  const frac = abs % 100;
  const body = group(String(rub)) + (frac ? "," + String(frac).padStart(2, "0") : "");
  return (kop < 0 ? MINUS : "") + body + NBSP + "₽";
}

/**
 * Разбирает сумму, которую ввёл человек: «25000», «25 000,5», «-1200.30», «−300».
 * Возвращает копейки или null, если это не сумма. Без дробных чисел, чтобы не копить ошибки округления.
 */
export function parseRubles(text: string): number | null {
  const t = text.replace(/[\s  ]/g, "").replace(",", ".").replace(MINUS, "-");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m || m[2].length > MAX_RUB_DIGITS) return null;
  const kop = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -kop : kop;
}

/** Сумма для поля ввода: «25000,5», без знака рубля и разделителей тысяч. */
export function kopToInput(kop: number): string {
  const abs = Math.abs(kop);
  const frac = abs % 100;
  const body = String(Math.trunc(abs / 100)) + (frac ? "," + String(frac).padStart(2, "0") : "");
  return (kop < 0 ? MINUS : "") + body;
}
