import { useEffect, useRef, useState } from "react";

import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parsePgn, startingPosition, type Node, type PgnNodeData } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeSquare } from "chessops/util";

import { UiBoard, type UiBoardHandle } from "./UiBoard";
import { UiBoardMoves, type UiBoardMovesHandle, type MoveNode } from "./UiBoardMoves";

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
    const threshold = prevCp <= -3 ? BLUNDER_THRESHOLD_LOSING : BLUNDER_THRESHOLD;
    return drop >= threshold;
  } else {
    const rise = delta;
    const threshold = prevCp >= 3 ? BLUNDER_THRESHOLD_LOSING : BLUNDER_THRESHOLD;
    return rise >= threshold;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AllMove = {
  san: string;
  fen: string;   // FEN after this move
  from: string;  // origin square (algebraic)
  to: string;    // visual destination square (algebraic)
};

type BlunderMove = {
  moveIndex: number;  // 0-based index into the game's moves[]
  moveNumber: number; // 1-based full move number
  moveSan: string;
  moveFrom: string;
  moveTo: string;
  fenBefore: string;
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
  startFen: string;
  moves: AllMove[];
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

    // Collect all moves with FEN, from, to
    const allMoves: AllMove[] = [];
    {
      const replayPos = startingPosition(game.headers).unwrap() as Chess;
      let n: Node<PgnNodeData> = game.moves;
      while (n.children.length > 0) {
        const san = n.children[0].data.san;
        const mv = parseSan(replayPos, san);
        if (!mv || !('from' in mv)) break;

        // Convert castling king destination to visual square
        let visualTo = mv.to;
        const movingPiece = replayPos.board.get(mv.from);
        if (movingPiece?.role === 'king') {
          const fromFile = mv.from & 7;
          const toFile = mv.to & 7;
          if (Math.abs(fromFile - toFile) > 1) {
            const rank = mv.from >> 3;
            visualTo = rank * 8 + (toFile > fromFile ? fromFile + 2 : fromFile - 2);
          }
        }

        replayPos.play(mv);
        allMoves.push({
          san,
          fen: makeFen(replayPos.toSetup()),
          from: makeSquare(mv.from),
          to: makeSquare(visualTo),
        });
        n = n.children[0];
      }
    }

    // Compute start FEN
    const startFen = makeFen((startPosResult.unwrap() as Chess).toSetup());

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
        startFen,
        moves: allMoves,
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
  const boardRef = useRef<UiBoardHandle>(null);
  const movesRef = useRef<UiBoardMovesHandle>(null);

  const [games, setGames] = useState<BlunderedGame[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeBlunder, setActiveBlunder] = useState<BlunderMove | null>(null);

  const selected = selectedIndex !== null ? games[selectedIndex] : null;

  // ---------------------------------------------------------------------------
  // Board sync via onNavigate
  // ---------------------------------------------------------------------------

  function handleNavigate(node: MoveNode | null, fen: string, parentFen: string) {
    if (!boardRef.current || !selected) return;
    const orientation = selected.playerIsWhite ? 'white' : 'black';

    if (node === null) {
      // At root: show starting position
      boardRef.current.setPosition(fen, { orientation, movable: 'none' });
      boardRef.current.setShapes([]);
      setActiveBlunder(null);
      return;
    }

    if (node.isBlunder) {
      const blunder = selected.blunders.find(b => b.moveIndex === node.ply);
      // Show the position BEFORE the blunder with a red arrow
      boardRef.current.setPosition(parentFen, { orientation, movable: 'both' });
      boardRef.current.setShapes(
        blunder ? [{ orig: blunder.moveFrom, dest: blunder.moveTo, brush: 'red' }] : []
      );
      setActiveBlunder(blunder ?? null);
    } else {
      boardRef.current.setPosition(fen, {
        orientation,
        movable: 'both',
        lastMove: [node.from, node.to] as [string, string],
      });
      boardRef.current.setShapes([]);
      setActiveBlunder(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Load game into move list when selection changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (selectedIndex === null || games.length === 0) return;
    const g = games[selectedIndex];
    setActiveBlunder(null);

    const blunderIndices = new Set(g.blunders.map(b => b.moveIndex));

    movesRef.current?.loadLine(
      g.moves.map((m, i) => ({
        san: m.san,
        fen: m.fen,
        from: m.from,
        to: m.to,
        isBlunder: blunderIndices.has(i),
      })),
      g.startFen,
      g.blunders[0].moveIndex, // navigate to first blunder
    );
  }, [selectedIndex, games]);

  // ---------------------------------------------------------------------------
  // Fetch and parse games PGN
  // ---------------------------------------------------------------------------

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
        <UiBoard ref={boardRef} />
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
            <UiBoardMoves ref={movesRef} onNavigate={handleNavigate} />
          </>
        ) : (
          <p className="blunder-empty">Select a game from the list.</p>
        )}
      </div>
    </>
  );
}
