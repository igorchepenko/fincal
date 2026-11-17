import { useState } from "react";
import { formatKop } from "../accounts/money";
import { compactKop, niceTicks, smoothPath, type BudgetData } from "./model";

const W = 760;
const LEFT = 62;
const RIGHT = 12;
const LINE_TOP = 10;
const LINE_H = 190;
const GAP = 26;
const BARS_H = 110;
const AXIS_H = 22;
const H = LINE_TOP + LINE_H + GAP + BARS_H + AXIS_H;
const PW = W - LEFT - RIGHT;

/** График бюджета: сверху линия баланса, снизу столбики приходов (вверх) и расходов (вниз). Цвета только из токенов MyDS. */
export function BudgetChart({ data }: { data: BudgetData }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = data.days.length;
  if (!n) return null;

  const balances = data.days.map((d) => d.balanceKop);
  const lo = Math.min(...balances, data.startKop);
  const hi = Math.max(...balances, data.startKop);
  const ticks = niceTicks(lo, hi, 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const yLine = (v: number) => LINE_TOP + LINE_H - ((v - yMin) / (yMax - yMin || 1)) * LINE_H;
  const xDay = (i: number) => LEFT + ((i + 0.5) / n) * PW;

  const pts: Array<[number, number]> = data.days.map((d, i) => [xDay(i), yLine(d.balanceKop)]);
  const path = smoothPath(pts);
  const bottom = LINE_TOP + LINE_H;
  const area = n > 1 ? `${path}L${pts[n - 1][0]} ${bottom}L${pts[0][0]} ${bottom}Z` : "";

  const barsTop = LINE_TOP + LINE_H + GAP;
  const barsMid = barsTop + BARS_H / 2;
  const maxBar = Math.max(1, ...data.buckets.map((b) => Math.max(b.incomeKop, b.expenseKop)));
  const barScale = (BARS_H / 2 - 4) / maxBar;
  const colW = PW / n;

  // Подписи по оси X: не больше ~12, чтобы не слипались.
  const every = Math.max(1, Math.ceil(data.buckets.length / 12));
  const hb = hover !== null ? data.buckets[hover] : null;
  const hx = hb ? xDay((hb.start + hb.end) / 2) : 0;
  const tipRight = hx > LEFT + PW * 0.6;

  return (
    <div className="chart-wrap bud-chart">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`График бюджета: баланс с ${formatKop(data.startKop)} до ${formatKop(data.endKop)}, приходы ${formatKop(data.incomeKop)}, расходы ${formatKop(data.expenseKop)}`}
        onMouseLeave={() => setHover(null)}
      >
        {lo < 0 && <rect className="ch-below" x={LEFT} y={yLine(0)} width={PW} height={Math.max(0, bottom - yLine(0))} />}
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "ch-zero" : "ch-grid"} x1={LEFT} x2={W - RIGHT} y1={yLine(t)} y2={yLine(t)} />
            <text className="ch-axis mono" x={LEFT - 8} y={yLine(t) + 4} textAnchor="end">
              {compactKop(t)}
            </text>
          </g>
        ))}
        {area && <path className="ch-area" d={area} />}
        <path className="ch-actual" d={path} />
        {n === 1 && <circle className="ch-dot" cx={pts[0][0]} cy={pts[0][1]} r={4} />}

        <line className="ch-zero" x1={LEFT} x2={W - RIGHT} y1={barsMid} y2={barsMid} />
        {data.buckets.map((b, i) => {
          const cx = xDay((b.start + b.end) / 2);
          const bw = Math.max(2, Math.min(26, (b.end - b.start + 1) * colW * 0.62));
          const ih = b.incomeKop * barScale;
          const eh = b.expenseKop * barScale;
          return (
            <g key={b.from}>
              {b.incomeKop > 0 && <rect className="ch-bar in" x={cx - bw / 2} y={barsMid - ih} width={bw} height={ih} rx={Math.min(3, bw / 2)} />}
              {b.expenseKop > 0 && <rect className="ch-bar out" x={cx - bw / 2} y={barsMid} width={bw} height={eh} rx={Math.min(3, bw / 2)} />}
              {i % every === 0 && (
                <text className="ch-axis" x={cx} y={H - 6} textAnchor="middle">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {hb && (
          <g pointerEvents="none">
            <line className="ch-today" x1={hx} x2={hx} y1={LINE_TOP} y2={barsTop + BARS_H} />
            <circle className={"ch-dot" + (hb.balanceKop < 0 ? " neg" : "")} cx={xDay(hb.end)} cy={yLine(hb.balanceKop)} r={4} />
          </g>
        )}
        {data.buckets.map((b, i) => {
          const x0 = LEFT + (b.start / n) * PW;
          return <rect key={b.from} data-bucket={i} x={x0} y={LINE_TOP} width={((b.end - b.start + 1) / n) * PW} height={H - LINE_TOP - AXIS_H} fill="transparent" onMouseEnter={() => setHover(i)} />;
        })}
      </svg>
      {hb && (
        <div className="ch-tip bud-tip" style={{ left: `${(hx / W) * 100}%`, top: "30%", ...(tipRight ? { transform: "translate(calc(-100% - 14px),-50%)" } : {}) }} role="status">
          <span className="d">{hb.title}</span>
          <div className="r">
            <span>Баланс на конец</span>
            <b className={"amt" + (hb.balanceKop < 0 ? " out" : "")}>{formatKop(hb.balanceKop)}</b>
          </div>
          <div className="r">
            <span>Приходы</span>
            <b className="amt in">{formatKop(hb.incomeKop)}</b>
          </div>
          <div className="r">
            <span>Расходы</span>
            <b className="amt out">{formatKop(hb.expenseKop)}</b>
          </div>
        </div>
      )}
      <div className="ch-legend">
        <span>
          <i className="lg-line" /> Баланс по счетам «в итоге»
        </span>
        <span>
          <i className="lg-dot in" /> Приходы
        </span>
        <span>
          <i className="lg-dot out" /> Расходы
        </span>
      </div>
    </div>
  );
}
