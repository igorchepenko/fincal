import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Account } from "../accounts/api";
import type { MonthGroup, Payment, PaymentList, RecurrenceInfo, RecurrenceSpec } from "./api";
import { addMonths, diffDays, formatDay, isValidDay, monthEnd, monthTitle, parseIso, weekdayCode } from "./dates";
import {
  buildRecurrence,
  emptyForm,
  formFromPayment,
  parseMonthDays,
  recurrenceChanged,
  toNewPayment,
  toPatch,
  validatePaymentForm,
  type PaymentForm,
} from "./form";
import { describeRule, effectiveKop, isOverdue, monthNet, signedAmount, signedKop, sumNet } from "./model";
import { MonthCard, noFilters, periodError, periodFor, periodTitle, ROWS_PER_MONTH, shiftPeriod, SummaryCard, toBackendFilter, EmptyPayments } from "./PaymentsScreen";
import { CompleteDialog, DeleteDialog, PaymentDialog, previewText, ScopeStep } from "./PaymentDialog";
import { tauriPaymentApi } from "./api";

const NB = "\u00a0";
const MINUS = "−";

function pay(p: Partial<Payment> & { id: number }): Payment {
  return {
    account_id: 1,
    rule_id: null,
    direction: "expense",
    title: "Тестовый платёж",
    note: null,
    amount_kop: 150_000,
    actual_amount_kop: null,
    planned_on: "2030-03-10",
    status: "planned",
    ...p,
  };
}

const account: Account = {
  id: 1,
  name: "Тестовая карта",
  kind: "debit_card",
  currency: "RUB",
  opening_balance_kop: 0,
  balance_on: "2030-01-01",
  balance_kop: 0,
  comment: "",
  color: "slate",
  icon: "card",
  include_in_total: true,
  status: "active",
};

const rule: RecurrenceInfo = {
  rule_id: 7,
  rrule: "FREQ=WEEKLY;BYDAY=MO,TH",
  frequency: "weekly",
  interval: 1,
  weekdays: ["TH", "MO"],
  month_days: [],
  starts_on: "2030-03-04",
  ends_on: "2030-03-31",
};

const noopApi = tauriPaymentApi;
const noopActions = { onToggleStatus() {}, onComplete() {}, onSkip() {}, onRestore() {}, onEdit() {}, onDelete() {} };

describe("даты", () => {
  it("настоящие и ненастоящие дни", () => {
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2030-02-29")).toBe(false);
    expect(isValidDay("2030-13-01")).toBe(false);
    expect(isValidDay("")).toBe(false);
    expect(parseIso("2030-3-1")).toBeNull();
  });

  it("сдвиг по месяцам прижимает день к концу месяца", () => {
    expect(addMonths("2030-01-31", 1)).toBe("2030-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2030-11-15", 3)).toBe("2031-02-15");
    expect(addMonths("2030-01-15", -2)).toBe("2029-11-15");
    expect(monthEnd("2030-04-10")).toBe("2030-04-30");
  });

  it("разность дней и день недели", () => {
    expect(diffDays("2030-03-01", "2030-03-31")).toBe(30);
    expect(diffDays("2030-02-28", "2030-03-01")).toBe(1);
    expect(weekdayCode("2030-03-04")).toBe("MO");
    expect(weekdayCode("2030-03-10")).toBe("SU");
  });

  it("подписи", () => {
    expect(monthTitle("2030-03")).toBe("Март 2030");
    expect(formatDay("2030-03-10", "2030-03-01")).toBe("10 марта, вс");
    expect(formatDay("2031-01-05", "2030-03-01")).toContain("2031");
  });
});

describe("деньги в списке", () => {
  it("знак пишется всегда, факт важнее плана", () => {
    expect(signedAmount(pay({ id: 1, direction: "income", amount_kop: 5_000_000 }))).toBe(`+50${NB}000${NB}₽`);
    expect(signedAmount(pay({ id: 2, amount_kop: 150_000 }))).toBe(`${MINUS}1${NB}500${NB}₽`);
    const done = pay({ id: 3, status: "completed", actual_amount_kop: 120_050 });
    expect(effectiveKop(done)).toBe(120_050);
    expect(signedAmount(done)).toBe(`${MINUS}1${NB}200,50${NB}₽`);
    // факт игнорируется, пока платёж не выполнен
    expect(effectiveKop(pay({ id: 4, actual_amount_kop: 1 }))).toBe(150_000);
  });

  it("итоги месяцев складываются, разница со знаком", () => {
    const t = { count: 3, skipped_count: 1, planned_income_kop: 100, planned_expense_kop: 40, completed_income_kop: 50, completed_expense_kop: 260 };
    expect(monthNet(t)).toEqual({ incomeKop: 150, expenseKop: 300, netKop: -150 });
    expect(sumNet([t, t]).netKop).toBe(-300);
    expect(sumNet([])).toEqual({ incomeKop: 0, expenseKop: 0, netKop: 0 });
    expect(signedKop(-150_000)).toBe(`${MINUS}1${NB}500${NB}₽`);
    expect(signedKop(0)).toBe(`0${NB}₽`);
  });

  it("просрочен только невыполненный платёж в прошлом", () => {
    expect(isOverdue(pay({ id: 1, planned_on: "2030-03-09" }), "2030-03-10")).toBe(true);
    expect(isOverdue(pay({ id: 1, planned_on: "2030-03-10" }), "2030-03-10")).toBe(false);
    expect(isOverdue(pay({ id: 1, planned_on: "2030-03-01", status: "completed" }), "2030-03-10")).toBe(false);
    expect(isOverdue(pay({ id: 1, planned_on: "2030-03-01", status: "skipped" }), "2030-03-10")).toBe(false);
  });

  it("описание правила для чипа", () => {
    expect(describeRule(rule)).toBe("Каждую неделю: пн, чт");
    expect(describeRule({ frequency: "monthly", interval: 1, weekdays: [], month_days: [5, 20] })).toBe("Каждый месяц: 5, 20 числа");
    expect(describeRule({ frequency: "monthly", interval: 2, weekdays: [], month_days: [-1] })).toBe("Каждые 2 месяца: последний день");
    expect(describeRule({ frequency: "daily", interval: 1, weekdays: [], month_days: [] })).toBe("Каждый день");
    expect(describeRule({ frequency: "daily", interval: 5, weekdays: [], month_days: [] })).toBe("Каждые 5 дней");
  });
});

describe("период", () => {
  it("месяц, квартал, год от любой даты", () => {
    expect(periodFor("month", "2030-02-17")).toEqual({ kind: "month", from: "2030-02-01", to: "2030-02-28" });
    expect(periodFor("quarter", "2030-05-17")).toEqual({ kind: "quarter", from: "2030-04-01", to: "2030-06-30" });
    expect(periodFor("year", "2030-05-17")).toEqual({ kind: "year", from: "2030-01-01", to: "2030-12-31" });
  });

  it("листание на длину периода, в том числе через границу года", () => {
    expect(shiftPeriod(periodFor("month", "2030-12-05"), 1)).toEqual({ kind: "month", from: "2031-01-01", to: "2031-01-31" });
    expect(shiftPeriod(periodFor("quarter", "2030-01-05"), -1)).toEqual({ kind: "quarter", from: "2029-10-01", to: "2029-12-31" });
    expect(shiftPeriod(periodFor("year", "2030-06-01"), 1).to).toBe("2031-12-31");
    const week = { kind: "custom" as const, from: "2030-03-04", to: "2030-03-10" };
    expect(shiftPeriod(week, 1)).toEqual({ kind: "custom", from: "2030-03-11", to: "2030-03-17" });
  });

  it("проверка своего периода: не грузим годы разом", () => {
    expect(periodError({ kind: "custom", from: "2030-03-01", to: "2030-03-31" })).toBeNull();
    expect(periodError({ kind: "custom", from: "2030-03-31", to: "2030-03-01" })).toMatch(/раньше/);
    expect(periodError({ kind: "custom", from: "2030-01-01", to: "2035-01-01" })).toMatch(/не длиннее/);
    expect(periodError({ kind: "custom", from: "", to: "2030-03-01" })).toMatch(/целиком/);
    expect(periodTitle(periodFor("month", "2030-03-01"))).toBe("Март 2030");
  });

  it("запрос к Rust: только заданные фильтры", () => {
    const p = periodFor("month", "2030-03-01");
    expect(toBackendFilter(p, noFilters)).toEqual({ from: "2030-03-01", to: "2030-03-31" });
    expect(toBackendFilter(p, { direction: "income", status: "planned", accountId: 3 })).toEqual({
      from: "2030-03-01",
      to: "2030-03-31",
      direction: "income",
      status: "planned",
      account_id: 3,
    });
  });
});

describe("форма платежа", () => {
  const base = (patch: Partial<PaymentForm> = {}): PaymentForm => ({ ...emptyForm("2030-03-10", 1), title: "Аренда", amount: "45 000", ...patch });

  it("пустое, длинное название и кривая сумма не проходят", () => {
    expect(validatePaymentForm(base({ title: " " }))).toHaveProperty("errors.title");
    expect(validatePaymentForm(base({ title: "а".repeat(201) }))).toHaveProperty("errors.title");
    expect(validatePaymentForm(base({ amount: "" }))).toHaveProperty("errors.amount");
    expect(validatePaymentForm(base({ amount: "0" }))).toHaveProperty("errors.amount");
    expect(validatePaymentForm(base({ amount: "-5" }))).toHaveProperty("errors.amount");
    expect(validatePaymentForm(base({ accountId: "" }))).toHaveProperty("errors.account");
    expect(validatePaymentForm(base({ date: "2030-02-30" }))).toHaveProperty("errors.date");
  });

  it("одиночный платёж: рубли в копейки, дата в planned_on", () => {
    const r = validatePaymentForm(base({ amount: "349,9", note: " по счёту " }));
    expect("ok" in r).toBe(true);
    if (!("ok" in r)) return;
    expect(toNewPayment(r.ok)).toEqual({
      title: "Аренда",
      direction: "expense",
      amount_kop: 34_990,
      account_id: 1,
      note: "по счёту",
      planned_on: "2030-03-10",
    });
  });

  it("числа месяца: разбор, порядок, последний день", () => {
    expect(parseMonthDays("20, 5 5", false)).toEqual([5, 20]);
    expect(parseMonthDays("", true)).toEqual([-1]);
    expect(parseMonthDays("5", true)).toEqual([5, -1]);
    expect(parseMonthDays("0", false)).toBeNull();
    expect(parseMonthDays("32", false)).toBeNull();
    expect(parseMonthDays("пятого", false)).toBeNull();
  });

  it("повторение: период от–до обязателен", () => {
    const rec = { enabled: true, frequency: "weekly" as const, interval: "1", weekdays: ["MO"], monthDays: "", lastDay: false, endsOn: "" };
    expect(validatePaymentForm(base({ rec }))).toHaveProperty("errors.endsOn");
    expect(validatePaymentForm(base({ rec: { ...rec, endsOn: "2030-03-01" } }))).toHaveProperty("errors.endsOn");
    expect(validatePaymentForm(base({ rec: { ...rec, endsOn: "2030-03-31", interval: "0" } }))).toHaveProperty("errors.interval");
    expect(validatePaymentForm(base({ rec: { ...rec, endsOn: "2030-03-31", interval: "abc" } }))).toHaveProperty("errors.interval");
    expect(validatePaymentForm(base({ rec: { ...rec, frequency: "monthly", monthDays: "99", endsOn: "2030-12-31" } }))).toHaveProperty("errors.monthDays");
  });

  it("серия: запрос содержит правило и не содержит planned_on; дни недели только у недельной", () => {
    const rec = { enabled: true, frequency: "weekly" as const, interval: "2", weekdays: ["MO", "TH"], monthDays: "5", lastDay: false, endsOn: "2030-06-30" };
    const r = validatePaymentForm(base({ rec }));
    if (!("ok" in r)) throw new Error("форма должна пройти");
    const spec = toNewPayment(r.ok).recurrence as RecurrenceSpec;
    expect(spec).toEqual({ frequency: "weekly", interval: 2, weekdays: ["MO", "TH"], month_days: [], starts_on: "2030-03-10", ends_on: "2030-06-30" });
    expect(toNewPayment(r.ok)).not.toHaveProperty("planned_on");

    const m = validatePaymentForm(base({ rec: { ...rec, frequency: "monthly", monthDays: "31", lastDay: true } }));
    if (!("ok" in m)) throw new Error("форма должна пройти");
    expect(m.ok.recurrence).toMatchObject({ frequency: "monthly", weekdays: [], month_days: [31, -1] });
  });

  it("buildRecurrence без повторения возвращает null", () => {
    expect(buildRecurrence(base(), {})).toBeNull();
  });

  it("форма из платежа серии подхватывает правило", () => {
    const f = formFromPayment(pay({ id: 1, rule_id: 7, amount_kop: 4_500_050, note: "заметка" }), rule);
    expect(f.amount).toBe("45000,50");
    expect(f.rec).toMatchObject({ enabled: true, frequency: "weekly", interval: "1", endsOn: "2030-03-31" });
    expect(formFromPayment(pay({ id: 2 }), null).rec.enabled).toBe(false);
  });

  it("правка: повторение уходит в запрос только если его изменили и выбрано «и все следующие»", () => {
    const original = pay({ id: 5, rule_id: 7, planned_on: "2030-03-11" });
    const f = formFromPayment(original, rule);
    const same = validatePaymentForm(f);
    if (!("ok" in same)) throw new Error("форма должна пройти");
    expect(recurrenceChanged(same.ok.recurrence, rule)).toBe(false);
    expect(toPatch(same.ok, original, rule, "following")).toEqual({ title: "Тестовый платёж", direction: "expense", amount_kop: 150_000, account_id: 1, note: "" });

    const edited = validatePaymentForm({ ...f, date: "2030-03-12", rec: { ...f.rec, endsOn: "2030-04-30" } });
    if (!("ok" in edited)) throw new Error("форма должна пройти");
    expect(recurrenceChanged(edited.ok.recurrence, rule)).toBe(true);
    expect(toPatch(edited.ok, original, rule, "following")).toMatchObject({ planned_on: "2030-03-12", recurrence: { ends_on: "2030-04-30", starts_on: "2030-03-12" } });
    // «только этот»: правило не отправляется никогда
    expect(toPatch(edited.ok, original, rule, "this")).not.toHaveProperty("recurrence");
  });
});

describe("экран: отрисовка", () => {
  const group = (payments: Payment[]): MonthGroup => ({
    month: "2030-03",
    totals: { count: payments.length, skipped_count: 1, planned_income_kop: 5_000_000, planned_expense_kop: 150_000, completed_income_kop: 0, completed_expense_kop: 0 },
    payments,
  });
  const render = (payments: Payment[], expanded = false, selecting = false) =>
    renderToString(
      <MonthCard
        group={group(payments)}
        accounts={new Map([[1, account]])}
        rules={new Map([[7, rule]])}
        today="2030-03-15"
        selecting={selecting}
        picked={new Set([payments[0]?.id])}
        expanded={expanded}
        onExpand={() => {}}
        actions={noopActions}
        onPick={() => {}}
      />,
    );

  it("месяц: заголовок с итогами, знаки, цвета приход/расход, чип серии, просрочка", () => {
    const html = render([
      pay({ id: 1, title: "Зарплата", direction: "income", amount_kop: 5_000_000, planned_on: "2030-03-20" }),
      pay({ id: 2, title: "Аренда", rule_id: 7, planned_on: "2030-03-04" }),
      pay({ id: 3, title: "Подписка", status: "skipped", planned_on: "2030-03-05" }),
    ]);
    expect(html).toContain("Март 2030");
    expect(html).toContain(`+50${NB}000${NB}₽`);
    expect(html).toContain(`${MINUS}1${NB}500${NB}₽`);
    expect(html).toContain("amt in");
    expect(html).toContain("amt out");
    expect(html).toContain("Каждую неделю: пн, чт");
    expect(html).toContain("просрочен");
    expect(html).toContain("prow pay-row skip");
    expect(html).toContain("Пропущено: 1");
    expect(html).toContain("Тестовая карта");
  });

  it("выполненный платёж показывает факт и план", () => {
    const html = render([pay({ id: 1, status: "completed", actual_amount_kop: 120_000 })]);
    expect(html).toContain("prow pay-row done");
    expect(html).toContain(`${MINUS}1${NB}200${NB}₽`);
    expect(html).toContain(`план 1${NB}500${NB}₽`);
  });

  it("режим выбора: круги выбора и выбранная строка", () => {
    const html = render([pay({ id: 1 }), pay({ id: 2 })], false, true);
    expect(html).toContain("cb pick");
    expect(html).toContain("prow pay-row sel");
  });

  it("длинный месяц: рисуем не больше порога и предлагаем показать остальное", () => {
    const many = Array.from({ length: ROWS_PER_MONTH + 30 }, (_, i) => pay({ id: i + 1, title: `Платёж ${i + 1}` }));
    const html = render(many);
    expect(html.match(/pay-row/g)?.length).toBe(ROWS_PER_MONTH);
    expect(html).toContain("Показать ещё 30");
    expect(render(many, true).match(/pay-row/g)?.length).toBe(ROWS_PER_MONTH + 30);
  });

  it("итог периода и пустые состояния", () => {
    const list: PaymentList = { months: [group([pay({ id: 1 })])], rules: [], total_count: 1 };
    const html = renderToString(<SummaryCard list={list} period={periodFor("month", "2030-03-01")} onAdd={() => {}} selecting={false} onToggleSelect={() => {}} />);
    expect(html).toContain(`+50${NB}000${NB}₽`);
    expect(html).toContain(`${MINUS}1${NB}500${NB}₽`);
    expect(html).toContain("Новый платёж");
    expect(renderToString(<EmptyPayments filtered={false} hasAccounts={false} onAdd={() => {}} />)).toContain("заведи счёт");
    expect(renderToString(<EmptyPayments filtered hasAccounts onAdd={() => {}} />)).toContain("Ничего не найдено");
  });
});

describe("диалоги", () => {
  it("форма нового платежа: типы, поля, конструктор выключен", () => {
    const html = renderToString(<PaymentDialog payment={null} rule={null} accounts={[account]} today="2030-03-10" api={noopApi} onSave={async () => {}} onClose={() => {}} />);
    expect(html).toContain("Новый платёж");
    expect(html).toContain("Поступление");
    expect(html).toContain("Списание");
    expect(html).toContain("Тестовая карта");
    expect(html).toContain("Повторяется");
    expect(html).not.toContain("Каждые");
  });

  it("правка платежа из серии показывает конструктор с правилом", () => {
    const html = renderToString(<PaymentDialog payment={pay({ id: 5, rule_id: 7 })} rule={rule} accounts={[account]} today="2030-03-10" api={noopApi} onSave={async () => {}} onClose={() => {}} />);
    expect(html).toContain("Изменить платёж");
    expect(html).toContain("Платёж из серии");
    expect(html).toContain("Каждые");
    expect(html).toContain("2030-03-31");
  });

  it("правка одиночного платежа: повторение добавить нельзя", () => {
    const html = renderToString(<PaymentDialog payment={pay({ id: 5 })} rule={null} accounts={[account]} today="2030-03-10" api={noopApi} onSave={async () => {}} onClose={() => {}} />);
    expect(html).toContain("нельзя добавить к уже созданному");
  });

  it("выбор «только этот / этот и все следующие»", () => {
    const html = renderToString(<ScopeStep title="Изменить" text="т" verb="Сохранить" onPick={() => {}} onBack={() => {}} />);
    expect(html).toContain("Только этот");
    expect(html).toContain("Этот и все следующие");
    const locked = renderToString(<ScopeStep title="Изменить" text="т" verb="Сохранить" thisDisabledReason="причина" onPick={() => {}} onBack={() => {}} />);
    expect(locked).toContain("disabled");
    expect(locked).toContain("причина");
  });

  it("удаление: серия спрашивает область, одиночный платёж подтверждение", () => {
    const series = renderToString(<DeleteDialog payments={[pay({ id: 1, rule_id: 7 })]} onConfirm={async () => {}} onClose={() => {}} />);
    expect(series).toContain("Только этот");
    expect(series).toContain("btn danger");
    const single = renderToString(<DeleteDialog payments={[pay({ id: 1 })]} onConfirm={async () => {}} onClose={() => {}} />);
    expect(single).toContain("Удалить платёж?");
    expect(single).not.toContain("Только этот");
    expect(renderToString(<DeleteDialog payments={[pay({ id: 1 }), pay({ id: 2 })]} onConfirm={async () => {}} onClose={() => {}} />)).toContain("2 платежа");
  });

  it("отметка выполненным: плановая сумма подставлена", () => {
    const html = renderToString(<CompleteDialog payment={pay({ id: 1, amount_kop: 123_456 })} onConfirm={async () => {}} onClose={() => {}} />);
    expect(html).toContain("Отметить выполненным");
    expect(html).toContain("1234,56");
  });

  it("подсказка серии", () => {
    expect(previewText({ count: 5, first: "2030-03-04", last: "2030-03-31", dates: [] })).toBe("Будет 5 платежей: с 4 марта, пн по 31 марта, вс");
    expect(previewText({ count: 1, first: "2030-03-04", last: "2030-03-04", dates: [] })).toBe("Будет 1 платёж: 4 марта, пн");
    expect(previewText({ count: 0, first: null, last: null, dates: [] })).toMatch(/нет подходящих/);
  });
});
