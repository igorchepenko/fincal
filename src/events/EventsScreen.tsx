import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriAccountApi, type Account, type AccountApi } from "../accounts/api";
import { formatKop } from "../accounts/money";
import { Icon } from "../shell/Icon";
import type { EventItem, PaymentApi, Scope } from "../payments/api";
import { tauriPaymentApi } from "../payments/api";
import { formatDay, today as todayIso } from "../payments/dates";
import { toNewPayment, toPatch, type Checked } from "../payments/form";
import { describeRule } from "../payments/model";
import { DeleteDialog, PaymentDialog } from "../payments/PaymentDialog";
import { activeFilterCount, filterEvents, isActive, isSeries, noEventFilters, progressText, type EventFilters } from "./model";

/** Откуда открыт список платежей события: Shell переключает раздел и передаёт фильтр. */
export interface EventFocus {
  key: string;
  title: string;
  ruleId: number | null;
  paymentId: number | null;
  from: string;
  to: string;
  /** Для серий длиннее окна экрана платежей показываем период вокруг этой даты. */
  anchor: string;
}

export function focusOf(e: EventItem): EventFocus {
  return {
    key: e.key,
    title: e.representative.title,
    ruleId: e.rule ? e.rule.rule_id : null,
    paymentId: e.rule ? null : e.representative.id,
    from: e.first_on,
    to: e.last_on,
    anchor: e.next_on ?? e.representative.planned_on,
  };
}

export function EventCard({
  event,
  account,
  today,
  onEdit,
  onDelete,
  onPayments,
}: {
  event: EventItem;
  account?: Account;
  today: string;
  onEdit: (e: EventItem) => void;
  onDelete: (e: EventItem) => void;
  onPayments: (e: EventItem) => void;
}) {
  const r = event.representative;
  const income = r.direction === "income";
  const active = isActive(event);
  return (
    <article className={"card ev-card" + (active ? "" : " ev-done")} aria-label={r.title}>
      <div className="ev-top">
        <span className={"pi pay-pi " + (income ? "in" : "out")} aria-hidden="true">
          <svg className="ic" viewBox="0 0 24 24">
            <path d={income ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} />
          </svg>
        </span>
        <div className="ev-name">
          <b>{r.title}</b>
          <small>{account ? account.name : "Счёт не найден"}</small>
        </div>
        <span className={"amt " + (income ? "in" : "out")}>{(income ? "+" : "−") + formatKop(Math.abs(r.amount_kop))}</span>
      </div>
      <div className="ev-meta">
        {event.rule ? (
          <span className="chip" title={describeRule(event.rule)}>
            <Icon name="repeat" />
            <span className="pay-chip-t">{describeRule(event.rule)}</span>
          </span>
        ) : (
          <span className="chip">Разовое</span>
        )}
        <span className="ev-prog">{progressText(event)}</span>
      </div>
      <div className="ev-next">
        {event.next_on ? `Ближайший платёж: ${formatDay(event.next_on, today)}` : active ? "Есть просроченные платежи" : isSeries(event) ? `Закончилось ${formatDay(event.last_on, today)}` : `Дата: ${formatDay(event.last_on, today)}`}
        {r.note && <span className="ev-note"> · {r.note}</span>}
      </div>
      <div className="ev-acts">
        <button type="button" className="btn sm" onClick={() => onPayments(event)}>
          {`Платежи события (${event.total})`}
        </button>
        <button type="button" className="btn ghost sm" aria-label={`Изменить событие «${r.title}»`} onClick={() => onEdit(event)}>
          Изменить…
        </button>
        <button type="button" className="btn ghost sm pay-del" aria-label={`Удалить событие «${r.title}»`} onClick={() => onDelete(event)}>
          Удалить…
        </button>
      </div>
    </article>
  );
}

export function EventFilterBar({
  filters,
  accounts,
  onChange,
  onAdd,
  canAdd,
}: {
  filters: EventFilters;
  accounts: Account[];
  onChange: (f: EventFilters) => void;
  onAdd: () => void;
  canAdd: boolean;
}) {
  const count = activeFilterCount(filters);
  return (
    <div className="ev-head">
      <div className="ev-search">
        <Icon name="search" />
        <input type="search" className="inp" placeholder="Поиск по названию" aria-label="Поиск по событиям" value={filters.query} onChange={(e) => onChange({ ...filters, query: e.target.value })} />
      </div>
      <div className="seg" role="group" aria-label="Тип">
        {([["all", "Все"], ["income", "Поступления"], ["expense", "Списания"]] as const).map(([id, t]) => (
          <button key={id} type="button" className={filters.direction === id ? "on" : ""} aria-pressed={filters.direction === id} onClick={() => onChange({ ...filters, direction: id })}>
            {t}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="Состояние">
        {([["active", "Активные"], ["finished", "Завершённые"], ["all", "Все"]] as const).map(([id, t]) => (
          <button key={id} type="button" className={filters.state === id ? "on" : ""} aria-pressed={filters.state === id} onClick={() => onChange({ ...filters, state: id })}>
            {t}
          </button>
        ))}
      </div>
      <select className="inp pay-acc-sel" aria-label="Счёт" value={String(filters.accountId)} onChange={(e) => onChange({ ...filters, accountId: e.target.value === "all" ? "all" : Number(e.target.value) })}>
        <option value="all">Все счета</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {count > 0 && (
        <button type="button" className="btn ghost sm" onClick={() => onChange({ ...noEventFilters, query: filters.query })}>
          {`Сбросить фильтры (${count})`}
        </button>
      )}
      <span className="ev-grow" />
      <button type="button" className="btn primary" disabled={!canAdd} title={canAdd ? undefined : "Сначала заведи счёт в разделе «Счета»"} onClick={onAdd}>
        <Icon name="plus" />
        Новое событие
      </button>
    </div>
  );
}

export function EmptyEvents({ filtered, hasAccounts, onAdd }: { filtered: boolean; hasAccounts: boolean; onAdd: () => void }) {
  return (
    <section className="card shell-empty" aria-labelledby="screen-title">
      <div className="empty">
        <div className="ei">
          <Icon name="repeat" />
        </div>
        <b>{filtered ? "Ничего не найдено" : "Событий пока нет"}</b>
        <p>
          {filtered
            ? "Измени поиск или фильтры, чтобы увидеть события."
            : hasAccounts
              ? "Добавь поступление или списание, в том числе повторяющееся: зарплату, аренду, подписку. Каждый платёж события появится в разделе «Платежи»."
              : "Чтобы добавить событие, сначала заведи счёт в разделе «Счета»."}
        </p>
        {!filtered && hasAccounts && (
          <div className="ea">
            <button type="button" className="btn primary" onClick={onAdd}>
              Новое событие
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

type Dialog = { kind: "edit"; event: EventItem | null } | { kind: "delete"; event: EventItem };

/** Экран «События»: серии и разовые платежи карточками. Создание и правка событий только здесь. */
export function EventsScreen({
  api = tauriPaymentApi,
  accountApi = tauriAccountApi,
  now = todayIso,
  onOpenPayments = () => {},
}: {
  api?: PaymentApi;
  accountApi?: AccountApi;
  now?: () => string;
  onOpenPayments?: (focus: EventFocus) => void;
}) {
  const today = now();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filters, setFilters] = useState<EventFilters>(noEventFilters);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await api.listEvents(today);
      if (mine !== seq.current) return;
      setEvents(res);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
  }, [api, today]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    accountApi.list().then(setAccounts).catch((e: Error) => setError(e.message));
  }, [accountApi]);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const shown = useMemo(() => filterEvents(events ?? [], filters), [events, filters]);
  const hasAccounts = accounts.some((a) => a.status === "active");
  const filtered = filters.query.trim() !== "" || activeFilterCount(filters) > 0;

  async function save(checked: Checked, scope: Scope) {
    const d = dialog;
    if (!d || d.kind !== "edit") return;
    if (!d.event) await api.create(toNewPayment(checked));
    else await api.update(d.event.representative.id, toPatch(checked, d.event.representative, d.event.rule, scope), scope);
    await reload();
  }

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
      <EventFilterBar filters={filters} accounts={accounts} onChange={setFilters} onAdd={() => setDialog({ kind: "edit", event: null })} canAdd={hasAccounts} />
      {events === null ? (
        !error && <p className="acc-none">Загрузка…</p>
      ) : shown.length === 0 ? (
        <EmptyEvents filtered={filtered && events.length > 0} hasAccounts={hasAccounts} onAdd={() => setDialog({ kind: "edit", event: null })} />
      ) : (
        <div className="ev-grid">
          {shown.map((e) => (
            <EventCard
              key={e.key}
              event={e}
              account={accountMap.get(e.representative.account_id)}
              today={today}
              onEdit={(x) => setDialog({ kind: "edit", event: x })}
              onDelete={(x) => setDialog({ kind: "delete", event: x })}
              onPayments={(x) => onOpenPayments(focusOf(x))}
            />
          ))}
        </div>
      )}
      {dialog?.kind === "edit" && (
        <PaymentDialog
          entity="event"
          payment={dialog.event ? dialog.event.representative : null}
          rule={dialog.event ? dialog.event.rule : null}
          accounts={accounts}
          today={today}
          api={api}
          onSave={save}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          entity="event"
          payments={[dialog.event.representative]}
          onClose={() => setDialog(null)}
          onConfirm={async (scope) => {
            await api.remove(dialog.event.representative.id, scope);
            await reload();
          }}
        />
      )}
    </>
  );
}
