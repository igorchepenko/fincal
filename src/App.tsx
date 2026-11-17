import { currentVersion } from "./releases";

export default function App() {
  return (
    <main className="app">
      <section className="card">
        <h4>FinCal</h4>
        <div className="big">Финансовый календарь</div>
        <p>Здесь пока заглушка.</p>
        <div>
          <span className="chip accent mono">Версия {currentVersion}</span>
        </div>
      </section>
    </main>
  );
}
