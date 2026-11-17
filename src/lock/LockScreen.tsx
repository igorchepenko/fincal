import { unlockLabel } from "./model";

const lockPath = "M7 11V8a5 5 0 0 1 10 0v3M6.5 11h11A1.5 1.5 0 0 1 19 12.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11zM12 15v2";

/** Экран вместо приложения, пока оно заблокировано. Данных здесь нет. */
export function LockScreen({
  touchId,
  busy,
  error,
  onUnlock,
}: {
  touchId: boolean;
  busy: boolean;
  error: string | null;
  onUnlock: () => void;
}) {
  return (
    <div className="lock-screen">
      <section className="card lock-card" aria-labelledby="lock-title">
        <div className="empty">
          <div className="ei">
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d={lockPath} />
            </svg>
          </div>
          <b id="lock-title">FinCal заблокирован</b>
          <p>Подтверди, что это ты, чтобы увидеть данные.</p>
          <div className="ea">
            <button type="button" className={"btn primary" + (busy ? " dis" : "")} disabled={busy} onClick={onUnlock}>
              {busy ? "Ждём подтверждения…" : unlockLabel(touchId)}
            </button>
          </div>
          {error && (
            <p className="lock-err" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
