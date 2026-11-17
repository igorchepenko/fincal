import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { defaultScreen, screens, type ScreenDef, type ScreenId } from "./screens";
import { AccountsScreen } from "../accounts/AccountsScreen";
import { PaymentsScreen } from "../payments/PaymentsScreen";
import { ProfileSwitcher } from "../profiles/ProfileSwitcher";
import { useProfiles } from "../profiles/ProfileContext";
import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog";
import { tauriSettingsApi, type SettingsApi } from "../settings/api";
import { defaultMenuOrder, hotkeyIndex, isSettingsHotkey, MENU_ORDER_KEY, parseMenuOrder, serializeMenuOrder } from "./menu";
import { applyTheme, loadTheme, saveTheme, themeModes, type ThemeMode } from "./theme";

const themeIcon: Record<ThemeMode, string> = { system: "monitor", light: "sun", dark: "moon" };

function ThemeSwitch({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="Тема оформления">
      {themeModes.map((t) => (
        <button key={t.id} type="button" className={t.id === mode ? "on" : ""} aria-pressed={t.id === mode} aria-label={t.title} title={t.title} onClick={() => onChange(t.id)}>
          <Icon name={themeIcon[t.id]} />
        </button>
      ))}
    </div>
  );
}

function EmptyScreen({ screen }: { screen: ScreenDef }) {
  return (
    <section className="card shell-empty" aria-labelledby="screen-title">
      <div className="empty">
        <div className="ei">
          <Icon name={screen.icon} />
        </div>
        <b>{screen.emptyTitle}</b>
        <p>{screen.emptyText}</p>
      </div>
    </section>
  );
}

export function Shell({
  version,
  initialScreen = defaultScreen,
  screenContent = {},
  settingsApi = tauriSettingsApi,
  initialSettings = null,
  initialOrder = defaultMenuOrder,
}: {
  version: string;
  initialScreen?: ScreenId;
  /** Содержимое готовых разделов; остальные показывают пустое состояние. */
  screenContent?: Partial<Record<ScreenId, ReactNode>>;
  settingsApi?: SettingsApi;
  /** Открыть окно настроек сразу на этом разделе (для тестов). */
  initialSettings?: SettingsSection | null;
  initialOrder?: ScreenId[];
}) {
  const [current, setCurrent] = useState<ScreenId>(initialScreen);
  const [mode, setMode] = useState<ThemeMode>(loadTheme);
  const [order, setOrder] = useState<ScreenId[]>(initialOrder);
  const [settings, setSettings] = useState<SettingsSection | null>(initialSettings);
  const { current: profile } = useProfiles();

  useEffect(() => {
    applyTheme(mode);
    saveTheme(mode);
  }, [mode]);

  // Порядок меню хранится в настройках профиля: при смене профиля читаем заново.
  const profileId = profile?.id;
  useEffect(() => {
    if (profileId === undefined) return;
    let alive = true;
    settingsApi
      .get(MENU_ORDER_KEY)
      .then((raw) => alive && setOrder(parseMenuOrder(raw)))
      .catch(() => alive && setOrder(defaultMenuOrder));
    return () => {
      alive = false;
    };
  }, [profileId, settingsApi]);

  const changeOrder = useCallback(
    (next: ScreenId[]) => {
      setOrder(next);
      settingsApi.set(MENU_ORDER_KEY, serializeMenuOrder(next)).catch(() => {});
    },
    [settingsApi],
  );

  // ⌘, открывает настройки, ⌘1…⌘9 переключают разделы по позиции в меню. e.code не зависит от раскладки.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSettingsHotkey(e)) {
        e.preventDefault();
        setSettings((s) => (s ? null : "look"));
        return;
      }
      const i = hotkeyIndex(e, order.length);
      if (i !== null) {
        e.preventDefault();
        setSettings(null);
        setCurrent(order[i]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [order]);

  const ordered = order.map((id) => screens.find((s) => s.id === id)).filter((s): s is ScreenDef => !!s);
  const screen = screens.find((s) => s.id === current) ?? screens[0];

  return (
    <div className="shell">
      <aside className="shell-sb">
        <div className="shell-brand">FinCal</div>
        <nav aria-label="Разделы">
          {ordered.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={"nav" + (s.id === current ? " on" : "")}
              aria-current={s.id === current ? "page" : undefined}
              title={i < 9 ? `${s.title} ⌘${i + 1}` : s.title}
              onClick={() => setCurrent(s.id)}
            >
              <Icon name={s.icon} />
              <span className="nm">{s.title}</span>
              {i < 9 && <span className="n">⌘{i + 1}</span>}
            </button>
          ))}
        </nav>
        <div className="shell-foot">
          <ProfileSwitcher />
          <div className="shell-bar">
            <ThemeSwitch mode={mode} onChange={setMode} />
            <button type="button" className="btn ghost sm shell-gear" aria-label="Настройки" title="Настройки ⌘," onClick={() => setSettings("look")}>
              <Icon name="gear" />
            </button>
          </div>
        </div>
      </aside>
      {/* key: при смене профиля рабочая область создаётся заново, и экраны перечитывают данные */}
      <main className="shell-main" key={profile?.id ?? "none"}>
        <h1 id="screen-title" className="shell-title">
          {screen.title}
        </h1>
        {screenContent[screen.id] ??
          (screen.id === "accounts" ? <AccountsScreen /> : screen.id === "payments" ? <PaymentsScreen /> : <EmptyScreen screen={screen} />)}
      </main>
      {settings && (
        <SettingsDialog
          version={version}
          mode={mode}
          onMode={setMode}
          order={order}
          onOrder={changeOrder}
          onResetOrder={() => changeOrder(defaultMenuOrder)}
          onClose={() => setSettings(null)}
          initialSection={settings}
        />
      )}
    </div>
  );
}
