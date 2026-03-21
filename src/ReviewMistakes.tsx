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
  // If the player is still clearly winning after the move, it's not a blunder
  if (playerIsWhite && currentCp >= 5) return false;
  if (!playerIsWhite && currentCp <= -5) return false;

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
// Types
// ---------------------------------------------------------------------------

type BlunderMove = {
  moveIndex: number;  // 0-based index into the game's moves[] / fens[]
  moveNumber: number; // 1-based full move number
  moveSan: string;
  moveFrom: string;   // algebraic origin square for the arrow
  moveTo: string;     // algebraic destination square for the arrow (visual)
  fenBefore: string;  // position before the blunder was played
  evalBefore: Eval;
  evalAfter: Eval;
};

type BlunderedGame = {
  event: string;
  result: string;
  white: string;
  whiteElo: string;
  black: string;
  blackElo: string;
  date: string;
  playerIsWhite: boolean;
  moves: string[];       // all SAN moves of the game
  fens: string[];        // FEN after each move (index matches moves)
  blunders: BlunderMove[];
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function extractBlunderedGames(pgnText: string): BlunderedGame[] {
  const games = parsePgn(pgnText);
  const result: BlunderedGame[] = [];

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

    const gameResult = game.headers.get('Result') ?? '';
    const whiteElo = game.headers.get('WhiteElo') ?? '';
    const blackElo = game.headers.get('BlackElo') ?? '';
    const date = game.headers.get('Date') ?? '';

    // Collect all SAN moves and FENs (replay from start)
    const allMoves: string[] = [];
    const allFens: string[] = [];
    {
      const replayPos = startingPosition(game.headers).unwrap() as Chess;
      let n: Node<PgnNodeData> = game.moves;
      while (n.children.length > 0) {
        const san = n.children[0].data.san;
        const mv = parseSan(replayPos, san);
        if (!mv) break;
        replayPos.play(mv);
        allMoves.push(san);
        allFens.push(makeFen(replayPos.toSetup()));
        n = n.children[0];
      }
    }

    // Detect blunders
    const blunders: BlunderMove[] = [];
    let pos = startPosResult.value as Chess;
    let prevEval: Eval | null = { cp: 0, display: '0.00' };
    let isWhiteTurn = true;
    let fullMoveNumber = 1;
    let node: Node<PgnNodeData> = game.moves;

    while (node.children.length > 0) {
      const child = node.children[0];
      const commentText = (child.data.comments ?? []).join(' ');
      const currentEval = parseEvalComment(commentText);

      const isGuimotronTurn =
        (playerIsWhite && isWhiteTurn) || (playerIsBlack && !isWhiteTurn);

      if (isGuimotronTurn && prevEval !== null && currentEval !== null) {
        if (checkBlunder(prevEval.cp, currentEval.cp, playerIsWhite)) {
          const chessopsMove = parseSan(pos, child.data.san);
          if (chessopsMove && 'from' in chessopsMove) {
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

            const moveIndex = (fullMoveNumber - 1) * 2 + (isWhiteTurn ? 0 : 1);
            blunders.push({
              moveIndex,
              moveNumber: fullMoveNumber,
              moveSan: child.data.san,
              moveFrom: makeSquare(chessopsMove.from),
              moveTo: makeSquare(visualToSq),
              fenBefore: makeFen(pos.toSetup()),
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

    if (blunders.length > 0) {
      result.push({
        event,
        result: gameResult,
        white,
        whiteElo,
        black,
        blackElo,
        date,
        playerIsWhite,
        moves: allMoves,
        fens: allFens,
        blunders,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewMistakesPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chessgroundRef = useRef<any>(null);
  const moveListRef = useRef<HTMLDivElement | null>(null);

  const [games, setGames] = useState<BlunderedGame[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewMoveIndex, setViewMoveIndex] = useState<number | null>(null);

  const selected = selectedIndex !== null ? games[selectedIndex] : null;

  // Find the BlunderMove for the currently viewed index (if any)
  const activeBlunder = selected && viewMoveIndex !== null
    ? selected.blunders.find(b => b.moveIndex === viewMoveIndex) ?? null
    : null;

  // Sync board whenever selection or viewed move changes
  useEffect(() => {
    if (!chessgroundRef.current || selectedIndex === null || games.length === 0) return;
    const g = games[selectedIndex];

    let fen: string;
    let shapes: { orig: string; dest: string; brush: string }[] = [];

    if (viewMoveIndex === null) {
      // Default: show first blunder
      const first = g.blunders[0];
      fen = first.fenBefore;
      shapes = [{ orig: first.moveFrom, dest: first.moveTo, brush: 'red' }];
    } else {
      const blunder = g.blunders.find(b => b.moveIndex === viewMoveIndex);
      if (blunder) {
        fen = blunder.fenBefore;
        shapes = [{ orig: blunder.moveFrom, dest: blunder.moveTo, brush: 'red' }];
      } else {
        fen = g.fens[viewMoveIndex];
        shapes = [];
      }
    }

    chessgroundRef.current.set({
      fen,
      orientation: g.playerIsWhite ? 'white' : 'black',
      turnColor: undefined,
      movable: { free: true, color: 'both' },
      lastMove: undefined,
      check: false,
    });
    chessgroundRef.current.setAutoShapes(shapes);
  }, [selectedIndex, viewMoveIndex, games]);

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
        const found = extractBlunderedGames(text);
        setGames(found);
        if (found.length > 0) setSelectedIndex(0);
      })
      .catch(err => {
        if (err.name !== 'AbortError') console.error('Error loading games PGN:', err);
      });
    return () => controller.abort();
  }, []);

  // Reset viewed move and scroll to first blunder when selection changes
  useEffect(() => {
    setViewMoveIndex(null);
    if (!moveListRef.current || !selected) return;
    const firstBlunderPairIndex = selected.blunders[0].moveNumber - 1;
    const pairs = moveListRef.current.querySelectorAll('.move-pair');
    pairs[firstBlunderPairIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  const movePairs = selected
    ? Array.from({ length: Math.ceil(selected.moves.length / 2) }, (_, i) => ({
        num: i + 1,
        white: selected.moves[i * 2],
        black: selected.moves[i * 2 + 1],
      }))
    : [];

  const blunderMoveIndices = new Set(selected?.blunders.map(b => b.moveIndex) ?? []);

  const activeMoveIndex = viewMoveIndex !== null
    ? viewMoveIndex
    : (selected ? selected.blunders[0].moveIndex : -1);

  function handleMoveClick(idx: number) {
    setViewMoveIndex(idx);
  }

  return (
    <>
      {/* Left column — game list */}
      <div id="mistakes-list" className="side-panel">
        <h3>Blundered games {games.length > 0 ? `(${games.length})` : ''}</h3>
        <div className="blunder-scroll">
          {games.length === 0 && (
            <p className="blunder-empty">
              No blundered games found.<br />
              Make sure guimotron-games.pgn is in public/chess/.
            </p>
          )}
          {games.map((g, i) => (
            <div
              key={i}
              className={`blunder-item${selectedIndex === i ? ' selected' : ''}`}
              onClick={() => setSelectedIndex(i)}
            >
              <div className="blunder-item-players">
                {g.white} vs {g.black}
                <span className="blunder-count-badge">{g.blunders.length}</span>
              </div>
              <div className="blunder-item-meta">
                {g.date} · {g.result}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Center column — board */}
      <div id="board-column">
        <div id="contref" ref={containerRef} />
      </div>

      {/* Right column — details + move list */}
      <div id="mistakes-details" className="side-panel">
        {selected ? (
          <>
            <h3>Details</h3>
            <div className="blunder-details">
              <div className="blunder-detail-row">
                <span className="blunder-detail-label">Event</span>
                <span>{selected.event}</span>
              </div>
              <div className="blunder-detail-row">
                <span className="blunder-detail-label">Result</span>
                <span className="blunder-result">{selected.result}</span>
              </div>
              <div className="blunder-detail-row">
                <span className="blunder-detail-label">Date</span>
                <span>{selected.date}</span>
              </div>
              <div className="blunder-detail-divider" />
              <div className="blunder-detail-row">
                <span className="blunder-detail-label">White</span>
                <span>{selected.white}{selected.whiteElo ? ` (${selected.whiteElo})` : ''}</span>
              </div>
              <div className="blunder-detail-row">
                <span className="blunder-detail-label">Black</span>
                <span>{selected.black}{selected.blackElo ? ` (${selected.blackElo})` : ''}</span>
              </div>
              {activeBlunder && (
                <>
                  <div className="blunder-detail-divider" />
                  <div className="blunder-detail-row">
                    <span className="blunder-detail-label">Blunder</span>
                    <span>{activeBlunder.moveNumber}. <strong>{activeBlunder.moveSan}</strong></span>
                  </div>
                  <div className="blunder-detail-row">
                    <span className="blunder-detail-label">Eval</span>
                    <span>{activeBlunder.evalBefore.display} → {activeBlunder.evalAfter.display}</span>
                  </div>
                </>
              )}
            </div>
            <h3>Moves</h3>
            <div className="move-list" ref={moveListRef}>
              {movePairs.map(({ num, white, black }) => {
                const whiteIdx = (num - 1) * 2;
                const blackIdx = whiteIdx + 1;
                return (
                  <div key={num} className="move-pair">
                    <span className="move-number">{num}.</span>
                    <span
                      className={`move-san move-clickable${blunderMoveIndices.has(whiteIdx) ? ' move-blunder' : ''}${whiteIdx === activeMoveIndex ? ' move-active' : ''}`}
                      onClick={() => handleMoveClick(whiteIdx)}
                    >{white}</span>
                    <span
                      className={`move-san move-clickable${blunderMoveIndices.has(blackIdx) ? ' move-blunder' : ''}${black !== undefined && blackIdx === activeMoveIndex ? ' move-active' : ''}`}
                      onClick={() => black !== undefined && handleMoveClick(blackIdx)}
                    >{black ?? ''}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="blunder-empty">Select a game from the list.</p>
        )}
      </div>
    </>
  );
}
