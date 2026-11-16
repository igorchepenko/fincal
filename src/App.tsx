import { currentVersion } from "./releases";

export default function App() {
  return (
    <main style={{ fontFamily: "-apple-system, system-ui, sans-serif", padding: 32 }}>
      <h1>FinCal</h1>
      <p>Финансовый календарь. Здесь пока заглушка.</p>
      <p style={{ color: "#888" }}>Версия {currentVersion}</p>
    </main>
  );
}
