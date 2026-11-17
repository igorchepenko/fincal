import { Shell } from "./shell/Shell";
import { ProfileProvider } from "./profiles/ProfileContext";
import { currentVersion } from "./releases";

export default function App() {
  return (
    <ProfileProvider>
      <Shell version={currentVersion} />
    </ProfileProvider>
  );
}
