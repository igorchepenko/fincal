import { Shell } from "./shell/Shell";
import { currentVersion } from "./releases";

export default function App() {
  return <Shell version={currentVersion} />;
}
