export type EvalState =
  | { type: 'cp'; value: number }    // centipawns from white's perspective
  | { type: 'mate'; value: number }  // mate in N, positive = white mates
  | null;

function cpToWhitePercent(cp: number): number {
  // Lichess sigmoid: maps centipawns to a 0–100 win-chance percentage for white
  const winChance = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return ((winChance + 1) / 2) * 100;
}

function evalToWhitePercent(ev: EvalState): number {
  if (ev === null) return 50;
  if (ev.type === 'mate') return ev.value > 0 ? 100 : 0;
  return cpToWhitePercent(ev.value);
}

function evalToString(ev: EvalState): string {
  if (ev === null) return '0.0';
  if (ev.type === 'mate') return `M${Math.abs(ev.value)}`;
  const pawns = ev.value / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}

export function EvalGauge({ eval: ev }: { eval: EvalState }) {
  const whitePercent = evalToWhitePercent(ev);
  const label = evalToString(ev);

  return (
    <div className="eval-gauge">
      <div className="eval-gauge-bar">
        <div className="eval-gauge-black" style={{ height: `${100 - whitePercent}%` }} />
      </div>
      <span className="eval-gauge-score">{label}</span>
    </div>
  );
}
