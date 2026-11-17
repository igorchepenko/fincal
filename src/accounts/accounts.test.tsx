import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountDialog } from "./AccountDialog";
import { AccountsView } from "./AccountsScreen";
import type { Account } from "./api";
import { emptyForm, formFromAccount, localDay, validateForm } from "./form";
import { formatKop, kopToInput, parseRubles } from "./money";
import { colors, icons, kinds } from "./options";
import { summarize } from "./summary";

const NB = " ";
const MINUS = "−";

function acc(p: Partial<Account> & { id: number; name: string }): Account {
  return {
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
    ...p,
  };
}

const view = (accounts: Account[], showArchive = false) =>
  renderToString(
    <AccountsView accounts={accounts} showArchive={showArchive} onToggleArchive={() => {}} onAdd={() => {}} onEdit={() => {}} onToggleTotal={() => {}} onArchive={() => {}} />,
  );

describe("деньги", () => {
  it("форматирует рубли, копейки и настоящий минус", () => {
    expect(formatKop(0)).toBe(`0${NB}₽`);
    expect(formatKop(2_500_000)).toBe(`25${NB}000${NB}₽`);
    expect(formatKop(-2_500_000)).toBe(`${MINUS}25${NB}000${NB}₽`);
    expect(formatKop(1_234_567)).toBe(`12${NB}345,67${NB}₽`);
    expect(formatKop(-5)).toBe(`${MINUS}0,05${NB}₽`);
  });

  it("разбирает ввод человека в копейки без дробных чисел", () => {
    expect(parseRubles("25000")).toBe(2_500_000);
    expect(parseRubles(" 25 000,5 ")).toBe(2_500_050);
    expect(parseRubles("1200.30")).toBe(120_030);
    expect(parseRubles("-300")).toBe(-30_000);
    expect(parseRubles(`${MINUS}0,07`)).toBe(-7);
    expect(parseRubles("0,1")).toBe(10);
    expect(parseRubles("19,99")).toBe(1_999);
  });

  it("отклоняет не-суммы", () => {
    for (const bad of ["", "abc", "12,345", "1,2,3", "--5", "5₽", "1e5", "1".repeat(13)]) {
      expect(parseRubles(bad), bad).toBeNull();
    }
  });

  it("сумма для поля ввода обратна разбору", () => {
    for (const kop of [0, 5, 100, 2_500_050, -1_999, -2_500_000]) {
      expect(parseRubles(kopToInput(kop))).toBe(kop);
    }
  });
});

describe("общий итог", () => {
  const list = [
    acc({ id: 1, name: "Зарплатная", balance_kop: 10_000_000 }),
    acc({ id: 2, name: "Кредитка", kind: "credit_card", balance_kop: -2_500_000 }),
    acc({ id: 3, name: "Кубышка", kind: "cash", balance_kop: 700_000, include_in_total: false }),
    acc({ id: 4, name: "Старая", balance_kop: 999_999, status: "archived" }),
  ];

  it("кредитка вычитается, снятый флажок и архив не считаются", () => {
    expect(summarize(list)).toEqual({ totalKop: 7_500_000, counted: 2, excluded: 1, active: 3, archived: 1 });
  });

  it("пустой список даёт ноль", () => {
    expect(summarize([]).totalKop).toBe(0);
  });
});

describe("форма счёта", () => {
  const ok = (f = emptyForm()) => validateForm(f, "2030-05-06");

  it("пустое и длинное название не проходят", () => {
    expect(ok({ ...emptyForm(), name: "  " })).toHaveProperty("errors.name");
    expect(ok({ ...emptyForm(), name: "а".repeat(61) })).toHaveProperty("errors.name");
  });

  it("кривая сумма не проходит", () => {
    expect(ok({ ...emptyForm(), name: "Карта", balance: "много" })).toHaveProperty("errors.balance");
  });

  it("обычный счёт: сумма как есть, дата баланса сегодняшняя", () => {
    const r = ok({ ...emptyForm(), name: " Карта ", balance: "1 500,25", comment: " основная " });
    expect(r).toEqual({
      input: {
        name: "Карта",
        kind: "debit_card",
        comment: "основная",
        color: "slate",
        icon: "card",
        include_in_total: true,
        balance_kop: 150_025,
        balance_on: "2030-05-06",
      },
    });
  });

  it("кредитка: введённый долг уходит в базу со знаком минус, при любом вводе", () => {
    const f = { ...emptyForm(), name: "Кредитка", kind: "credit_card" as const };
    expect(ok({ ...f, balance: "25000" })).toHaveProperty("input.balance_kop", -2_500_000);
    expect(ok({ ...f, balance: "-25000" })).toHaveProperty("input.balance_kop", -2_500_000);
  });

  it("правка кредитки показывает долг без минуса", () => {
    const f = formFromAccount(acc({ id: 1, name: "К", kind: "credit_card", balance_kop: -2_500_000 }));
    expect(f.balance).toBe("25000");
  });

  it("локальная дата в формате ГГГГ-ММ-ДД", () => {
    expect(localDay(new Date(2030, 0, 5))).toBe("2030-01-05");
  });
});

describe("справочники совпадают с Rust", () => {
  it("четыре типа, семь цветов, восемь иконок", () => {
    expect(kinds.map((k) => k.id)).toEqual(["debit_card", "credit_card", "cash", "deposit"]);
    expect(colors.map((c) => c.id)).toEqual(["teal", "berry", "clay", "slate", "cocoa", "sage", "graphite"]);
    expect(icons.map((i) => i.id)).toEqual(["card", "wallet", "cash", "bank", "deposit", "coins", "home", "briefcase"]);
  });
});

describe("экран счетов", () => {
  it("пустое состояние с кнопкой добавления", () => {
    const html = view([]);
    expect(html).toContain("Счетов пока нет");
    expect(html).toContain("Добавить счёт");
  });

  it("итог сверху, кредитка красная со знаком минус, архив скрыт", () => {
    const html = view([
      acc({ id: 1, name: "Зарплатная", balance_kop: 10_000_000, comment: "основная" }),
      acc({ id: 2, name: "Кредитка", kind: "credit_card", balance_kop: -2_500_000 }),
      acc({ id: 3, name: "Старая", balance_kop: 100, status: "archived" }),
    ]);
    expect(html).toContain(`75${NB}000${NB}₽`);
    expect(html).toContain("Учтено 2 счёта");
    expect(html).toContain("Зарплатная");
    expect(html).toContain("Дебетовая карта · основная");
    expect(html).toContain(`${MINUS}25${NB}000${NB}₽`);
    expect(html).toContain("amt out");
    expect(html).toContain("долг");
    expect(html).toContain("Архив (1)");
    expect(html).not.toContain("Старая");
  });

  it("архив раскрывается и предлагает вернуть счёт", () => {
    const html = view([acc({ id: 1, name: "Живая" }), acc({ id: 3, name: "Старая", status: "archived" })], true);
    expect(html).toContain("Старая");
    expect(html).toContain("Вернуть");
  });

  it("счёт вне итога помечен и показан в заметке", () => {
    const html = view([acc({ id: 1, name: "А", balance_kop: 100 }), acc({ id: 2, name: "Б", balance_kop: 100, include_in_total: false })]);
    expect(html).toContain("ещё 1 вне итога");
  });

  it("диалог нового счёта: четыре типа и поля, у кредитки поле долга", () => {
    const html = renderToString(<AccountDialog account={null} onSave={async () => {}} onClose={() => {}} />);
    for (const t of ["Дебетовая карта", "Кредитная карта", "Наличные", "Вклад"]) expect(html).toContain(t);
    expect(html).toContain("Учитывать в общем итоге");
    expect(html).toContain("Новый счёт");
    const credit = renderToString(
      <AccountDialog account={acc({ id: 1, name: "К", kind: "credit_card", balance_kop: -100 })} onSave={async () => {}} onClose={() => {}} />,
    );
    expect(credit).toContain("Задолженность");
    expect(credit).toContain("Изменить счёт");
  });
});
