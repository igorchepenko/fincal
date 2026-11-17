import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Account } from "../accounts/api";
import type { EventItem, Payment, RecurrenceInfo } from "../payments/api";
import { EmptyEvents, EventCard, EventFilterBar, focusOf } from "./EventsScreen";
import { activeFilterCount, filterEvents, isActive, noEventFilters, progressText } from "./model";

const NB = "\u00a0";

function payment(p: Partial<Payment> & { id: number }): Payment {
  return {
    account_id: 1,
    rule_id: null,
    direction: "expense",
    title: "Событие",
    note: null,
    amount_kop: 150_000,
    actual_amount_kop: null,
    planned_on: "2030-03-10",
    status: "planned",
    ...p,
  };
}

const rule: RecurrenceInfo = { rule_id: 7, rrule: "FREQ=WEEKLY;BYDAY=MO", frequency: "weekly", interval: 1, weekdays: ["MO"], month_days: [], starts_on: "2030-03-04", ends_on: "2030-03-25" };

function ev(e: Partial<EventItem> & { key: string; representative: Payment }): EventItem {
  return { rule: null, total: 1, planned: 1, completed: 0, skipped: 0, first_on: e.representative.planned_on, last_on: e.representative.planned_on, next_on: e.representative.planned_on, ...e };
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

const rent = ev({
  key: "r7",
  rule,
  representative: payment({ id: 10, rule_id: 7, title: "Аренда", planned_on: "2030-03-11" }),
  total: 4,
  planned: 2,
  completed: 1,
  skipped: 1,
  first_on: "2030-03-04",
  last_on: "2030-03-25",
  next_on: "2030-03-11",
});
const salary = ev({ key: "t11", representative: payment({ id: 11, title: "Зарплата", direction: "income", amount_kop: 5_000_000, note: "аванс", account_id: 2 }) });
const old = ev({ key: "t12", representative: payment({ id: 12, title: "Старый долг", status: "completed", planned_on: "2029-01-01" }), planned: 0, completed: 1, next_on: null });
const events = [rent, salary, old];

describe("события: фильтры", () => {
  it("по умолчанию показываются активные", () => {
    expect(filterEvents(events, noEventFilters).map((e) => e.key)).toEqual(["r7", "t11"]);
    expect(isActive(old)).toBe(false);
    expect(filterEvents(events, { ...noEventFilters, state: "finished" }).map((e) => e.key)).toEqual(["t12"]);
    expect(filterEvents(events, { ...noEventFilters, state: "all" })).toHaveLength(3);
  });

  it("тип, счёт и поиск по названию и комментарию", () => {
    const all = { ...noEventFilters, state: "all" as const };
    expect(filterEvents(events, { ...all, direction: "income" }).map((e) => e.key)).toEqual(["t11"]);
    expect(filterEvents(events, { ...all, accountId: 2 }).map((e) => e.key)).toEqual(["t11"]);
    expect(filterEvents(events, { ...all, query: "АРЕНД" }).map((e) => e.key)).toEqual(["r7"]);
    expect(filterEvents(events, { ...all, query: "аванс" }).map((e) => e.key)).toEqual(["t11"]);
    expect(filterEvents(events, { ...all, query: "нет такого" })).toEqual([]);
  });

  it("число включённых фильтров не считает поиск и состояние по умолчанию", () => {
    expect(activeFilterCount(noEventFilters)).toBe(0);
    expect(activeFilterCount({ ...noEventFilters, query: "x" })).toBe(0);
    expect(activeFilterCount({ query: "", direction: "income", state: "all", accountId: 3 })).toBe(3);
  });

  it("прогресс словами", () => {
    expect(progressText(rent)).toBe("Выполнено 1 из 4, пропущено 1");
    expect(progressText(salary)).toBe("Запланирован");
    expect(progressText(old)).toBe("Выполнен");
  });
});

describe("события: карточки", () => {
  const card = (e: EventItem) => renderToString(<EventCard event={e} account={account} today="2030-03-09" onEdit={() => {}} onDelete={() => {}} onPayments={() => {}} />);

  it("серия: правило, прогресс, ближайший платёж, переход к платежам", () => {
    const html = card(rent);
    expect(html).toContain("Аренда");
    expect(html).toContain("Каждую неделю: пн");
    expect(html).toContain("Выполнено 1 из 4, пропущено 1");
    expect(html).toContain("Ближайший платёж: 11 марта");
    expect(html).toContain("Платежи события (4)");
    expect(html).toContain("Тестовая карта");
    expect(html).toContain(`−1${NB}500${NB}₽`);
  });

  it("разовое: чип «Разовое», поступление зелёным со знаком плюс, комментарий", () => {
    const html = card(salary);
    expect(html).toContain("Разовое");
    expect(html).toContain("amt in");
    expect(html).toContain(`+50${NB}000${NB}₽`);
    expect(html).toContain("аванс");
  });

  it("завершённое событие приглушено и пишет, когда закончилось", () => {
    const html = card(old);
    expect(html).toContain("ev-done");
    expect(html).toContain("Дата:");
  });

  it("фильтр платежей события: серия по правилу, разовое по id платежа", () => {
    expect(focusOf(rent)).toMatchObject({ key: "r7", ruleId: 7, paymentId: null, from: "2030-03-04", to: "2030-03-25", anchor: "2030-03-11" });
    expect(focusOf(salary)).toMatchObject({ key: "t11", ruleId: null, paymentId: 11 });
  });
});

describe("события: шапка и пустое состояние", () => {
  it("шапка: поиск, тип, состояние, счёт, новое событие", () => {
    const html = renderToString(<EventFilterBar filters={noEventFilters} accounts={[account]} onChange={() => {}} onAdd={() => {}} canAdd />);
    for (const w of ["Поиск по событиям", "Поступления", "Списания", "Активные", "Завершённые", "Тестовая карта", "Новое событие"]) expect(html).toContain(w);
    expect(html).not.toContain("Сбросить фильтры");
    expect(renderToString(<EventFilterBar filters={{ ...noEventFilters, direction: "income" }} accounts={[]} onChange={() => {}} onAdd={() => {}} canAdd />)).toContain("Сбросить фильтры (1)");
    expect(renderToString(<EventFilterBar filters={noEventFilters} accounts={[]} onChange={() => {}} onAdd={() => {}} canAdd={false} />)).toContain("disabled");
  });

  it("пустое состояние: нет счетов, нет событий, ничего не найдено", () => {
    expect(renderToString(<EmptyEvents filtered={false} hasAccounts={false} onAdd={() => {}} />)).toContain("заведи счёт");
    expect(renderToString(<EmptyEvents filtered={false} hasAccounts onAdd={() => {}} />)).toContain("Новое событие");
    const found = renderToString(<EmptyEvents filtered hasAccounts onAdd={() => {}} />);
    expect(found).toContain("Ничего не найдено");
    expect(found).not.toContain("Новое событие");
  });
});
