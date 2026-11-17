import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../shell/Icon";
import { AccountDialog } from "./AccountDialog";
import { AccountIcon } from "./AccountIcon";
import { tauriAccountApi, type Account, type AccountApi, type AccountInput } from "./api";
import { formatKop } from "./money";
import { colorVar, kindTitle } from "./options";
import { summarize, type Summary } from "./summary";


function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function Amount({ kop, className = "" }: { kop: number; className?: string }) {
  // Положительный остаток нейтральный, красным только отрицательный (правило MyDS).
  return <span className={`amt ${kop < 0 ? "out" : ""} ${className}`.trim()}>{formatKop(kop)}</span>;
}

export function TotalCard({ summary, onAdd }: { summary: Summary; onAdd: () => void }) {
  const { totalKop, counted, excluded } = summary;
  return (
    <section className="card acc-total" aria-label="Общий итог">
      <div className="balh">
        <div className="bl">
          <h4>Общий итог</h4>
          <div className={"bn" + (totalKop < 0 ? " neg" : "")} data-testid="total">
            {formatKop(totalKop)}
          </div>
          <span className="acc-total-note">
            {counted > 0
              ? `Учтено ${counted} ${plural(counted, "счёт", "счёта", "счетов")}`
              : "Нет счетов, учитываемых в итоге"}
            {excluded > 0 && `, ещё ${excluded} вне итога`}
          </span>
        </div>
      </div>
      <button type="button" className="btn primary" onClick={onAdd}>
        <Icon name="plus" />
        Добавить счёт
      </button>
    </section>
  );
}

function Row({
  account,
  onEdit,
  onToggleTotal,
  onArchive,
}: {
  account: Account;
  onEdit: () => void;
  onToggleTotal: () => void;
  onArchive: () => void;
}) {
  const archived = account.status === "archived";
  return (
    <div className={"acc acc-row" + (archived ? " archived" : "")} style={{ ["--c" as string]: colorVar(account.color) }}>
      <span className="ai">
        <AccountIcon id={account.icon} />
      </span>
      <div className="an">
        <b>{account.name}</b>
        <small>
          {kindTitle(account.kind) + (account.comment ? ` · ${account.comment}` : "")}
        </small>
      </div>
      <div className="av">
        <Amount kop={account.balance_kop} />
        {account.kind === "credit_card" && account.balance_kop < 0 && <small className="acc-debt">долг</small>}
      </div>
      <div className="acc-acts">
        {!archived && (
          <button
            type="button"
            role="switch"
            aria-checked={account.include_in_total}
            aria-label={`Учитывать «${account.name}» в итоге`}
            title="Учитывать в общем итоге"
            className={"sw" + (account.include_in_total ? " on" : "")}
            onClick={onToggleTotal}
          />
        )}
        {!archived && (
          <button type="button" className="btn ghost" onClick={onEdit}>
            Изменить
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onArchive}>
          {archived ? "Вернуть" : "В архив"}
        </button>
      </div>
    </div>
  );
}

export interface AccountsViewProps {
  accounts: Account[];
  showArchive: boolean;
  onToggleArchive: () => void;
  onAdd: () => void;
  onEdit: (a: Account) => void;
  onToggleTotal: (a: Account) => void;
  onArchive: (a: Account, archived: boolean) => void;
}

/** Только отрисовка: список счетов, итог сверху, архив внизу. Данные и действия приходят снаружи. */
export function AccountsView(p: AccountsViewProps) {
  const summary = useMemo(() => summarize(p.accounts), [p.accounts]);
  const active = p.accounts.filter((a) => a.status === "active");
  const archived = p.accounts.filter((a) => a.status === "archived");

  if (p.accounts.length === 0) {
    return (
      <section className="card shell-empty" aria-labelledby="screen-title">
        <div className="empty">
          <div className="ei">
            <Icon name="wallet" />
          </div>
          <b>Счетов пока нет</b>
          <p>Добавь карты, наличные и вклады, чтобы видеть остатки в одном месте.</p>
          <div className="ea">
            <button type="button" className="btn primary" onClick={p.onAdd}>
              Добавить счёт
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <TotalCard summary={summary} onAdd={p.onAdd} />
      {active.length === 0 ? (
        <p className="acc-none">Все счета в архиве. Верни нужный или добавь новый.</p>
      ) : (
        <div className="acc-list" role="list" aria-label="Счета">
          {active.map((a) => (
            <div role="listitem" key={a.id}>
              <Row
                account={a}
                onEdit={() => p.onEdit(a)}
                onToggleTotal={() => p.onToggleTotal(a)}
                onArchive={() => p.onArchive(a, true)}
              />
            </div>
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <div className="acc-archive">
          <button type="button" className="btn ghost" aria-expanded={p.showArchive} onClick={p.onToggleArchive}>
            {`Архив (${archived.length})`}
          </button>
          {p.showArchive && (
            <div className="acc-list" role="list" aria-label="Архивные счета">
              {archived.map((a) => (
                <div role="listitem" key={a.id}>
                  <Row account={a} onEdit={() => {}} onToggleTotal={() => {}} onArchive={() => p.onArchive(a, false)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Экран «Счета». Все счета и действия относятся к текущему профилю: Rust выбирает его сам. */
export function AccountsScreen({ api = tauriAccountApi }: { api?: AccountApi }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ account: Account | null } | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  const reload = useCallback(async () => {
    try {
      setAccounts(await api.list());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toInput = (a: Account, patch: Partial<AccountInput> = {}): AccountInput => ({
    name: a.name,
    kind: a.kind,
    comment: a.comment,
    color: a.color,
    icon: a.icon,
    include_in_total: a.include_in_total,
    balance_kop: a.balance_kop,
    balance_on: a.balance_on,
    ...patch,
  });

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
      {accounts === null ? (
        !error && <p className="acc-none">Загрузка…</p>
      ) : (
        <AccountsView
          accounts={accounts}
          showArchive={showArchive}
          onToggleArchive={() => setShowArchive((v) => !v)}
          onAdd={() => setDialog({ account: null })}
          onEdit={(a) => setDialog({ account: a })}
          onToggleTotal={(a) => run(() => api.update(a.id, toInput(a, { include_in_total: !a.include_in_total })))}
          onArchive={(a, archived) => run(() => api.setArchived(a.id, archived))}
        />
      )}
      {dialog && (
        <AccountDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSave={async (input) => {
            if (dialog.account) await api.update(dialog.account.id, input);
            else await api.create(input);
            await reload();
          }}
        />
      )}
    </>
  );
}
