import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Account } from "../accounts/api";
import { formatKop, kopToInput, parseRubles } from "../accounts/money";
import { Modal } from "../ui/Modal";
import type { Frequency, Payment, PaymentApi, RecurrenceInfo, RecurrencePreview, Scope } from "./api";
import { formatDay, isValidDay, WEEKDAY_CODES, WEEKDAY_SHORT_RU, weekdayCode } from "./dates";
import {
  emptyForm,
  formFromPayment,
  MAX_NOTE,
  MAX_TITLE,
  periodDays,
  previewSpec,
  recurrenceChanged,
  validatePaymentForm,
  type Checked,
  type FormErrors,
  type PaymentForm,
  type RecurrenceForm,
} from "./form";
import { describeRule, paymentsWord, plural } from "./model";

const FREQ: { id: Frequency; title: string; unit: [string, string, string] }[] = [
  { id: "daily", title: "День", unit: ["день", "дня", "дней"] },
  { id: "weekly", title: "Неделя", unit: ["неделю", "недели", "недель"] },
  { id: "monthly", title: "Месяц", unit: ["месяц", "месяца", "месяцев"] },
];

/** Подсказка под конструктором: сколько платежей получится. */
export function previewText(p: RecurrencePreview): string {
  if (p.count === 0 || !p.first || !p.last) return "В этом периоде нет подходящих дат";
  const range = p.count === 1 ? formatDay(p.first) : `с ${formatDay(p.first, p.last)} по ${formatDay(p.last, p.first)}`;
  return `Будет ${paymentsWord(p.count)}: ${range}`;
}

function RecurrenceBuilder({
  form,
  errors,
  onChange,
  api,
  startLabel,
}: {
  form: PaymentForm;
  errors: FormErrors;
  onChange: (rec: RecurrenceForm) => void;
  api: PaymentApi;
  startLabel: string;
}) {
  const r = form.rec;
  const set = (patch: Partial<RecurrenceForm>) => onChange({ ...r, ...patch });
  const n = Number(r.interval);
  const unit = FREQ.find((f) => f.id === r.frequency)!.unit;
  const first = weekdayCode(form.date);

  const spec = useMemo(() => previewSpec(form), [form]);
  const key = spec ? JSON.stringify(spec) : "";
  const [preview, setPreview] = useState<{ key: string; text: string; bad: boolean } | null>(null);

  useEffect(() => {
    if (!spec) return;
    let live = true;
    const t = setTimeout(() => {
      api
        .preview(spec)
        .then((p) => live && setPreview({ key, text: previewText(p), bad: p.count === 0 }))
        .catch((e: Error) => live && setPreview({ key, text: e.message, bad: true }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // key описывает spec целиком
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);

  const days = periodDays(form);
  const shown = spec && preview?.key === key ? preview : null;

  return (
    <div className="pay-rec">
      <div className="pay-rec-row">
        <span className="flab" id="rec-freq-l">
          Повторять
        </span>
        <div className="seg" role="radiogroup" aria-labelledby="rec-freq-l">
          {FREQ.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={f.id === r.frequency}
              className={f.id === r.frequency ? "on" : ""}
              onClick={() => set({ frequency: f.id })}
            >
              {f.title}
            </button>
          ))}
        </div>
      </div>

      <div className="pay-rec-row">
        <label className="flab" htmlFor="rec-int">
          Каждые
        </label>
        <div className="pay-int">
          <input
            id="rec-int"
            inputMode="numeric"
            className={"inp mono" + (errors.interval ? " err" : "")}
            value={r.interval}
            aria-invalid={errors.interval ? true : undefined}
            onChange={(e) => set({ interval: e.target.value })}
          />
          <span>{Number.isInteger(n) && n > 0 ? plural(n, ...unit) : unit[2]}</span>
        </div>
      </div>
      {errors.interval && <div className="fmsg">{errors.interval}</div>}

      {r.frequency === "weekly" && (
        <div>
          <span className="flab" id="rec-wd-l">
            В какие дни недели
          </span>
          <div className="pay-chips" role="group" aria-labelledby="rec-wd-l">
            {WEEKDAY_CODES.map((c) => {
              const on = r.weekdays.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  className={"chip lg" + (on ? " accent" : "")}
                  onClick={() => set({ weekdays: on ? r.weekdays.filter((d) => d !== c) : [...r.weekdays, c] })}
                >
                  {WEEKDAY_SHORT_RU[c]}
                </button>
              );
            })}
          </div>
          {r.weekdays.length === 0 && first && (
            <p className="dlg-note">Дни не выбраны: платёж будет в тот же день недели, что и первый ({WEEKDAY_SHORT_RU[first]}).</p>
          )}
        </div>
      )}

      {r.frequency === "monthly" && (
        <div>
          <label className="flab" htmlFor="rec-md">
            Числа месяца
          </label>
          <div className="pay-md">
            <input
              id="rec-md"
              className={"inp mono" + (errors.monthDays ? " err" : "")}
              placeholder="например, 5, 20"
              value={r.monthDays}
              aria-invalid={errors.monthDays ? true : undefined}
              onChange={(e) => set({ monthDays: e.target.value })}
            />
            <button
              type="button"
              aria-pressed={r.lastDay}
              className={"chip lg" + (r.lastDay ? " accent" : "")}
              onClick={() => set({ lastDay: !r.lastDay })}
            >
              Последний день
            </button>
          </div>
          {errors.monthDays && <div className="fmsg">{errors.monthDays}</div>}
          <p className="dlg-note">
            Если числа в месяце нет (31-е в апреле, 30-е в феврале), платёж переносится на последний день месяца.
            {r.monthDays.trim() === "" && !r.lastDay && " Числа не заданы: платёж будет в то же число, что и первый."}
          </p>
        </div>
      )}

      <div className="pay-period">
        <div>
          <span className="flab">С</span>
          <div className="inp dis pay-from">{startLabel}</div>
        </div>
        <div>
          <label className="flab" htmlFor="rec-end">
            До
          </label>
          <input
            id="rec-end"
            type="date"
            className={"inp" + (errors.endsOn ? " err" : "")}
            value={r.endsOn}
            aria-invalid={errors.endsOn ? true : undefined}
            onChange={(e) => set({ endsOn: e.target.value })}
          />
        </div>
      </div>
      {errors.endsOn && <div className="fmsg">{errors.endsOn}</div>}
      {days > 3660 && <div className="ban warn">Период больше десяти лет: проверь дату окончания.</div>}

      <div className={"pay-preview" + (shown?.bad ? " bad" : "")} aria-live="polite">
        {shown ? shown.text : spec ? "Считаю…" : "Выбери конец периода, и покажу, сколько будет платежей"}
      </div>
    </div>
  );
}

/** Выбор области правки или удаления для платежа из серии: как в календаре macOS. */
export function ScopeStep({
  title,
  text,
  verb,
  danger,
  thisDisabledReason,
  busy,
  error,
  onPick,
  onBack,
}: {
  title: string;
  text: string;
  verb: string;
  danger?: boolean;
  thisDisabledReason?: string;
  busy?: boolean;
  error?: string | null;
  onPick: (s: Scope) => void;
  onBack: () => void;
}) {
  const [scope, setScope] = useState<Scope>(thisDisabledReason ? "following" : "this");
  const options: { id: Scope; title: string; hint: string; disabled?: string }[] = [
    { id: "this", title: "Только этот", hint: "Остальные платежи серии не изменятся", disabled: thisDisabledReason },
    { id: "following", title: "Этот и все следующие", hint: "Выполненные и пропущенные платежи останутся как есть" },
  ];
  return (
    <div className="dlg-form">
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="rad-list" role="radiogroup" aria-label="Область действия">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={scope === o.id}
            disabled={Boolean(o.disabled)}
            className={"rad" + (scope === o.id ? " on" : "") + (o.disabled ? " muted" : "")}
            onClick={() => setScope(o.id)}
          >
            <span className="ro" />
            <span>
              <b>{o.title}</b>
              <small>{o.disabled ?? o.hint}</small>
            </span>
          </button>
        ))}
      </div>
      {error && <div className="fmsg">{error}</div>}
      <div className="dlg-foot">
        <button type="button" className="btn ghost" onClick={onBack}>
          Назад
        </button>
        <button type="button" className={"btn " + (danger ? "danger" : "primary")} disabled={busy} onClick={() => onPick(scope)}>
          {verb}
        </button>
      </div>
    </div>
  );
}

export interface PaymentDialogProps {
  /** null: новый платёж. */
  payment: Payment | null;
  /** Правило серии этого платежа, если он из серии. */
  rule: RecurrenceInfo | null;
  accounts: Account[];
  today: string;
  api: PaymentApi;
  onSave: (checked: Checked, scope: Scope) => Promise<void>;
  onClose: () => void;
  /** Что правим: «событие» (раздел «События») или «платёж» (раздел «Платежи»). */
  entity?: "event" | "payment";
}

/** Создание и правка события или платежа с конструктором повторения. */
export function PaymentDialog({ payment, rule, accounts, today, api, onSave, onClose, entity = "payment" }: PaymentDialogProps) {
  const isEvent = entity === "event";
  const inSeries = Boolean(payment && payment.rule_id !== null && rule);
  const [form, setForm] = useState<PaymentForm>(() =>
    payment ? formFromPayment(payment, rule) : emptyForm(today, accounts.find((a) => a.status === "active")?.id),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Checked | null>(null);

  const set = <K extends keyof PaymentForm>(key: K, value: PaymentForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerError(null);
  };

  const active = accounts.filter((a) => a.status === "active" || (payment && a.id === payment.account_id));

  async function save(checked: Checked, scope: Scope) {
    setBusy(true);
    try {
      await onSave(checked, scope);
      onClose();
    } catch (err) {
      setServerError((err as Error).message);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const res = validatePaymentForm(form);
    if ("errors" in res) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    // Платёж из серии: сначала спрашиваем, на что распространить правку.
    if (inSeries) setPending(res.ok);
    else void save(res.ok, "this");
  }

  if (pending) {
    const changed = recurrenceChanged(pending.recurrence, rule);
    return (
      <Modal onClose={onClose}>
        <ScopeStep
          title={isEvent ? "Изменить повторяющееся событие" : "Изменить повторяющийся платёж"}
          text={
            isEvent && payment
              ? `«${pending.title}» повторяется (${rule ? describeRule(rule).toLowerCase() : "серия"}). Правка относится к платежу ${formatDay(payment.planned_on, today)}: применить только к нему или и к следующим?`
              : `«${pending.title}» входит в серию (${rule ? describeRule(rule).toLowerCase() : "повторяется"}). К чему применить изменения?`
          }
          verb="Сохранить"
          thisDisabledReason={changed ? "Правило повторения меняется только для этого и следующих платежей" : undefined}
          busy={busy}
          error={serverError}
          onPick={(s) => void save(pending, s)}
          onBack={() => {
            setPending(null);
            setServerError(null);
          }}
        />
      </Modal>
    );
  }

  const isIn = form.direction === "income";
  const noAccounts = active.length === 0;

  return (
    <Modal onClose={onClose}>
      <form className="dlg-form pay-form" onSubmit={submit} noValidate>
        <h3>{payment ? (isEvent ? "Изменить событие" : "Изменить платёж") : isEvent ? "Новое событие" : "Новый платёж"}</h3>

        <div className="seg money lg fill" role="radiogroup" aria-label="Тип платежа">
          <button
            type="button"
            role="radio"
            aria-checked={isIn}
            className={isIn ? "on in" : ""}
            onClick={() => set("direction", "income")}
          >
            Поступление
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isIn}
            className={!isIn ? "on out" : ""}
            onClick={() => set("direction", "expense")}
          >
            Списание
          </button>
        </div>

        <div>
          <label className="flab" htmlFor="pay-title">
            Название
          </label>
          <input
            id="pay-title"
            className={"inp" + (errors.title ? " err" : "")}
            value={form.title}
            autoFocus
            maxLength={MAX_TITLE * 2}
            aria-invalid={errors.title ? true : undefined}
            onChange={(e) => set("title", e.target.value)}
          />
          {errors.title && <div className="fmsg">{errors.title}</div>}
        </div>

        <div>
          <label className="flab" htmlFor="pay-amount">
            Сумма
          </label>
          <div className={"inp amount pay-money" + (errors.amount ? " err" : "")}>
            <span className={"sgn " + (isIn ? "in" : "out")}>{isIn ? "+" : "−"}</span>
            <input
              id="pay-amount"
              inputMode="decimal"
              className="inp"
              value={form.amount}
              placeholder="0"
              aria-invalid={errors.amount ? true : undefined}
              onChange={(e) => set("amount", e.target.value)}
            />
            <span className="sfx">₽</span>
          </div>
          {errors.amount && <div className="fmsg">{errors.amount}</div>}
        </div>

        <div className="pay-two">
          <div>
            <label className="flab" htmlFor="pay-account">
              Счёт
            </label>
            <select
              id="pay-account"
              className={"inp" + (errors.account ? " err" : "")}
              value={form.accountId}
              aria-invalid={errors.account ? true : undefined}
              onChange={(e) => set("accountId", e.target.value)}
            >
              <option value="">{noAccounts ? "Нет счетов" : "Выбери счёт"}</option>
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {errors.account && <div className="fmsg">{errors.account}</div>}
            {noAccounts && <p className="dlg-note">Сначала добавь счёт в разделе «Счета».</p>}
          </div>
          <div>
            <label className="flab" htmlFor="pay-date">
              {form.rec.enabled ? "Первый платёж" : "Дата"}
            </label>
            <input
              id="pay-date"
              type="date"
              className={"inp" + (errors.date ? " err" : "")}
              value={form.date}
              aria-invalid={errors.date ? true : undefined}
              onChange={(e) => set("date", e.target.value)}
            />
            {errors.date && <div className="fmsg">{errors.date}</div>}
          </div>
        </div>

        {(!payment || inSeries) && (
          <div className="sw-row">
            <button
              type="button"
              role="switch"
              aria-checked={form.rec.enabled}
              aria-labelledby="pay-rec-l"
              disabled={inSeries}
              className={"sw" + (form.rec.enabled ? " on" : "")}
              onClick={() => set("rec", { ...form.rec, enabled: !form.rec.enabled })}
            />
            <span id="pay-rec-l">{inSeries ? "Платёж из серии" : "Повторяется"}</span>
          </div>
        )}
        {payment && !inSeries && (
          <p className="dlg-note">Повторяемость нельзя добавить к уже созданному платежу: создай новый платёж с повторением.</p>
        )}

        {form.rec.enabled && (
          <RecurrenceBuilder
            form={form}
            errors={errors}
            api={api}
            startLabel={formatDay(form.date) === form.date ? "—" : formatDay(form.date)}
            onChange={(rec) => {
              setForm((f) => ({ ...f, rec }));
              setServerError(null);
            }}
          />
        )}

        <div>
          <label className="flab" htmlFor="pay-note">
            Комментарий
          </label>
          <textarea
            id="pay-note"
            className={"inp ta" + (errors.note ? " err" : "")}
            rows={2}
            value={form.note}
            maxLength={MAX_NOTE * 2}
            onChange={(e) => set("note", e.target.value)}
          />
          {errors.note && <div className="fmsg">{errors.note}</div>}
        </div>

        {serverError && <div className="fmsg">{serverError}</div>}
        <div className="dlg-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={busy || noAccounts}>
            {payment ? "Сохранить" : form.rec.enabled ? "Создать серию" : "Добавить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Отметка «выполнен»: фактическая сумма, по умолчанию плановая. */
export function CompleteDialog({
  payment,
  onConfirm,
  onClose,
}: {
  payment: Payment;
  onConfirm: (actualKop: number | null) => Promise<void>;
  onClose: () => void;
}) {
  const start = payment.actual_amount_kop ?? payment.amount_kop;
  const [text, setText] = useState(kopToInput(start));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isIn = payment.direction === "income";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const kop = parseRubles(text);
    if (kop === null || kop <= 0) {
      setError("Введи сумму больше нуля, например 1500 или 349,90");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(kop === payment.amount_kop ? null : kop);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="dlg-form" onSubmit={submit} noValidate>
        <h3>{payment.status === "completed" ? "Фактическая сумма" : "Отметить выполненным"}</h3>
        <p>
          {payment.title}. По плану {isIn ? "+" : "−"}
          {formatKop(payment.amount_kop)}. Если сумма другая, поправь её: на баланс счёта пойдёт фактическая.
        </p>
        <div>
          <label className="flab" htmlFor="pay-actual">
            Фактическая сумма
          </label>
          <div className={"inp amount pay-money" + (error ? " err" : "")}>
            <span className={"sgn " + (isIn ? "in" : "out")}>{isIn ? "+" : "−"}</span>
            <input
              id="pay-actual"
              inputMode="decimal"
              className="inp"
              value={text}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
            />
            <span className="sfx">₽</span>
          </div>
          {error && <div className="fmsg">{error}</div>}
        </div>
        <div className="dlg-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Выполнен
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Удаление: для платежа из серии сначала выбор области, для одиночного простое подтверждение. */
export function DeleteDialog({
  payments,
  onConfirm,
  onClose,
  entity = "payment",
}: {
  /** Один или несколько платежей (массовое удаление идёт только «только этот»). */
  payments: Payment[];
  onConfirm: (scope: Scope) => Promise<void>;
  onClose: () => void;
  entity?: "event" | "payment";
}) {
  const isEvent = entity === "event";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const single = payments.length === 1 ? payments[0] : null;
  const series = Boolean(single && single.rule_id !== null);

  async function run(scope: Scope) {
    setBusy(true);
    try {
      await onConfirm(scope);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (series && single) {
    return (
      <Modal onClose={onClose}>
        <ScopeStep
          title={isEvent ? "Удалить повторяющееся событие" : "Удалить повторяющийся платёж"}
          text={
            isEvent
              ? `«${single.title}» повторяется. Что удалить: только платёж ${single.planned_on.split("-").reverse().join(".")} или и все следующие?`
              : `«${single.title}» входит в серию. Что удалить?`
          }
          verb="Удалить"
          danger
          busy={busy}
          error={error}
          onPick={(s) => void run(s)}
          onBack={onClose}
        />
      </Modal>
    );
  }
  return (
    <Modal onClose={onClose}>
      <div className="dlg-form">
        <h3>{single ? (isEvent ? "Удалить событие?" : "Удалить платёж?") : `Удалить ${paymentsWord(payments.length)}?`}</h3>
        <p>
          {single
            ? `«${single.title}» исчезнет из списка.`
            : "Выбранные платежи исчезнут из списка. Если среди них есть платежи из серий, удалятся только выбранные, остальные останутся."}
        </p>
        {error && <div className="fmsg">{error}</div>}
        <div className="dlg-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void run("this")}>
            Удалить
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Правка одного платежа: плановая сумма и дата. Серия и остальные платежи не меняются. */
export function PaymentEditDialog({
  payment,
  onSave,
  onClose,
}: {
  payment: Payment;
  onSave: (amountKop: number, plannedOn: string) => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(kopToInput(payment.amount_kop));
  const [date, setDate] = useState(payment.planned_on);
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isIn = payment.direction === "income";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const kop = parseRubles(amount);
    const next: { amount?: string; date?: string } = {};
    if (kop === null || kop <= 0) next.amount = "Введи сумму больше нуля, например 1500 или 349,90";
    if (!isValidDay(date)) next.date = "Введи дату целиком";
    setErrors(next);
    if (next.amount || next.date || kop === null) return;
    setBusy(true);
    try {
      await onSave(kop, date);
      onClose();
    } catch (err) {
      setServerError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="dlg-form" onSubmit={submit} noValidate>
        <h3>Изменить платёж</h3>
        <p>
          {payment.title}. Изменится только этот платёж: остальные платежи события и само событие останутся как есть.
          {payment.status === "completed" && " Фактическую сумму меняй отдельно, через «Изменить факт»."}
        </p>
        <div>
          <label className="flab" htmlFor="pay-edit-amount">
            Плановая сумма
          </label>
          <div className={"inp amount pay-money" + (errors.amount ? " err" : "")}>
            <span className={"sgn " + (isIn ? "in" : "out")}>{isIn ? "+" : "−"}</span>
            <input
              id="pay-edit-amount"
              inputMode="decimal"
              className="inp"
              value={amount}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              aria-invalid={errors.amount ? true : undefined}
              onChange={(e) => {
                setAmount(e.target.value);
                setServerError(null);
              }}
            />
            <span className="sfx">₽</span>
          </div>
          {errors.amount && <div className="fmsg">{errors.amount}</div>}
        </div>
        <div>
          <label className="flab" htmlFor="pay-edit-date">
            Дата
          </label>
          <input
            id="pay-edit-date"
            type="date"
            className={"inp" + (errors.date ? " err" : "")}
            value={date}
            aria-invalid={errors.date ? true : undefined}
            onChange={(e) => {
              setDate(e.target.value);
              setServerError(null);
            }}
          />
          {errors.date && <div className="fmsg">{errors.date}</div>}
        </div>
        {serverError && <div className="fmsg">{serverError}</div>}
        <div className="dlg-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
