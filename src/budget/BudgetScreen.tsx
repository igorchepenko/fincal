import { useEffect, useMemo, useRef, useState } from "react";
import { tauriAccountApi, type Account, type AccountApi } from "../accounts/api";
import { formatKop } from "../accounts/money";
import { Icon } from "../shell/Icon";
import { tauriPaymentApi, type Payment, type PaymentApi } from "../payments/api";
import { formatDay, today as todayIso } from "../payments/dates";
import { BudgetChart } from "./BudgetChart";
import { computeBudget, KIND_TITLE, loadRange, periodAround, periodError, periodFor, periodTitle, shiftPeriod, type BudgetData, type BudgetPeriod, type PeriodKind } from "./model";

export function BudgetPeriodBar({ period, today, onChange }: { period: BudgetPeriod; today: string; onChange: (p: BudgetPeriod) => void }) {
  const err = periodError(period);
  return (
    <div className="pay-period-bar bud-period">
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
        <button type="button" className="btn ghost icon" aria-label="Назад" onClick={() => onChange(shiftPeriod(period, -1))} disabled={Boolean(err)}>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <b className="pay-ptitle">{periodTitle(period)}</b>
        <button type="button" className="btn ghost icon" aria-label="Вперёд" onClick={() => onChange(shiftPeriod(period, 1))} disabled={Boolean(err)}>
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button type="button" className="btn sm" onClick={() => onChange(periodAround(period, today))}>
          Сегодня
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

function Kpi({ label, value, tone, note }: { label: string; value: string; tone?: "in" | "out"; note?: string }) {
  return (
    <div className="k bud-k">
      <span className="pay-k-l">{label}</span>
      <b className={"amt big sm" + (tone ? " " + tone : "")}>{value}</b>
      {note && <span className="pay-k-l">{note}</span>}
    </div>
  );
}

export function BudgetNumbers({ data }: { data: BudgetData }) {
  const delta = data.endKop - data.startKop;
  return (
    <div className="kpi-row bud-kpis">
      <Kpi label="Баланс на начало" value={formatKop(data.startKop)} tone={data.startKop < 0 ? "out" : undefined} />
      <Kpi label="Баланс на конец" value={formatKop(data.endKop)} tone={data.endKop < 0 ? "out" : undefined} note={`${delta >= 0 ? "+" : "−"}${formatKop(Math.abs(delta))} за период`} />
      <Kpi label="Приходы" value={formatKop(data.incomeKop)} tone="in" />
      <Kpi label="Расходы" value={formatKop(data.expenseKop)} tone="out" />
      <Kpi label="Минимальный баланс" value={formatKop(data.minKop)} tone={data.minKop < 0 ? "out" : undefined} note={formatDay(data.minOn)} />
    </div>
  );
}

/** Раздел «Бюджет»: баланс по счетам «в итоге» и движение денег за выбранный период. */
export function BudgetScreen({
  api = tauriPaymentApi,
  accountApi = tauriAccountApi,
  now = todayIso,
}: {
  api?: PaymentApi;
  accountApi?: AccountApi;
  now?: () => string;
}) {
  const today = now();
  const [period, setPeriod] = useState<BudgetPeriod>(() => periodFor("month", today));
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    accountApi.list().then(setAccounts).catch((e: Error) => setError(e.message));
  }, [accountApi]);

  const perr = periodError(period);
  useEffect(() => {
    if (!accounts || perr) return;
    const mine = ++seq.current;
    const range = loadRange(accounts, period);
    api
      .list({ from: range.from, to: range.to })
      .then((res) => {
        if (mine !== seq.current) return; // период уже сменили
        setPayments(res.months.flatMap((m) => m.payments));
        setError(null);
      })
      .catch((e: Error) => mine === seq.current && setError(e.message));
  }, [api, accounts, period, perr]);

  const data = useMemo(() => (accounts && payments && !perr ? computeBudget(accounts, payments, period) : null), [accounts, payments, period, perr]);

  return (
    <div className="bud">
      <BudgetPeriodBar period={period} today={today} onChange={setPeriod} />
      {error && (
        <div className="fmsg" role="alert">
          {error}
        </div>
      )}
      {data && data.accountCount === 0 ? (
        <section className="card" aria-label="Нет счетов для бюджета">
          <div className="empty">
            <div className="ei">
              <Icon name="chart" />
            </div>
            <b>Нет счетов для графика</b>
            <p>В бюджет входят активные счета с флажком «в итоге». Добавь счёт или включи флажок в разделе «Счета».</p>
          </div>
        </section>
      ) : data ? (
        <section className="card chart-card" aria-label="Бюджет за период">
          <BudgetNumbers data={data} />
          <BudgetChart data={data} />
          <div className="dlg-note">
            Учтены {data.accountCount} {data.accountCount === 1 ? "счёт" : "счетов"} «в итоге». Выполненные платежи по факту, запланированные по плану, пропущенные не учитываются.
          </div>
        </section>
      ) : (
        !error && !perr && <div className="dlg-note">Считаю…</div>
      )}
    </div>
  );
}


