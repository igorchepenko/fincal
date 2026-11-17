import { useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { AccountIcon } from "./AccountIcon";
import type { Account, AccountInput } from "./api";
import { emptyForm, formFromAccount, localDay, validateForm, MAX_ACCOUNT_COMMENT, MAX_ACCOUNT_NAME, type AccountForm, type FormErrors } from "./form";
import { colors, colorVar, defaultIcon, icons, kinds, type AccountKind } from "./options";

const CHECK = "M5 12.5l4.5 4.5L19 7.5";

/** Диалог создания и правки счёта. `account` = null означает «новый счёт». */
export function AccountDialog({
  account,
  onSave,
  onClose,
}: {
  account: Account | null;
  onSave: (input: AccountInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AccountForm>(() => (account ? formFromAccount(account) : emptyForm()));
  // Пока человек не менял иконку руками, она следует за типом счёта.
  const [iconTouched, setIconTouched] = useState(Boolean(account));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const credit = form.kind === "credit_card";

  const set = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerError(null);
  };

  function pickKind(kind: AccountKind) {
    setForm((f) => ({ ...f, kind, icon: iconTouched ? f.icon : defaultIcon(kind) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const res = validateForm(form, localDay());
    if ("errors" in res) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSave(res.input);
      onClose();
    } catch (err) {
      setServerError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="dlg-form acc-form" onSubmit={submit} noValidate>
        <h3>{account ? "Изменить счёт" : "Новый счёт"}</h3>

        <div>
          <label className="flab" htmlFor="acc-name">
            Название
          </label>
          <input
            id="acc-name"
            className={"inp" + (errors.name ? " err" : "")}
            value={form.name}
            autoFocus
            maxLength={MAX_ACCOUNT_NAME * 2}
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => set("name", e.target.value)}
          />
          {errors.name && <div className="fmsg">{errors.name}</div>}
        </div>

        <div>
          <span className="flab" id="acc-kind-l">
            Тип
          </span>
          <div className="acc-kinds" role="radiogroup" aria-labelledby="acc-kind-l">
            {kinds.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={k.id === form.kind}
                className={"rad" + (k.id === form.kind ? " on" : "")}
                onClick={() => pickKind(k.id)}
              >
                <span className="ro" />
                <span>
                  <b>{k.title}</b>
                  <small>{k.hint}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="flab" htmlFor="acc-balance">
            {credit ? "Задолженность" : "Баланс"}
          </label>
          <div className={"inp acc-money" + (errors.balance ? " err" : "")}>
            <input
              id="acc-balance"
              inputMode="decimal"
              className="inp mono"
              value={form.balance}
              aria-invalid={errors.balance ? true : undefined}
              onChange={(e) => set("balance", e.target.value)}
            />
            <span className="sfx">₽</span>
          </div>
          {errors.balance && <div className="fmsg">{errors.balance}</div>}
          <p className="dlg-note">
            {credit
              ? "Сумма долга без минуса, в итоге она пойдёт со знаком минус. "
              : "Остаток на сегодня. "}
            {account
              ? "Если изменить сумму, она станет новым остатком на сегодня."
              : "Платежи, которые появятся позже, считаются поверх этого остатка."}
          </p>
        </div>

        <div>
          <label className="flab" htmlFor="acc-comment">
            Комментарий
          </label>
          <textarea
            id="acc-comment"
            className={"inp ta" + (errors.comment ? " err" : "")}
            rows={2}
            value={form.comment}
            maxLength={MAX_ACCOUNT_COMMENT * 2}
            onChange={(e) => set("comment", e.target.value)}
          />
          {errors.comment && <div className="fmsg">{errors.comment}</div>}
        </div>

        <div>
          <span className="flab" id="acc-color-l">
            Цвет
          </span>
          <div className="swpick" role="radiogroup" aria-labelledby="acc-color-l">
            {colors.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={c.id === form.color}
                aria-label={c.title}
                title={c.title}
                className={c.id === form.color ? "on" : ""}
                style={{ ["--c" as string]: colorVar(c.id) }}
                onClick={() => set("color", c.id)}
              >
                {c.id === form.color && (
                  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                    <path d={CHECK} />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="flab" id="acc-icon-l">
            Иконка
          </span>
          <div className="icopick" role="radiogroup" aria-labelledby="acc-icon-l">
            {icons.map((i) => (
              <button
                key={i.id}
                type="button"
                role="radio"
                aria-checked={i.id === form.icon}
                aria-label={i.title}
                title={i.title}
                className={i.id === form.icon ? "on" : ""}
                onClick={() => {
                  setIconTouched(true);
                  set("icon", i.id);
                }}
              >
                <AccountIcon id={i.id} />
              </button>
            ))}
          </div>
        </div>

        <div className="sw-row">
          <button
            type="button"
            role="switch"
            aria-checked={form.includeInTotal}
            aria-labelledby="acc-total-l"
            className={"sw" + (form.includeInTotal ? " on" : "")}
            onClick={() => set("includeInTotal", !form.includeInTotal)}
          />
          <span id="acc-total-l">Учитывать в общем итоге</span>
        </div>

        {serverError && <div className="fmsg">{serverError}</div>}
        <div className="dlg-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {account ? "Сохранить" : "Добавить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
