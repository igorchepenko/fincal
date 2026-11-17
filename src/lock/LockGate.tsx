import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getLockStatus, inApp, onLockChanged, unlock } from "./api";
import { LockScreen } from "./LockScreen";

/**
 * Пускает к приложению только после проверки. Пока статус неизвестен или окно
 * закрыто, дочерние экраны не монтируются, так что данные не запрашиваются и не видны.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const app = inApp();
  const [locked, setLocked] = useState<boolean | null>(app ? null : false);
  const [touchId, setTouchId] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef(false);

  useEffect(() => {
    if (!app) return;
    let stop: (() => void) | undefined;
    let alive = true;
    onLockChanged((l) => {
      if (l) prompted.current = false;
      setLocked(l);
    }).then((u) => (alive ? (stop = u) : u()));
    getLockStatus()
      .then((s) => {
        setTouchId(s.auth.touchId);
        setLocked(s.locked);
      })
      .catch((e) => {
        setError(String(e));
        setLocked(true);
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, [app]);

  const tryUnlock = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    unlock()
      .then((ok) => {
        if (ok) setLocked(false);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, [busy]);

  // Окно Touch ID показываем само один раз за блокировку, когда окно FinCal на экране.
  // После отмены не повторяем, иначе окно будет всплывать снова и снова.
  useEffect(() => {
    if (!locked || prompted.current) return;
    const go = () => {
      if (prompted.current) return;
      prompted.current = true;
      tryUnlock();
    };
    if (document.hasFocus()) {
      go();
      return;
    }
    window.addEventListener("focus", go, { once: true });
    return () => window.removeEventListener("focus", go);
  }, [locked, tryUnlock]);

  if (locked === null) return null;
  if (locked) return <LockScreen touchId={touchId} busy={busy} error={error} onUnlock={tryUnlock} />;
  return <>{children}</>;
}
