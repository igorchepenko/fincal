import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MAX_PROFILE_NAME, validateProfileName } from "./validate";
import { useProfiles } from "./ProfileContext";
import type { Profile } from "./api";

type Dialog = { kind: "create" } | { kind: "rename"; profile: Profile } | { kind: "delete"; profile: Profile };

function Svg({ d }: { d: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const USER = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0";
const CHEVRON = "M7 9.5l5-5 5 5M7 14.5l5 5 5-5";
const CHECK = "M5 12.5l4.5 4.5L19 7.5";
const PLUS = "M12 5v14M5 12h14";
const PENCIL = "M5 19l1-4L16.5 4.5a2 2 0 0 1 3 3L9 18zM14.5 6.5l3 3";
const TRASH = "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12";

/** Затемнённый фон с карточкой посередине: Esc закрывает, клик по фону тоже. */
function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

function NameDialog({ dialog, onClose }: { dialog: Extract<Dialog, { kind: "create" | "rename" }>; onClose: () => void }) {
  const { profiles, create, rename } = useProfiles();
  const editing = dialog.kind === "rename" ? dialog.profile : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const problem = validateProfileName(name, profiles, editing?.id);
  const shown = serverError ?? (touched ? problem : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problem || busy) return;
    setBusy(true);
    try {
      if (editing) await rename(editing.id, name);
      else await create(name);
      onClose();
    } catch (err) {
      setServerError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="dlg-form" onSubmit={submit}>
        <h3>{editing ? "Переименовать профиль" : "Новый профиль"}</h3>
        <div>
          <label className="flab" htmlFor="profile-name">
            Имя
          </label>
          <input
            id="profile-name"
            className={"inp" + (shown ? " err" : "")}
            value={name}
            autoFocus
            maxLength={MAX_PROFILE_NAME * 2}
            aria-invalid={shown ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setServerError(null);
            }}
          />
          {shown && <div className="fmsg">{shown}</div>}
        </div>
        {!editing && <p className="dlg-note">Данные нового профиля будут пустыми и не связаны с другими профилями.</p>}
        <div className="dlg-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {editing ? "Сохранить" : "Создать"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { remove } = useProfiles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await remove(profile.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="dlg-ic bad">
        <Svg d={TRASH} />
      </div>
      <h3>Удалить профиль «{profile.name}»?</h3>
      <p>Профиль и его данные пропадут из приложения. Если это текущий профиль, откроется другой.</p>
      {error && <div className="fmsg">{error}</div>}
      <div className="dlg-foot">
        <button type="button" className="btn ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={confirm}>
          Удалить
        </button>
      </div>
    </Modal>
  );
}

/** Переключатель профиля внизу сайдбара: имя текущего профиля, по клику меню со списком и действиями. */
export function ProfileSwitcher() {
  const { current, profiles, error, switchTo } = useProfiles();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const act = (d: Dialog) => {
    setOpen(false);
    setDialog(d);
  };

  async function pick(id: number) {
    setOpen(false);
    if (id === current?.id) return;
    try {
      setSwitchError(null);
      await switchTo(id);
    } catch (e) {
      setSwitchError((e as Error).message);
    }
  }

  return (
    <div className="profile" ref={box}>
      {open && current && (
        <div className="menu profile-menu" role="menu" aria-label="Профили">
          <div className="menu-h">Профили</div>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.id === current.id}
              className={"mi" + (p.id === current.id ? " on" : "")}
              onClick={() => pick(p.id)}
            >
              <span className="mt">{p.name}</span>
              {p.id === current.id && (
                <span className="ck">
                  <Svg d={CHECK} />
                </span>
              )}
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="mi" onClick={() => act({ kind: "create" })}>
            <Svg d={PLUS} />
            <span className="mt">Новый профиль…</span>
          </button>
          <button type="button" role="menuitem" className="mi" onClick={() => act({ kind: "rename", profile: current })}>
            <Svg d={PENCIL} />
            <span className="mt">Переименовать…</span>
          </button>
          {profiles.length > 1 && (
            <button type="button" role="menuitem" className="mi bad" onClick={() => act({ kind: "delete", profile: current })}>
              <Svg d={TRASH} />
              <span className="mt">Удалить…</span>
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className="nav profile-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!current}
        onClick={() => setOpen((v) => !v)}
      >
        <Svg d={USER} />
        <span className="nm">{current?.name ?? (error ? "Профиль недоступен" : "Загрузка…")}</span>
        <Svg d={CHEVRON} />
      </button>
      {(error || switchError) && <div className="fmsg">{switchError ?? error}</div>}
      {dialog && (dialog.kind === "delete" ? (
        <DeleteDialog profile={dialog.profile} onClose={() => setDialog(null)} />
      ) : (
        <NameDialog dialog={dialog} onClose={() => setDialog(null)} />
      ))}
    </div>
  );
}
