import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Account } from "../accounts/api";
import type { Payment } from "../payments/api";
import { BudgetChart } from "./BudgetChart";
import { BudgetNumbers, BudgetPeriodBar } from "./BudgetScreen";
import { addDays, compactKop, computeBudget, granularityFor, loadRange, niceTicks, periodAround, periodError, periodFor, periodTitle, shiftPeriod, smoothPath, weekStart } from "./model";

const NB = " ";

function acc(p: Partial<Account> & { id: number }): Account {
  return {
    name: "Тестовая карта",
    kind: "debit_card",
    currency: "RUB",
    opening_balance_kop: 0,
    balance_on: "2030-03-01",
    balance_kop: 0,
    comment: "",
    color: "slate",
    icon: "card",
    include_in_total: true,
    status: "active",
    ...p,
  };
}

function pay(p: Partial<Payment> & { id: number }): Payment {
  return { account_id: 1, rule_id: null, direction: "expense", title: "Платёж", note: null, amount_kop: 100_00, actual_amount_kop: null, planned_on: "2030-03-10", status: "planned", ...p };
}

describe("периоды", () => {
  it("неделя начинается с понедельника", () => {
    expect(weekStart("2030-03-13")).toBe("2030-03-11"); // среда
    expect(weekStart("2030-03-17")).toBe("2030-03-11"); // воскресенье
    expect(weekStart("2030-03-11")).toBe("2030-03-11");
    expect(periodFor("week", "2030-03-13")).toEqual({ kind: "week", from: "2030-03-11", to: "2030-03-17" });
  });

  it("месяц, квартал, год", () => {
    expect(periodFor("month", "2030-02-10")).toEqual({ kind: "month", from: "2030-02-01", to: "2030-02-28" });
    expect(periodFor("quarter", "2030-05-10")).toEqual({ kind: "quarter", from: "2030-04-01", to: "2030-06-30" });
    expect(periodFor("year", "2030-05-10")).toEqual({ kind: "year", from: "2030-01-01", to: "2030-12-31" });
  });

  it("стрелки сдвигают на длину периода", () => {
    expect(shiftPeriod(periodFor("week", "2030-03-13"), 1).from).toBe("2030-03-18");
    expect(shiftPeriod(periodFor("month", "2030-01-10"), 1).to).toBe("2030-02-28");
    expect(shiftPeriod(periodFor("quarter", "2030-01-10"), -1).from).toBe("2029-10-01");
    expect(shiftPeriod(periodFor("year", "2030-01-10"), 1).from).toBe("2031-01-01");
    expect(shiftPeriod({ kind: "custom", from: "2030-03-01", to: "2030-03-10" }, 1)).toEqual({ kind: "custom", from: "2030-03-11", to: "2030-03-20" });
    expect(shiftPeriod({ kind: "custom", from: "2030-03-11", to: "2030-03-20" }, -1)).toEqual({ kind: "custom", from: "2030-03-01", to: "2030-03-10" });
  });

  it("«Сегодня» возвращает период с сегодняшним днём", () => {
    const far = periodFor("month", "2031-07-01");
    expect(periodAround(far, "2030-03-13")).toEqual(periodFor("month", "2030-03-13"));
    expect(periodAround({ kind: "custom", from: "2031-01-01", to: "2031-01-10" }, "2030-03-13")).toEqual({ kind: "custom", from: "2030-03-13", to: "2030-03-22" });
  });

  it("заголовки и ошибки", () => {
    expect(periodTitle(periodFor("week", "2030-03-13"))).toBe("11–17 марта 2030");
    expect(periodTitle(periodFor("quarter", "2030-05-10"))).toBe("2 квартал 2030");
    expect(periodTitle(periodFor("year", "2030-05-10"))).toBe("2030");
    expect(periodError({ kind: "custom", from: "2030-03-10", to: "2030-03-01" })).toMatch(/раньше/);
    expect(periodError({ kind: "custom", from: "2030-03-10", to: "" })).toMatch(/обе даты/);
    expect(periodError({ kind: "custom", from: "2030-01-01", to: "2036-01-01" })).toMatch(/пяти лет/);
    expect(periodError({ kind: "custom", from: "2030-03-01", to: "2030-03-01" })).toBeNull();
  });

  it("детализация столбиков зависит от периода", () => {
    expect(granularityFor(periodFor("week", "2030-03-13"))).toBe("day");
    expect(granularityFor(periodFor("month", "2030-03-13"))).toBe("day");
    expect(granularityFor(periodFor("quarter", "2030-03-13"))).toBe("week");
    expect(granularityFor(periodFor("year", "2030-03-13"))).toBe("month");
    expect(granularityFor({ kind: "custom", from: "2030-03-01", to: "2030-03-20" })).toBe("day");
    expect(granularityFor({ kind: "custom", from: "2030-01-01", to: "2030-04-30" })).toBe("week");
    expect(granularityFor({ kind: "custom", from: "2030-01-01", to: "2031-06-30" })).toBe("month");
  });

  it("addDays переходит через границы месяцев и годов", () => {
    expect(addDays("2030-12-31", 1)).toBe("2031-01-01");
    expect(addDays("2030-03-01", -1)).toBe("2030-02-28");
  });
});

describe("расчёт баланса", () => {
  const month = periodFor("month", "2030-03-15");

  it("остаток на дату остатка, платежи после него добавляются по дням", () => {
    const accounts = [acc({ id: 1, opening_balance_kop: 1000_00, balance_on: "2030-03-01" })];
    const payments = [
      pay({ id: 1, direction: "income", amount_kop: 500_00, planned_on: "2030-03-05" }),
      pay({ id: 2, direction: "expense", amount_kop: 200_00, planned_on: "2030-03-10" }),
    ];
    const d = computeBudget(accounts, payments, month);
    expect(d.days).toHaveLength(31);
    expect(d.startKop).toBe(1000_00);
    expect(d.days[3].balanceKop).toBe(1000_00); // 4 марта
    expect(d.days[4].balanceKop).toBe(1500_00); // 5 марта
    expect(d.endKop).toBe(1300_00);
    expect(d.incomeKop).toBe(500_00);
    expect(d.expenseKop).toBe(200_00);
    expect(d.minKop).toBe(1000_00);
    expect(d.minOn).toBe("2030-03-01");
  });

  it("выполненный платёж по факту, пропущенный не считается", () => {
    const accounts = [acc({ id: 1, opening_balance_kop: 0, balance_on: "2030-03-01" })];
    const payments = [
      pay({ id: 1, direction: "expense", amount_kop: 100_00, actual_amount_kop: 130_00, status: "completed", planned_on: "2030-03-05" }),
      pay({ id: 2, direction: "expense", amount_kop: 999_00, status: "skipped", planned_on: "2030-03-06" }),
    ];
    const d = computeBudget(accounts, payments, month);
    expect(d.expenseKop).toBe(130_00);
    expect(d.endKop).toBe(-130_00);
    expect(d.minKop).toBe(-130_00);
  });

  it("баланс на начало учитывает платежи между датой остатка и началом периода", () => {
    const accounts = [acc({ id: 1, opening_balance_kop: 1000_00, balance_on: "2030-01-15" })];
    const payments = [
      pay({ id: 1, direction: "income", amount_kop: 300_00, planned_on: "2030-02-10" }),
      pay({ id: 2, direction: "expense", amount_kop: 50_00, planned_on: "2030-01-15" }), // уже внутри остатка
      pay({ id: 3, direction: "expense", amount_kop: 100_00, planned_on: "2030-03-02" }),
    ];
    const d = computeBudget(accounts, payments, month);
    expect(d.startKop).toBe(1300_00);
    expect(d.endKop).toBe(1200_00);
  });

  it("период раньше даты остатка: платежи вычитаются назад", () => {
    const accounts = [acc({ id: 1, opening_balance_kop: 1000_00, balance_on: "2030-03-20" })];
    const payments = [pay({ id: 1, direction: "income", amount_kop: 400_00, planned_on: "2030-03-10" })];
    const d = computeBudget(accounts, payments, month);
    expect(d.startKop).toBe(600_00);
    expect(d.days[8].balanceKop).toBe(600_00); // 9 марта
    expect(d.days[9].balanceKop).toBe(1000_00); // 10 марта
    expect(d.days[19].balanceKop).toBe(1000_00); // 20 марта = остаток
    expect(d.endKop).toBe(1000_00);
  });

  it("считаются только активные счета с флажком «в итоге»; кредитка идёт с минусом", () => {
    const accounts = [
      acc({ id: 1, opening_balance_kop: 1000_00 }),
      acc({ id: 2, kind: "credit_card", opening_balance_kop: -300_00 }),
      acc({ id: 3, opening_balance_kop: 5000_00, include_in_total: false }),
      acc({ id: 4, opening_balance_kop: 7000_00, status: "archived" }),
    ];
    const payments = [pay({ id: 1, account_id: 3, direction: "income", amount_kop: 999_00 }), pay({ id: 2, account_id: 2, direction: "expense", amount_kop: 50_00 })];
    const d = computeBudget(accounts, payments, month);
    expect(d.accountCount).toBe(2);
    expect(d.startKop).toBe(700_00);
    expect(d.incomeKop).toBe(0);
    expect(d.expenseKop).toBe(50_00);
    expect(d.endKop).toBe(650_00);
  });

  it("без счетов в итоге баланс нулевой", () => {
    const d = computeBudget([acc({ id: 1, include_in_total: false })], [], month);
    expect(d.accountCount).toBe(0);
    expect(d.endKop).toBe(0);
  });

  it("диапазон загрузки охватывает даты остатков", () => {
    const accounts = [acc({ id: 1, balance_on: "2029-12-20" }), acc({ id: 2, balance_on: "2030-05-01" }), acc({ id: 3, balance_on: "2020-01-01", include_in_total: false })];
    expect(loadRange(accounts, month)).toEqual({ from: "2029-12-20", to: "2030-05-01" });
  });

  it("столбики: по неделям в квартале, по месяцам в году; суммы сходятся", () => {
    const accounts = [acc({ id: 1, balance_on: "2029-12-31" })];
    const payments = [
      pay({ id: 1, direction: "income", amount_kop: 100_00, planned_on: "2030-01-02" }),
      pay({ id: 2, direction: "expense", amount_kop: 40_00, planned_on: "2030-02-14" }),
      pay({ id: 3, direction: "income", amount_kop: 10_00, planned_on: "2030-02-15" }),
    ];
    const year = computeBudget(accounts, payments, periodFor("year", "2030-06-01"));
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets[0].label).toBe("янв");
    expect(year.buckets[1].incomeKop).toBe(10_00);
    expect(year.buckets[1].expenseKop).toBe(40_00);
    expect(year.buckets.reduce((s, b) => s + b.incomeKop, 0)).toBe(year.incomeKop);
    expect(year.buckets[11].balanceKop).toBe(year.endKop);

    const q = computeBudget(accounts, payments, periodFor("quarter", "2030-01-10"));
    expect(q.granularity).toBe("week");
    expect(q.buckets[0].from).toBe("2030-01-01");
    expect(q.buckets.reduce((s, b) => s + b.expenseKop, 0)).toBe(40_00);
    // первая неделя начинается в понедельник 31 декабря, но обрезана началом периода
    expect(q.buckets.every((b) => b.start <= b.end)).toBe(true);
  });
});

describe("шкала и линия", () => {
  it("круглые деления охватывают данные", () => {
    const t = niceTicks(-130_00, 970_00, 4);
    expect(t[0]).toBeLessThanOrEqual(-130_00);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(970_00);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(niceTicks(500, 500).length).toBe(3);
  });

  it("подписи оси короткие", () => {
    expect(compactKop(0)).toBe("0");
    expect(compactKop(800_00)).toBe("800");
    expect(compactKop(350_000_00)).toBe("350 тыс.");
    expect(compactKop(1_200_000_00)).toBe("1,2 млн");
    expect(compactKop(-15_000_00)).toBe("−15 тыс.");
  });

  it("гладкая линия не уходит за пределы данных", () => {
    const pts: Array<[number, number]> = [[0, 100], [10, 100], [20, 0], [30, 0], [40, 50]];
    const d = smoothPath(pts);
    const ys = [...d.matchAll(/C([\d. -]+)/g)].flatMap((m) => m[1].split(" ").filter((_, i) => i % 2 === 1).map(Number));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(smoothPath([])).toBe("");
    expect(smoothPath([[1, 2]])).toBe("M1 2");
  });
});

describe("отображение", () => {
  const accounts = [acc({ id: 1, opening_balance_kop: 1000_00, balance_on: "2030-03-01" })];
  const payments = [pay({ id: 1, direction: "income", amount_kop: 500_00, planned_on: "2030-03-05" }), pay({ id: 2, direction: "expense", amount_kop: 1700_00, planned_on: "2030-03-10" })];
  const data = computeBudget(accounts, payments, periodFor("month", "2030-03-15"));

  it("цифры: начало, конец, приходы, расходы, минимум", () => {
    const html = renderToString(<BudgetNumbers data={data} />);
    expect(html).toContain("Баланс на начало");
    expect(html).toContain("Баланс на конец");
    expect(html).toContain("Приходы");
    expect(html).toContain("Расходы");
    expect(html).toContain("Минимальный баланс");
    expect(html).toContain(`1${NB}000${NB}₽`);
    expect(html).toContain(`−200${NB}₽`); // конец: 1000 + 500 − 1700
    expect(html).toContain("10 марта");
  });

  it("график рисует линию, столбики приходов и расходов, подписи и цвета из токенов", () => {
    const html = renderToString(<BudgetChart data={data} />);
    expect(html).toContain('class="ch-actual"');
    expect(html).toContain("ch-bar in");
    expect(html).toContain("ch-bar out");
    expect(html).toContain("ch-below"); // баланс уходит в минус
    expect(html).toContain("aria-label=\"График бюджета");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/); // цвета только токенами MyDS
  });

  it("панель периода: сегмент, стрелки и «Сегодня»", () => {
    const html = renderToString(<BudgetPeriodBar period={periodFor("week", "2030-03-13")} today="2030-03-13" onChange={() => {}} />);
    for (const t of ["Неделя", "Месяц", "Квартал", "Год", "Свой", "Сегодня", 'aria-label="Назад"', 'aria-label="Вперёд"']) expect(html).toContain(t);
    expect(html).not.toContain("С даты");
    const custom = renderToString(<BudgetPeriodBar period={{ kind: "custom", from: "2030-03-01", to: "2030-03-10" }} today="2030-03-13" onChange={() => {}} />);
    expect(custom).toContain("С даты");
  });
});
