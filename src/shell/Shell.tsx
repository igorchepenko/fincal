import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { defaultScreen, screens, type ScreenDef, type ScreenId } from "./screens";
import { AccountsScreen } from "../accounts/AccountsScreen";
import { ProfileSwitcher } from "../profiles/ProfileSwitcher";
import { useProfiles } from "../profiles/ProfileContext";
import { applyTheme, loadTheme, saveTheme, themeModes, type ThemeMode } from "./theme";

function ThemeSwitch({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="Тема оформления">
      {themeModes.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === mode ? "on" : ""}
          aria-pressed={t.id === mode}
          onClick={() => onChange(t.id)}
        >
          {t.title}
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
}: {
  version: string;
  initialScreen?: ScreenId;
  /** Содержимое готовых разделов; остальные показывают пустое состояние. */
  screenContent?: Partial<Record<ScreenId, ReactNode>>;
}) {
  const [current, setCurrent] = useState<ScreenId>(initialScreen);
  const [mode, setMode] = useState<ThemeMode>(loadTheme);
  const { current: profile } = useProfiles();

  useEffect(() => {
    applyTheme(mode);
    saveTheme(mode);
  }, [mode]);

  const screen = screens.find((s) => s.id === current) ?? screens[0];

  return (
    <div className="shell">
      <aside className="shell-sb">
        <div className="shell-brand">FinCal</div>
        <nav aria-label="Разделы">
          {screens.map((s) => (
            <button
              key={s.id}
              type="button"
              className={"nav" + (s.id === current ? " on" : "")}
              aria-current={s.id === current ? "page" : undefined}
              onClick={() => setCurrent(s.id)}
            >
              <Icon name={s.icon} />
              <span className="nm">{s.title}</span>
            </button>
          ))}
        </nav>
        <div className="shell-foot">
          <ProfileSwitcher />
          <ThemeSwitch mode={mode} onChange={setMode} />
          <span className="shell-ver mono">Версия {version}</span>
        </div>
      </aside>
      {/* key: при смене профиля рабочая область создаётся заново, и экраны перечитывают данные */}
      <main className="shell-main" key={profile?.id ?? "none"}>
        <h1 id="screen-title" className="shell-title">
          {screen.title}
        </h1>
        {screenContent[screen.id] ?? (screen.id === "accounts" ? <AccountsScreen /> : <EmptyScreen screen={screen} />)}
      </main>
    </div>
  );
}
