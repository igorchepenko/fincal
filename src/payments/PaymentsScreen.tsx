import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriAccountApi, type Account, type AccountApi } from "../accounts/api";
import { formatKop } from "../accounts/money";
import { Icon } from "../shell/Icon";
import type { Direction, MonthGroup, Payment, PaymentApi, PaymentFilter, PaymentList, PaymentStatus, RecurrenceInfo, Scope } from "./api";
import { tauriPaymentApi } from "./api";
import { addMonths, diffDays, formatDay, isValidDay, monthEnd, monthStart, monthTitle, today as todayIso } from "./dates";
import { toPatch, type Checked } from "./form";
import { describeRule, groupMonths, isOverdue, monthNet, paymentsWord, signedKop, statusTitle, sumNet, totalsOf } from "./model";
import { CompleteDialog, DeleteDialog, PaymentDialog, PaymentEditDialog } from "./PaymentDialog";
import { defaultSort, matchesQuery, parseSort, SORT_TITLES, sortHint, sortPayments, type SortKey, type SortState } from "./sort";
import { tauriSettingsApi, type SettingsApi } from "../settings/api";
import type { EventFocus } from "../events/EventsScreen";

export type PeriodKind = "month" | "quarter" | "year" | "custom";

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
}

/** Самый длинный период, который грузится за раз: дальше листаем по частям, а не тянем все годы серии. */
export const MAX_PERIOD_DAYS = 400;
/** Больше строк в одном месяце сразу не рисуем: остальное по кнопке. */
export const ROWS_PER_MONTH = 100;

const SPAN: Record<Exclude<PeriodKind, "custom">, number> = { month: 1, quarter: 3, year: 12 };
const KIND_TITLE: Record<PeriodKind, string> = { month: "Месяц", quarter: "Квартал", year: "Год", custom: "Период" };

/** Период по умолчанию: текущий месяц. */
export function periodFor(kind: Exclude<PeriodKind, "custom">, anchor: string): Period {
  const start = kind === "quarter" ? addMonths(monthStart(anchor), -((Number(anchor.slice(5, 7)) - 1) % 3)) : kind === "year" ? `${anchor.slice(0, 4)}-01-01` : monthStart(anchor);
  return { kind, from: start, to: monthEnd(addMonths(start, SPAN[kind] - 1)) };
}

/** Шаг вперёд или назад на длину периода. */
export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  if (p.kind === "custom") {
    const len = diffDays(p.from, p.to) + 1;
    const step = (d: string, n: number) => {
      const t = new Date(`${d}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    return { kind: "custom", from: step(p.from, dir * len), to: step(p.to, dir * len) };
  }
  return periodFor(p.kind, addMonths(p.from, dir * SPAN[p.kind]));
}

export function periodTitle(p: Period): string {
  if (p.kind === "month") return monthTitle(p.from);
  if (p.kind === "year") return p.from.slice(0, 4);
  if (p.kind === "quarter") return `${monthTitle(p.from).split(" ")[0]} — ${monthTitle(p.to).toLowerCase()}`;
  return `${formatDay(p.from, p.to)} — ${formatDay(p.to, p.from)}`;
}

export function periodError(p: Period): string | null {
  if (!isValidDay(p.from) || !isValidDay(p.to)) return "Введи обе даты целиком";
  const days = diffDays(p.from, p.to) + 1;
  if (days < 1) return "Конец периода раньше начала";
  if (days > MAX_PERIOD_DAYS) return `Период не длиннее ${MAX_PERIOD_DAYS} дней: серии на годы листай по месяцам`;
  return null;
}

export interface Filters {
  direction: Direction | "all";
  status: PaymentStatus | "all";
  accountId: number | "all";
}

export const noFilters: Filters = { direction: "all", status: "all", accountId: "all" };

export function toBackendFilter(p: Period, f: Filters, focus?: EventFocus | null): PaymentFilter {
  return {
    from: p.from,
    to: p.to,
    ...(focus?.ruleId != null ? { rule_id: focus.ruleId } : {}),
    ...(focus?.paymentId != null ? { payment_id: focus.paymentId } : {}),
    ...(f.direction !== "all" ? { direction: f.direction } : {}),
    ...(f.status !== "all" ? { status: f.status } : {}),
    ...(f.accountId !== "all" ? { account_id: f.accountId } : {}),
  };
}

function Money({ kop, dir }: { kop: number; dir: Direction }) {
  return <span className={"amt " + (dir === "income" ? "in" : "out")}>{(dir === "income" ? "+" : "−") + formatKop(Math.abs(kop))}</span>;
}

/** Круг статуса: пустой = запланирован, зелёный = выполнен, зачёркнутый = пропущен. */
function StatusDot({
  payment,
  selecting,
  picked,
  onClick,
}: {
  payment: Payment;
  selecting: boolean;
  picked: boolean;
  onClick: () => void;
}) {
  const cls = selecting ? (picked ? "cb pick" : "cb") : payment.status === "completed" ? "cb on" : payment.status === "skipped" ? "cb skip" : "cb";
  return (
    <button
      type="button"
      className={cls + " pay-cb"}
      aria-label={selecting ? `Выбрать «${payment.title}»` : `${statusTitle(payment.status)}: «${payment.title}»`}
      aria-pressed={selecting ? picked : undefined}
      title={selecting ? undefined : payment.status === "planned" ? "Отметить выполненным" : "Вернуть в запланированные"}
      onClick={onClick}
    >
      <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}

export interface RowActions {
  onToggleStatus: (p: Payment) => void;
  onComplete: (p: Payment) => void;
  onSkip: (p: Payment) => void;
  onRestore: (p: Payment) => void;
  onEdit: (p: Payment) => void;
  onEditEvent: (p: Payment) => void;
  onDelete: (p: Payment) => void;
}

function RowMenu({ payment, actions }: { payment: Payment; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const go = (fn: (p: Payment) => void) => () => {
    setOpen(false);
    fn(payment);
  };
  const s = payment.status;
  return (
    <div className="pay-menu" ref={ref}>
      <button type="button" className="btn ghost icon sm" aria-label={`Действия: «${payment.title}»`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 12h.01M12 12h.01M18 12h.01" />
        </svg>
      </button>
      {open && (
        <div className="menu pay-menu-pop" role="menu">
          {s !== "completed" && (
            <button type="button" role="menuitem" className="mi" onClick={go(actions.onComplete)}>
              <span className="mt">Выполнен…</span>
            </button>
          )}
          {s === "completed" && (
            <button type="button" role="menuitem" className="mi" onClick={go(actions.onComplete)}>
              <span className="mt">Изменить факт…</span>
            </button>
          )}
          {s === "planned" && (
            <button type="button" role="menuitem" className="mi" onClick={go(actions.onSkip)}>
              <span className="mt">Пропустить</span>
            </button>
          )}
          {s !== "planned" && (
            <button type="button" role="menuitem" className="mi" onClick={go(actions.onRestore)}>
              <span className="mt">Вернуть в запланированные</span>
            </button>
          )}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="mi" onClick={go(actions.onEdit)}>
            <span className="mt">Изменить сумму и дату…</span>
          </button>
          <button type="button" role="menuitem" className="mi" onClick={go(actions.onEditEvent)}>
            <span className="mt">Изменить событие…</span>
          </button>
          <button type="button" role="menuitem" className="mi pay-del" onClick={go(actions.onDelete)}>
            <span className="mt">Удалить…</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function PaymentRow({
  payment,
  account,
  rule,
  today,
  selecting,
  picked,
  actions,
  onPick,
}: {
  payment: Payment;
  account?: Account;
  rule?: RecurrenceInfo;
  today: string;
  selecting: boolean;
  picked: boolean;
  actions: RowActions;
  onPick: (p: Payment) => void;
}) {
  const overdue = isOverdue(payment, today);
  const cls = "prow pay-row" + (payment.status === "completed" ? " done" : payment.status === "skipped" ? " skip" : "") + (picked ? " sel" : "");
  const planDiffers = payment.status === "completed" && payment.actual_amount_kop !== null && payment.actual_amount_kop !== payment.amount_kop;
  return (
    <div className={cls} role="listitem">
      <StatusDot payment={payment} selecting={selecting} picked={picked} onClick={() => (selecting ? onPick(payment) : actions.onToggleStatus(payment))} />
      <span className={"pi pay-pi " + (payment.direction === "income" ? "in" : "out")} aria-hidden="true">
        <svg className="ic" viewBox="0 0 24 24">
          <path d={payment.direction === "income" ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} />
        </svg>
      </span>
      <div className="pt">
        <b>{payment.title}</b>
        <small>
          <span>{formatDay(payment.planned_on, today)}</span>
          {account && <span>· {account.name}</span>}
          {overdue && <span className="late">· просрочен</span>}
          {payment.status === "skipped" && <span>· пропущен</span>}
          {payment.note && <span className="pay-note">· {payment.note}</span>}
        </small>
      </div>
      <div className="pay-chip">
        {rule && (
          <span className="chip" title={describeRule(rule)}>
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />
            </svg>
            <span className="pay-chip-t">{describeRule(rule)}</span>
          </span>
        )}
      </div>
      <div className="pay-sum">
        <Money kop={payment.status === "completed" && payment.actual_amount_kop !== null ? payment.actual_amount_kop : payment.amount_kop} dir={payment.direction} />
        {planDiffers && <small>{`план ${formatKop(payment.amount_kop)}`}</small>}
      </div>
      {selecting ? <span /> : <RowMenu payment={payment} actions={actions} />}
    </div>
  );
}

export interface MonthViewProps {
  group: MonthGroup;
  accounts: Map<number, Account>;
  rules: Map<number, RecurrenceInfo>;
  today: string;
  selecting: boolean;
  picked: Set<number>;
  expanded: boolean;
  onExpand: () => void;
  actions: RowActions;
  onPick: (p: Payment) => void;
  /** Заголовок вместо названия месяца: для списка без группировки по месяцам. */
  title?: string;
}

export function MonthCard(p: MonthViewProps) {
  const { group } = p;
  const heading = p.title ?? monthTitle(group.month);
  const net = monthNet(group.totals);
  const rows = p.expanded ? group.payments : group.payments.slice(0, ROWS_PER_MONTH);
  return (
    <section className="card pay-month" aria-label={heading}>
      <header className="pgrp-h pay-mh">
        <span className="pay-mt">{heading}</span>
        <span className="pay-mtot">
          <span className="amt in">{"+" + formatKop(net.incomeKop)}</span>
          <span className="amt out">{"−" + formatKop(net.expenseKop)}</span>
          <span className={"amt" + (net.netKop < 0 ? " out" : "")}>{"= " + signedKop(net.netKop)}</span>
        </span>
      </header>
      <div role="list">
        {rows.map((pay) => (
          <PaymentRow
            key={pay.id}
            payment={pay}
            account={p.accounts.get(pay.account_id)}
            rule={pay.rule_id !== null ? p.rules.get(pay.rule_id) : undefined}
            today={p.today}
            selecting={p.selecting}
            picked={p.picked.has(pay.id)}
            actions={p.actions}
            onPick={p.onPick}
          />
        ))}
      </div>
      {rows.length < group.payments.length && (
        <button type="button" className="btn ghost pay-more" onClick={p.onExpand}>
          {`Показать ещё ${group.payments.length - rows.length} из ${paymentsWord(group.payments.length)}`}
        </button>
      )}
      {group.totals.skipped_count > 0 && <p className="pay-skipped">{`Пропущено: ${group.totals.skipped_count}, в итог не входят`}</p>}
    </section>
  );
}

function PeriodBar({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const err = periodError(period);
  return (
    <div className="pay-period-bar">
      <div className="seg" role="group" aria-label="Период">
        {(Object.keys(KIND_TITLE) as PeriodKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={k === period.kind ? "on" : ""}
            aria-pressed={k === period.kind}
            onClick={() => (k === "custom" ? onChange({ ...period, kind: "custom" }) : onChange(periodFor(k, period.from)))}
          >
            {KIND_TITLE[k]}
          </button>
        ))}
      </div>
      <div className="pay-nav">
        <button type="button" className="btn ghost icon" aria-label="Назад" onClick={() => onChange(shiftPeriod(period, -1))} disabled={period.kind === "custom" && Boolean(err)}>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <b className="pay-ptitle">{periodTitle(period)}</b>
        <button type="button" className="btn ghost icon" aria-label="Вперёд" onClick={() => onChange(shiftPeriod(period, 1))} disabled={period.kind === "custom" && Boolean(err)}>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      {period.kind === "custom" && (
        <div className="pay-custom">
          <input type="date" className="inp" aria-label="С даты" value={period.from} onChange={(e) => onChange({ ...period, from: e.target.value })} />
          <span>—</span>
          <input type="date" className="inp" aria-label="По дату" value={period.to} onChange={(e) => onChange({ ...period, to: e.target.value })} />
        </div>
      )}
      {err && period.kind === "custom" && <div className="fmsg pay-perr">{err}</div>}
    </div>
  );
}

function FilterBar({ filters, accounts, onChange }: { filters: Filters; accounts: Account[]; onChange: (f: Filters) => void }) {
  return (
    <div className="pay-filters">
      <div className="seg" role="group" aria-label="Тип">
        {([["all", "Все"], ["income", "Поступления"], ["expense", "Списания"]] as const).map(([id, t]) => (
          <button key={id} type="button" className={filters.direction === id ? "on" : ""} aria-pressed={filters.direction === id} onClick={() => onChange({ ...filters, direction: id })}>
            {t}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="Статус">
        {([["all", "Любой статус"], ["planned", "Запланированы"], ["completed", "Выполнены"], ["skipped", "Пропущены"]] as const).map(([id, t]) => (
          <button key={id} type="button" className={filters.status === id ? "on" : ""} aria-pressed={filters.status === id} onClick={() => onChange({ ...filters, status: id })}>
            {t}
          </button>
        ))}
      </div>
      <select
        className="inp pay-acc-sel"
        aria-label="Счёт"
        value={String(filters.accountId)}
        onChange={(e) => onChange({ ...filters, accountId: e.target.value === "all" ? "all" : Number(e.target.value) })}
      >
        <option value="all">Все счета</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function BulkPill({ count, onDone, onSkip, onDelete, onCancel }: { count: number; onDone: () => void; onSkip: () => void; onDelete: () => void; onCancel: () => void }) {
  return (
    <div className="bulk float pay-bulk" role="toolbar" aria-label="Действия с выбранными">
      <span>Выбрано: {count}</span>
      <span className="vs" />
      <button type="button" className="btn ghost sm" disabled={count === 0} onClick={onDone}>
        Выполнены
      </button>
      <button type="button" className="btn ghost sm" disabled={count === 0} onClick={onSkip}>
        Пропущены
      </button>
      <button type="button" className="btn danger sm" disabled={count === 0} onClick={onDelete}>
        Удалить
      </button>
      <span className="vs" />
      <button type="button" className="btn ghost sm" onClick={onCancel}>
        Готово
      </button>
    </div>
  );
}

/** Итог периода. Новые платежи появляются из событий, поэтому кнопки «Новый платёж» здесь нет. */
export function SummaryCard({ payments, period, selecting, onToggleSelect }: { payments: Payment[]; period: Period; selecting: boolean; onToggleSelect: () => void }) {
  const net = sumNet([totalsOf(payments)]);
  return (
    <section className="card pay-sum-card" aria-label="Итог периода">
      <div className="pay-sum-main">
        <h4>{periodTitle(period)}</h4>
        <div className="kpi-row">
          <div className="k">
            <span className="pay-k-l">Поступления</span>
            <span className="amt big in" data-testid="sum-income">{"+" + formatKop(net.incomeKop)}</span>
          </div>
          <div className="k">
            <span className="pay-k-l">Списания</span>
            <span className="amt big out" data-testid="sum-expense">{"−" + formatKop(net.expenseKop)}</span>
          </div>
          <div className="k">
            <span className="pay-k-l">Разница</span>
            <span className={"amt big" + (net.netKop < 0 ? " out" : "")} data-testid="sum-net">{signedKop(net.netKop)}</span>
          </div>
        </div>
        <span className="acc-total-note">{paymentsWord(payments.length)} в периоде, пропущенные не считаются</span>
      </div>
      <div className="pay-sum-acts">
        {payments.length > 0 && (
          <button type="button" className="btn" aria-pressed={selecting} onClick={onToggleSelect}>
            {selecting ? "Отменить выбор" : "Выбрать"}
          </button>
        )}
      </div>
    </section>
  );
}

export function EmptyPayments({ filtered }: { filtered: boolean }) {
  return (
    <section className="card shell-empty" aria-labelledby="screen-title">
      <div className="empty">
        <div className="ei">
          <Icon name="list" />
        </div>
        <b>{filtered ? "Ничего не найдено" : "В этом периоде платежей нет"}</b>
        <p>
          {filtered
            ? "Измени период, поиск или фильтры, чтобы увидеть платежи."
            : "Платежи появляются из событий. Добавь поступление или списание, в том числе повторяющееся, в разделе «События»."}
        </p>
      </div>
    </section>
  );
}

/** Поиск и сортировка: ряд кнопок критериев, повторный клик или стрелка разворачивают порядок. */
export function SearchSortBar({ query, onQuery, sort, onSort }: { query: string; onQuery: (q: string) => void; sort: SortState; onSort: (s: SortState) => void }) {
  return (
    <div className="pay-sortbar">
      <div className="ev-search">
        <Icon name="search" />
        <input type="search" className="inp" placeholder="Поиск по названию, комментарию, счёту" aria-label="Поиск по платежам" value={query} onChange={(e) => onQuery(e.target.value)} />
      </div>
      <div className="seg" role="group" aria-label="Сортировка">
        {(Object.keys(SORT_TITLES) as SortKey[]).map((k) => (
          <button key={k} type="button" className={sort.key === k ? "on" : ""} aria-pressed={sort.key === k} onClick={() => onSort(sort.key === k ? { key: k, reverse: !sort.reverse } : { key: k, reverse: false })}>
            {SORT_TITLES[k]}
          </button>
        ))}
      </div>
      <button type="button" className="btn ghost sm" aria-label="Развернуть порядок" title="Развернуть порядок" onClick={() => onSort({ ...sort, reverse: !sort.reverse })}>
        <Icon name={sort.reverse ? "up" : "down"} />
        <span>{sortHint(sort)}</span>
      </button>
    </div>
  );
}

type Dialog =
  | { kind: "event"; payment: Payment }
  | { kind: "amount"; payment: Payment }
  | { kind: "complete"; payment: Payment }
  | { kind: "delete"; payments: Payment[] };

const SORT_KEY = "payments.sort";

/** Период для списка платежей одного события: весь срок, если он помещается в окно экрана, иначе месяц вокруг ближайшего платежа. */
export function periodForFocus(f: EventFocus): Period {
  const span = diffDays(f.from, f.to) + 1;
  return span <= MAX_PERIOD_DAYS ? { kind: "custom", from: f.from, to: f.to } : periodFor("month", f.anchor);
}

/** Экран «Платежи»: все платежи из всех событий текущего профиля за период. Создаются платежи в «Событиях». */
export function PaymentsScreen({
  api = tauriPaymentApi,
  accountApi = tauriAccountApi,
  settingsApi = tauriSettingsApi,
  now = todayIso,
  focus: initialFocus = null,
}: {
  api?: PaymentApi;
  accountApi?: AccountApi;
  settingsApi?: SettingsApi;
  now?: () => string;
  /** Показать только платежи одного события (переход из «Событий»). */
  focus?: EventFocus | null;
}) {
  const today = now();
  const [focus, setFocus] = useState<EventFocus | null>(initialFocus);
  const [period, setPeriod] = useState<Period>(() => (initialFocus ? periodForFocus(initialFocus) : periodFor("month", today)));
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [list, setList] = useState<PaymentList | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seq = useRef(0);

  const perr = periodError(period);
  const filterKey = JSON.stringify([period.from, period.to, filters, focus?.key ?? null]);

  const reload = useCallback(async () => {
    if (perr) return;
    const mine = ++seq.current;
    try {
      const res = await api.list(toBackendFilter(period, filters, focus));
      if (mine !== seq.current) return; // пока грузили, период уже сменили
      setList(res);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
    // период и фильтры собраны в filterKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, filterKey, perr]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    accountApi.list().then(setAccounts).catch((e: Error) => setError(e.message));
  }, [accountApi]);

  // Сортировка помнится в настройках профиля; поиск и фильтры при выходе из раздела сбрасываются.
  useEffect(() => {
    let alive = true;
    settingsApi
      .get(SORT_KEY)
      .then((raw) => alive && setSort(parseSort(raw)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settingsApi]);

  const changeSort = (s: SortState) => {
    setSort(s);
    settingsApi.set(SORT_KEY, JSON.stringify(s)).catch(() => {});
  };

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const ruleMap = useMemo(() => new Map((list?.rules ?? []).map((r) => [r.rule_id, r])), [list]);
  const accountName = useCallback((id: number) => accountMap.get(id)?.name ?? "", [accountMap]);

  // Всё, что ниже, считается из списка периода на экране: поиск, порядок, группы и итоги.
  const visible = useMemo(() => {
    const all = (list?.months ?? []).flatMap((m) => m.payments).filter((pay) => matchesQuery(pay, query, accountName(pay.account_id)));
    return sortPayments(all, sort, accountName);
  }, [list, query, sort, accountName]);
  const groups = useMemo(() => {
    if (sort.key !== "date") return null;
    const months = groupMonths(visible);
    // visible уже отсортирован (в том числе в обратную сторону), поэтому месяцы тоже разворачиваем.
    return sort.reverse ? months.reverse() : months;
  }, [visible, sort]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const actions: RowActions = {
    onToggleStatus: (p) => (p.status === "planned" ? setDialog({ kind: "complete", payment: p }) : void run(() => api.setStatus(p.id, "planned", null))),
    onComplete: (p) => setDialog({ kind: "complete", payment: p }),
    onSkip: (p) => void run(() => api.setStatus(p.id, "skipped", null)),
    onRestore: (p) => void run(() => api.setStatus(p.id, "planned", null)),
    onEdit: (p) => setDialog({ kind: "amount", payment: p }),
    onEditEvent: (p) => setDialog({ kind: "event", payment: p }),
    onDelete: (p) => setDialog({ kind: "delete", payments: [p] }),
  };

  const pickedPayments = visible.filter((p) => picked.has(p.id));

  const endSelect = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const bulkStatus = (status: PaymentStatus) =>
    run(async () => {
      for (const p of pickedPayments) if (p.status !== status) await api.setStatus(p.id, status, null);
      endSelect();
    });

  async function saveEvent(checked: Checked, scope: Scope) {
    const d = dialog;
    if (!d || d.kind !== "event") return;
    const rule = d.payment.rule_id !== null ? (ruleMap.get(d.payment.rule_id) ?? null) : null;
    await api.update(d.payment.id, toPatch(checked, d.payment, rule, scope), scope);
    await reload();
  }

  const filtered = filters.direction !== "all" || filters.status !== "all" || filters.accountId !== "all" || query.trim() !== "";
  const editRule = dialog?.kind === "event" && dialog.payment.rule_id != null ? (ruleMap.get(dialog.payment.rule_id) ?? null) : null;

  const card = (g: MonthGroup, title?: string) => (
    <MonthCard
      key={title ?? g.month}
      group={g}
      title={title}
      accounts={accountMap}
      rules={ruleMap}
      today={today}
      selecting={selecting}
      picked={picked}
      expanded={expanded.has(title ?? g.month)}
      onExpand={() => setExpanded((s) => new Set(s).add(title ?? g.month))}
      actions={actions}
      onPick={(p) =>
        setPicked((s) => {
          const n = new Set(s);
          if (!n.delete(p.id)) n.add(p.id);
          return n;
        })
      }
    />
  );

  return (
    <>
      {error && (
        <div className="ban err" role="alert">
          <div className="bt">
            <b>Не получилось</b>
            {error}
          </div>
          <div className="ba">
            <button type="button" className="btn" onClick={() => void reload()}>
              Повторить
            </button>
          </div>
        </div>
      )}
      {focus && (
        <div className="pay-focus" role="status">
          <span>
            Платежи события «{focus.title}»
          </span>
          <button type="button" className="btn ghost sm" aria-label="Показать платежи всех событий" onClick={() => { setFocus(null); setPeriod(periodFor("month", today)); endSelect(); }}>
            <Icon name="close" />
            Все события
          </button>
        </div>
      )}
      <PeriodBar period={period} onChange={(p) => { setPeriod(p); endSelect(); }} />
      <FilterBar filters={filters} accounts={accounts} onChange={(f) => { setFilters(f); endSelect(); }} />
      <SearchSortBar query={query} onQuery={(q) => { setQuery(q); endSelect(); }} sort={sort} onSort={changeSort} />
      {perr ? null : list === null ? (
        !error && <p className="acc-none">Загрузка…</p>
      ) : (
        <>
          <SummaryCard payments={visible} period={period} selecting={selecting} onToggleSelect={() => (selecting ? endSelect() : setSelecting(true))} />
          {visible.length === 0 ? (
            <EmptyPayments filtered={filtered} />
          ) : groups ? (
            groups.map((g) => card(g))
          ) : (
            card({ month: "", totals: totalsOf(visible), payments: visible }, `По признаку «${SORT_TITLES[sort.key].toLowerCase()}»`)
          )}
        </>
      )}
      {selecting && (
        <BulkPill
          count={picked.size}
          onDone={() => void bulkStatus("completed")}
          onSkip={() => void bulkStatus("skipped")}
          onDelete={() => setDialog({ kind: "delete", payments: pickedPayments })}
          onCancel={endSelect}
        />
      )}
      {dialog?.kind === "amount" && (
        <PaymentEditDialog
          payment={dialog.payment}
          onClose={() => setDialog(null)}
          onSave={async (kop, day) => {
            const patch: { amount_kop?: number; planned_on?: string } = {};
            if (kop !== dialog.payment.amount_kop) patch.amount_kop = kop;
            if (day !== dialog.payment.planned_on) patch.planned_on = day;
            if (Object.keys(patch).length > 0) await api.update(dialog.payment.id, patch, "this");
            await reload();
          }}
        />
      )}
      {dialog?.kind === "event" && (
        <PaymentDialog entity="event" payment={dialog.payment} rule={editRule} accounts={accounts} today={today} api={api} onSave={saveEvent} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "complete" && (
        <CompleteDialog payment={dialog.payment} onClose={() => setDialog(null)} onConfirm={async (kop) => { await api.setStatus(dialog.payment.id, "completed", kop); await reload(); }} />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          payments={dialog.payments}
          onClose={() => setDialog(null)}
          onConfirm={async (scope) => {
            for (const p of dialog.payments) await api.remove(p.id, scope);
            endSelect();
            await reload();
          }}
        />
      )}
    </>
  );
}
