import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Icon } from "../shell/Icon";
import { screens, type ScreenId } from "../shell/screens";
import { isDefaultOrder, moveItem } from "../shell/menu";
import { themeModes, type ThemeMode } from "../shell/theme";
import { LockSettingsPanel } from "../lock/LockSettingsPanel";
import { releases } from "../releases";

export type SettingsSection = "look" | "security" | "menu" | "about";

export const settingsSections: { id: SettingsSection; title: string; icon: string }[] = [
  { id: "look", title: "Внешний вид", icon: "palette" },
  { id: "security", title: "Безопасность", icon: "shield" },
  { id: "menu", title: "Меню", icon: "menu" },
  { id: "about", title: "О приложении", icon: "info" },
];

function LookSection({ mode, onMode }: { mode: ThemeMode; onMode: (m: ThemeMode) => void }) {
  return (
    <div className="set-rows">
      <div className="set-row">
        <div>
          <div className="set-name">Тема оформления</div>
          <div className="set-hint">«Авто» следует настройке macOS</div>
        </div>
        <div className="seg" role="group" aria-label="Тема оформления">
          {themeModes.map((t) => (
            <button key={t.id} type="button" className={t.id === mode ? "on" : ""} aria-pressed={t.id === mode} onClick={() => onMode(t.id)}>
              {t.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Порядок пунктов сайдбара: перетаскивание за ручку или кнопки «выше/ниже». */
export function MenuSection({ order, onOrder, onReset }: { order: ScreenId[]; onOrder: (o: ScreenId[]) => void; onReset: () => void }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const titleOf = (id: ScreenId) => screens.find((s) => s.id === id);

  return (
    <div className="set-rows">
      <p className="set-hint">Перетащи пункты, чтобы поменять порядок в боковой панели. Сочетания ⌘1…⌘{Math.min(order.length, 9)} идут по позиции в списке.</p>
      <ul className="menu-list" aria-label="Порядок пунктов меню">
        {order.map((id, i) => {
          const s = titleOf(id);
          if (!s) return null;
          return (
            <li
              key={id}
              className={"menu-item" + (dragFrom === i ? " drag" : "") + (over === i && dragFrom !== null && dragFrom !== i ? " over" : "")}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) onOrder(moveItem(order, dragFrom, i));
                setDragFrom(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setOver(null);
              }}
            >
              <span className="menu-grip" aria-hidden="true">
                <Icon name="grip" />
              </span>
              <Icon name={s.icon} />
              <span className="menu-name">{s.title}</span>
              <span className="menu-key mono">{i < 9 ? `⌘${i + 1}` : ""}</span>
              <button type="button" className="btn ghost sm" aria-label={`${s.title}: выше`} title="Выше" disabled={i === 0} onClick={() => onOrder(moveItem(order, i, i - 1))}>
                <Icon name="up" />
              </button>
              <button type="button" className="btn ghost sm" aria-label={`${s.title}: ниже`} title="Ниже" disabled={i === order.length - 1} onClick={() => onOrder(moveItem(order, i, i + 1))}>
                <Icon name="down" />
              </button>
            </li>
          );
        })}
      </ul>
      <div>
        <button type="button" className="btn ghost" disabled={isDefaultOrder(order)} onClick={onReset}>
          Сбросить порядок
        </button>
      </div>
    </div>
  );
}

function AboutSection({ version }: { version: string }) {
  const latest = releases[0];
  return (
    <div className="set-rows">
      <div className="set-row">
        <div className="set-name">Версия</div>
        <span className="mono">{version}</span>
      </div>
      {latest && (
        <div>
          <div className="set-name">Что нового в {latest.version}</div>
          <ul className="set-notes">
            {latest.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Окно настроек поверх экрана: слева разделы, справа содержимое. Применяется сразу, без «Сохранить». */
export function SettingsDialog({
  version,
  mode,
  onMode,
  order,
  onOrder,
  onResetOrder,
  onClose,
  initialSection = "look",
}: {
  version: string;
  mode: ThemeMode;
  onMode: (m: ThemeMode) => void;
  order: ScreenId[];
  onOrder: (o: ScreenId[]) => void;
  onResetOrder: () => void;
  onClose: () => void;
  initialSection?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const current = settingsSections.find((s) => s.id === section) ?? settingsSections[0];

  return (
    <Modal onClose={onClose}>
      <div className="set-win" aria-labelledby="set-title">
        <nav className="set-nav" aria-label="Разделы настроек">
          {settingsSections.map((s) => (
            <button key={s.id} type="button" className={"nav" + (s.id === section ? " on" : "")} aria-current={s.id === section ? "page" : undefined} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} />
              <span className="nm">{s.title}</span>
            </button>
          ))}
        </nav>
        <div className="set-body">
          <div className="set-head">
            <h3 id="set-title">{current.title}</h3>
            <button type="button" className="btn ghost sm" onClick={onClose}>
              Закрыть
            </button>
          </div>
          {section === "look" && <LookSection mode={mode} onMode={onMode} />}
          {section === "security" && <LockSettingsPanel />}
          {section === "menu" && <MenuSection order={order} onOrder={onOrder} onReset={onResetOrder} />}
          {section === "about" && <AboutSection version={version} />}
        </div>
      </div>
    </Modal>
  );
}
