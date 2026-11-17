import { Shell } from "./shell/Shell";
import { applyTheme, loadTheme } from "./shell/theme";
import { currentVersion } from "./releases";
import { LockGate } from "./lock/LockGate";
import { LockSettingsPanel } from "./lock/LockSettingsPanel";

// Тема нужна уже на экране блокировки, до того как откроется окно с сайдбаром.
applyTheme(loadTheme());

export default function App() {
  return (
    <LockGate>
      <Shell version={currentVersion} screenContent={{ settings: <LockSettingsPanel /> }} />
    </LockGate>
  );
}
