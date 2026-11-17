import { Shell } from "./shell/Shell";
import { ProfileProvider } from "./profiles/ProfileContext";
import { applyTheme, loadTheme } from "./shell/theme";
import { currentVersion } from "./releases";
import { LockGate } from "./lock/LockGate";

// Тема нужна уже на экране блокировки, до того как откроется окно с сайдбаром.
applyTheme(loadTheme());

export default function App() {
  return (
    <LockGate>
      <ProfileProvider>
        <Shell version={currentVersion} />
      </ProfileProvider>
    </LockGate>
  );
}
