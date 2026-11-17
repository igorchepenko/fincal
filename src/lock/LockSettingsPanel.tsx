import { useEffect, useState } from "react";
import { getLockStatus, inApp, saveLockSettings } from "./api";
import { authHint, lockModes, parseMinutes, type LockSettings, type LockStatus } from "./model";

/** Раздел «Блокировка» в настройках: только отображение, без вызовов Rust. */
export function LockSettingsView({
  status,
  busy,
  error,
  onChange,
}: {
  status: LockStatus;
  busy: boolean;
  error: string | null;
  onChange: (s: LockSettings) => void;
}) {
  const s = status.settings;
  const [draft, setDraft] = useState(String(s.minutes));
  useEffect(() => setDraft(String(s.minutes)), [s.minutes]);
  const draftOk = parseMinutes(draft) !== null;
  const canToggle = !busy && (s.enabled || status.auth.available);

  const commitMinutes = () => {
    const m = parseMinutes(draft);
    if (m !== null && m !== s.minutes) onChange({ ...s, minutes: m });
  };

  return (
    <section className="card lock-set" aria-labelledby="lock-set-title">
      <h4 id="lock-set-title">Блокировка</h4>
      <button
        type="button"
        className="sw-row lock-sw"
        role="switch"
        aria-checked={s.enabled}
        disabled={!canToggle}
        onClick={() => onChange({ ...s, enabled: !s.enabled })}
      >
        <span className={"sw" + (s.enabled ? " on" : "")} aria-hidden="true" />
        Блокировать FinCal по Touch ID
      </button>
      <p className="lock-hint">{authHint(status.auth)}</p>

      {s.enabled && (
        <div className="fld lock-when">
          <span className="lbl">Когда спрашивать</span>
          <div className="val">
            <div className="seg" role="group" aria-label="Когда спрашивать">
              {lockModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={m.id === s.mode ? "on" : ""}
                  aria-pressed={m.id === s.mode}
                  disabled={busy}
                  onClick={() => onChange({ ...s, mode: m.id })}
                >
                  {m.title}
                </button>
              ))}
            </div>
            {s.mode === "after" && (
              <label className={"inp lock-min" + (draftOk ? "" : " err")}>
                <input
                  inputMode="numeric"
                  aria-label="Минут"
                  value={draft}
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitMinutes}
                  onKeyDown={(e) => e.key === "Enter" && commitMinutes()}
                />
                <span className="sfx">мин</span>
              </label>
            )}
          </div>
        </div>
      )}
      {s.enabled && s.mode === "after" && !draftOk && (
        <p className="lock-err">Введи целое число минут от 1 до 1440.</p>
      )}
      {error && (
        <p className="lock-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Контейнер: читает и сохраняет настройки через Rust. */
export function LockSettingsPanel() {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inApp()) return;
    getLockStatus()
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  if (!status) return error ? <p className="lock-err">{error}</p> : null;

  const change = (next: LockSettings) => {
    setBusy(true);
    setError(null);
    saveLockSettings(next)
      .then((s) => s && setStatus(s))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return <LockSettingsView status={status} busy={busy} error={error} onChange={change} />;
}
