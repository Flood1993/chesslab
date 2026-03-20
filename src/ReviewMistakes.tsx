import { useEffect, useRef, useState } from "react";

import { Chessground } from "@lichess-org/chessground";

import { Chess } from "chessops/chess";
import { parseFen, makeFen, INITIAL_FEN } from "chessops/fen";
import { parsePgn, startingPosition, type Node, type PgnNodeData } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeSquare } from "chessops/util";

const PLAYER_NAME = 'GuimotronEnYt';
const BLUNDER_THRESHOLD = 3.0;
const BLUNDER_THRESHOLD_LOSING = 10.0; // higher bar when already losing by 3+

// ---------------------------------------------------------------------------
// Eval helpers
// ---------------------------------------------------------------------------

type Eval = {
  cp: number;      // numeric value (pawns); ±9999 signals mate
  display: string; // human-readable label
};

function parseEvalComment(text: string): Eval | null {
  const numMatch = text.match(/\[%eval\s+(-?\d+(?:\.\d+)?)\]/);
  if (numMatch) {
    const v = parseFloat(numMatch[1]);
    return { cp: v, display: v.toFixed(2) };
  }
  const mateMatch = text.match(/\[%eval\s+#(-?\d+)\]/);
  if (mateMatch) {
    const n = parseInt(mateMatch[1]);
    return { cp: n > 0 ? 9999 : -9999, display: `#${n}` };
  }
  return null;
}

function checkBlunder(
  prevCp: number,
  currentCp: number,
  playerIsWhite: boolean,
): boolean {
  const delta = currentCp - prevCp; // positive = eval rose (better for white)
  if (playerIsWhite) {
    const drop = -delta;
    // Already badly losing as white: only flag if the drop is very large
    const threshold = prevCp <= -3 ? BLUNDER_THRESHOLD_LOSING : BLUNDER_THRESHOLD;
    return drop >= threshold;
  } else {
    const rise = delta; // positive = bad for black
    // Already badly losing as black (white is far ahead): higher bar
    const threshold = prevCp >= 3 ? BLUNDER_THRESHOLD_LOSING : BLUNDER_THRESHOLD;
    return rise >= threshold;
  }
}

// ---------------------------------------------------------------------------
// Blunder type & parsing
// ---------------------------------------------------------------------------

type Blunder = {
  event: string;
  white: string;
  black: string;
  date: string;
  fenBefore: string;
  moveNumber: number;
  moveSan: string;
  moveFrom: string;   // algebraic origin square for the arrow
  moveTo: string;     // algebraic destination square for the arrow (visual, not chessops internal)
  isWhiteBlunder: boolean;
  evalBefore: Eval;
  evalAfter: Eval;
};

function extractBlunders(pgnText: string): Blunder[] {
  const games = parsePgn(pgnText);
  const blunders: Blunder[] = [];

  for (const game of games) {
    const event = game.headers.get('Event') ?? '';
    if (event.toLowerCase() !== 'rated rapid game') continue;

    const white = game.headers.get('White') ?? '';
    const black = game.headers.get('Black') ?? '';
    const playerIsWhite = white.toLowerCase() === PLAYER_NAME.toLowerCase();
    const playerIsBlack = black.toLowerCase() === PLAYER_NAME.toLowerCase();
    if (!playerIsWhite && !playerIsBlack) continue;

    const startPosResult = startingPosition(game.headers);
    if (!startPosResult.isOk) continue;

    const date = game.headers.get('Date') ?? '';
    let pos = startPosResult.value as Chess;

    let prevEval: Eval | null = { cp: 0, display: '0.00' };

    let isWhiteTurn = true;
    let fullMoveNumber = 1;
    let node: Node<PgnNodeData> = game.moves;

    while (node.children.length > 0) {
      const child = node.children[0]; // mainline only
      const commentText = (child.data.comments ?? []).join(' ');
      const currentEval = parseEvalComment(commentText);

      const isGuimotronTurn =
        (playerIsWhite && isWhiteTurn) || (playerIsBlack && !isWhiteTurn);

      if (isGuimotronTurn && prevEval !== null && currentEval !== null) {
        if (checkBlunder(prevEval.cp, currentEval.cp, playerIsWhite)) {
          const chessopsMove = parseSan(pos, child.data.san);
          if (chessopsMove && 'from' in chessopsMove) {
            // For castling, convert king-captures-rook to king's visual landing square
            let visualToSq = chessopsMove.to;
            const movingPiece = pos.board.get(chessopsMove.from);
            if (movingPiece?.role === 'king') {
              const fromFile = chessopsMove.from & 7;
              const toFile = chessopsMove.to & 7;
              if (Math.abs(fromFile - toFile) > 1) {
                const rank = chessopsMove.from >> 3;
                visualToSq = rank * 8 + (toFile > fromFile ? fromFile + 2 : fromFile - 2);
              }
            }

            blunders.push({
              event,
              white,
              black,
              date,
              fenBefore: makeFen(pos.toSetup()),
              moveNumber: fullMoveNumber,
              moveSan: child.data.san,
              moveFrom: makeSquare(chessopsMove.from),
              moveTo: makeSquare(visualToSq),
              isWhiteBlunder: playerIsWhite,
              evalBefore: prevEval,
              evalAfter: currentEval,
            });
          }
        }
      }

      const chessopsMove = parseSan(pos, child.data.san);
      if (!chessopsMove) break;
      pos.play(chessopsMove);

      if (!isWhiteTurn) fullMoveNumber++;
      isWhiteTurn = !isWhiteTurn;
      prevEval = currentEval;
      node = child;
    }
  }

  return blunders;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewMistakesPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chessgroundRef = useRef<any>(null);

  const [blunders, setBlunders] = useState<Blunder[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selected = selectedIndex !== null ? blunders[selectedIndex] : null;

  // Sync board and shapes whenever selection changes
  useEffect(() => {
    if (!chessgroundRef.current || selectedIndex === null || blunders.length === 0) return;
    const b = blunders[selectedIndex];
    chessgroundRef.current.set({
      fen: b.fenBefore,
      orientation: b.isWhiteBlunder ? 'white' : 'black',
      turnColor: undefined,
      movable: { free: true, color: 'both' },
      lastMove: undefined,
      check: false,
    });
    chessgroundRef.current.setAutoShapes([
      { orig: b.moveFrom, dest: b.moveTo, brush: 'red' },
      { orig: b.moveTo, brush: 'red', label: { text: '??' } },
    ]);
  }, [selectedIndex, blunders]);

  // Init chessground
  useEffect(() => {
    if (!containerRef.current) return;
    chessgroundRef.current = Chessground(containerRef.current, {
      fen: makeFen(Chess.fromSetup(parseFen(INITIAL_FEN).unwrap()).unwrap().toSetup()),
      movable: { free: true, color: 'both' },
    });
    return () => chessgroundRef.current?.destroy?.();
  }, []);

  // Fetch and parse games PGN
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}chess/guimotron-games.pgn`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        const found = extractBlunders(text);
        setBlunders(found);
        if (found.length > 0) setSelectedIndex(0);
      })
      .catch(err => {
        if (err.name !== 'AbortError') console.error('Error loading games PGN:', err);
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      {/* Left column — blunder list */}
      <div id="mistakes-list" className="side-panel">
        <h3>Blunders {blunders.length > 0 ? `(${blunders.length})` : ''}</h3>
        <div className="blunder-scroll">
          {blunders.length === 0 && (
            <p className="blunder-empty">
              No blunders found.<br />
              Make sure guimotron-games.pgn is in public/chess/.
            </p>
          )}
          {blunders.map((b, i) => (
            <div
              key={i}
              className={`blunder-item${selectedIndex === i ? ' selected' : ''}`}
              onClick={() => setSelectedIndex(i)}
            >
              {b.white} vs {b.black} – #{b.moveNumber}. {b.evalBefore.display} → {b.evalAfter.display}
            </div>
          ))}
        </div>
      </div>

      {/* Center column — board */}
      <div id="board-column">
        <div id="contref" ref={containerRef} />
      </div>

      {/* Right column — details */}
      <div id="mistakes-details" className="side-panel">
        {selected ? (
          <>
            <h3>Details</h3>
            <p><strong>{selected.event}</strong></p>
            <p>
              <strong>{selected.white}</strong><br />
              vs<br />
              <strong>{selected.black}</strong>
            </p>
            <p>{selected.date}</p>
            <p>
              Move {selected.moveNumber} ({selected.isWhiteBlunder ? 'White' : 'Black'} blundered)
              <br />
              <strong>{selected.moveSan}</strong>
            </p>
            <p>{selected.evalBefore.display} → {selected.evalAfter.display}</p>
          </>
        ) : (
          <p className="blunder-empty">Select a blunder from the list.</p>
        )}
      </div>
    </>
  );
}
