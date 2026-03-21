import { useEffect, useRef, useState } from "react";

import { Chess } from "chessops/chess";
import { parseFen, makeFen, INITIAL_FEN } from "chessops/fen";
import { parsePgn, startingPosition, type Node, type PgnNodeData } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeSquare } from "chessops/util";

import { UiBoard, type UiBoardHandle, type UiBoardMoveResult } from "./UiBoard";

const ENGINE_DEPTH = 18;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GameEntry = {
  white: string;
  whiteElo: string;
  black: string;
  blackElo: string;
  date: string;
  result: string;
  moves: string[];
  fens: string[];     // FEN after each move (index i = position after move i)
  startFen: string;   // FEN before move 0
  sourceFile: string;
};

type Position = {
  moveIndex: number;  // 0-based index into game.moves
  fenBefore: string;
  gameSan: string;
};

type EvalJob = {
  fen: string;
  sideToMove: 'white' | 'black'; // who is to move in that position
  onResult: (cpFromWhite: number | null) => void;
};

type ResultRow = {
  moveNumber: number;
  isWhiteMove: boolean;
  fenBefore: string;
  gameSan: string;
  gameMoveFrom: string;
  gameMoveTo: string;
  gameEvalCp: number | null;
  userSan: string;
  userMoveFrom: string;
  userMoveTo: string;
  userEvalCp: number | null;
};

type Phase = 'idle' | 'color-select' | 'playing' | 'evaluating' | 'results';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseGames(pgnText: string, sourceFile: string): GameEntry[] {
  const games = parsePgn(pgnText);
  const result: GameEntry[] = [];

  for (const game of games) {
    const white = game.headers.get('White') ?? '';
    const black = game.headers.get('Black') ?? '';

    const startPosResult = startingPosition(game.headers);
    if (!startPosResult.isOk) continue;

    const startPos = startPosResult.unwrap() as Chess;
    const startFen = makeFen(startPos.toSetup());
    const allMoves: string[] = [];
    const allFens: string[] = [];

    const replayPos = startPosResult.unwrap() as Chess;
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

    result.push({
      white,
      whiteElo: game.headers.get('WhiteElo') ?? '',
      black,
      blackElo: game.headers.get('BlackElo') ?? '',
      date: game.headers.get('Date') ?? '',
      result: game.headers.get('Result') ?? '',
      moves: allMoves,
      fens: allFens,
      startFen,
      sourceFile,
    });
  }

  return result;
}

function getPositions(game: GameEntry, color: 'white' | 'black'): Position[] {
  const positions: Position[] = [];
  for (let i = 0; i < game.moves.length; i++) {
    const isWhiteMove = i % 2 === 0;
    if ((color === 'white') !== isWhiteMove) continue;
    const fenBefore = i === 0 ? game.startFen : game.fens[i - 1];
    positions.push({ moveIndex: i, fenBefore, gameSan: game.moves[i] });
  }
  return positions;
}

function getMoveSquares(fenBefore: string, san: string): { from: string; to: string } | null {
  const setup = parseFen(fenBefore);
  if (!setup.isOk) return null;
  const posResult = Chess.fromSetup(setup.unwrap());
  if (!posResult.isOk) return null;
  const pos = posResult.unwrap();
  const mv = parseSan(pos, san);
  if (!mv || !('from' in mv)) return null;

  let visualTo = mv.to;
  const piece = pos.board.get(mv.from);
  if (piece?.role === 'king') {
    const fromFile = mv.from & 7;
    const toFile = mv.to & 7;
    if (Math.abs(fromFile - toFile) > 1) {
      const rank = mv.from >> 3;
      visualTo = rank * 8 + (toFile > fromFile ? fromFile + 2 : fromFile - 2);
    }
  }
  return { from: makeSquare(mv.from), to: makeSquare(visualTo) };
}

function getResultFen(fenBefore: string, san: string): { fen: string; sideToMove: 'white' | 'black' } | null {
  const setup = parseFen(fenBefore);
  if (!setup.isOk) return null;
  const posResult = Chess.fromSetup(setup.unwrap());
  if (!posResult.isOk) return null;
  const pos = posResult.unwrap();
  const mv = parseSan(pos, san);
  if (!mv) return null;
  pos.play(mv);
  return { fen: makeFen(pos.toSetup()), sideToMove: pos.turn };
}

function formatEval(cpFromWhite: number | null): string {
  if (cpFromWhite === null) return '?';
  if (cpFromWhite >= 9999) return '+M';
  if (cpFromWhite <= -9999) return '-M';
  const pawns = cpFromWhite / 100;
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PGN_FILES = [
  '2013-anand-carlsen.pgn',
  '2018-carlsen-caruana.pgn',
  'guimotron-road-to-2000.pgn'
];

export function EvalBattlePage() {
  const boardRef = useRef<UiBoardHandle>(null);

  const [games, setGames] = useState<GameEntry[]>([]);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set(PGN_FILES));
  const [selectedGameIdx, setSelectedGameIdx] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentPosIdx, setCurrentPosIdx] = useState(0);
  const [evalProgress, setEvalProgress] = useState(0);
  const [evalTotal, setEvalTotal] = useState(0);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [viewRowIdx, setViewRowIdx] = useState<number | null>(null);

  // Stable refs for use inside move callbacks
  const positionsRef = useRef<Position[]>([]);
  const playerColorRef = useRef<'white' | 'black' | null>(null);
  const currentPosIdxRef = useRef(0);
  const userMovesRef = useRef<string[]>([]);

  // Stockfish
  const workerRef = useRef<Worker | null>(null);
  const evalQueueRef = useRef<EvalJob[]>([]);
  const evalRunningRef = useRef(false);
  const currentJobRef = useRef<EvalJob | null>(null);
  const lastCpRef = useRef<number | null>(null);

  const selectedGame = selectedGameIdx !== null ? games[selectedGameIdx] : null;

  // ---------------------------------------------------------------------------
  // Stockfish worker
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`);
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<string>) => {
      const line = e.data;
      if (line.startsWith('info') && line.includes(' score ')) {
        const mateMatch = line.match(/\bscore mate (-?\d+)/);
        const cpMatch = line.match(/\bscore cp (-?\d+)/);
        if (mateMatch) {
          lastCpRef.current = parseInt(mateMatch[1]) > 0 ? 9999 : -9999;
        } else if (cpMatch) {
          lastCpRef.current = parseInt(cpMatch[1]);
        }
      } else if (line.startsWith('bestmove')) {
        const job = currentJobRef.current;
        currentJobRef.current = null;
        if (job) {
          const rawCp = lastCpRef.current;
          const cpFromWhite = rawCp !== null
            ? (job.sideToMove === 'white' ? rawCp : -rawCp)
            : null;
          job.onResult(cpFromWhite);
        }
        processNextEval();
      }
    };

    worker.postMessage('uci');
    worker.postMessage('setoption name MultiPV value 1');
    worker.postMessage('isready');

    return () => {
      worker.postMessage('quit');
      worker.terminate();
    };
  }, []);

  function processNextEval() {
    if (evalQueueRef.current.length === 0) {
      evalRunningRef.current = false;
      return;
    }
    evalRunningRef.current = true;
    const job = evalQueueRef.current.shift()!;
    currentJobRef.current = job;
    lastCpRef.current = null;
    workerRef.current?.postMessage('stop');
    workerRef.current?.postMessage(`position fen ${job.fen}`);
    workerRef.current?.postMessage(`go depth ${ENGINE_DEPTH}`);
  }

  function enqueueEval(job: EvalJob) {
    evalQueueRef.current.push(job);
    if (!evalRunningRef.current) processNextEval();
  }

  // ---------------------------------------------------------------------------
  // PGN loading
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      PGN_FILES.map(file =>
        fetch(`${import.meta.env.BASE_URL}chess/${file}`, { signal: controller.signal })
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
          .then(text => parseGames(text, file))
          .catch(err => { if (err.name !== 'AbortError') console.error(`Error loading ${file}:`, err); return [] as GameEntry[]; })
      )
    ).then(results => setGames(results.flat()));
    return () => controller.abort();
  }, []);

  // ---------------------------------------------------------------------------
  // Board sync — playing phase
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== 'playing' || !boardRef.current) return;
    const positions = positionsRef.current;
    if (currentPosIdx >= positions.length) return;
    const pos = positions[currentPosIdx];
    const color = playerColorRef.current!;

    boardRef.current.setPosition(pos.fenBefore, {
      orientation: color,
      movable: color,
    });
  }, [phase, currentPosIdx]);

  // ---------------------------------------------------------------------------
  // Board sync — results phase
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== 'results' || viewRowIdx === null || !boardRef.current) return;
    const row = results[viewRowIdx];

    boardRef.current.setPosition(row.fenBefore, {
      orientation: playerColorRef.current ?? 'white',
      movable: 'none',
    });

    const shapes = [];
    if (row.gameMoveFrom && row.gameMoveTo)
      shapes.push({ orig: row.gameMoveFrom, dest: row.gameMoveTo, brush: 'green' });
    if (row.userMoveFrom && row.userMoveTo)
      shapes.push({ orig: row.userMoveFrom, dest: row.userMoveTo, brush: 'blue' });
    boardRef.current.setShapes(shapes);
  }, [phase, viewRowIdx, results]);

  // ---------------------------------------------------------------------------
  // Playing logic
  // ---------------------------------------------------------------------------

  function handleUserMove({ san }: UiBoardMoveResult) {
    const idx = currentPosIdxRef.current;
    const positions = positionsRef.current;
    if (idx >= positions.length) return;

    userMovesRef.current.push(san);
    const nextIdx = idx + 1;
    currentPosIdxRef.current = nextIdx;

    if (nextIdx < positions.length) {
      setCurrentPosIdx(nextIdx);
    } else {
      startEvaluation(positions, [...userMovesRef.current]);
    }
  }

  function startEvaluation(positions: Position[], userMoves: string[]) {
    const n = positions.length;
    setEvalTotal(n * 2);
    setEvalProgress(0);
    setPhase('evaluating');

    // Partial result accumulator — mutated in-place by callbacks
    const rows: Partial<ResultRow>[] = positions.map(pos => ({
      moveNumber: Math.floor(pos.moveIndex / 2) + 1,
      isWhiteMove: pos.moveIndex % 2 === 0,
      fenBefore: pos.fenBefore,
      gameSan: pos.gameSan,
      userSan: pos.gameSan, // placeholder, overwritten below
      gameMoveFrom: '', gameMoveTo: '',
      userMoveFrom: '', userMoveTo: '',
      gameEvalCp: null,
      userEvalCp: null,
    }));
    userMoves.forEach((san, i) => { rows[i].userSan = san; });

    let done = 0;
    function onOneDone() {
      done++;
      setEvalProgress(done);
      if (done === n * 2) {
        const finalRows: ResultRow[] = rows.map(r => {
          const gameSq = getMoveSquares(r.fenBefore!, r.gameSan!);
          const userSq = getMoveSquares(r.fenBefore!, r.userSan!);
          return {
            ...r,
            gameMoveFrom: gameSq?.from ?? '',
            gameMoveTo: gameSq?.to ?? '',
            userMoveFrom: userSq?.from ?? '',
            userMoveTo: userSq?.to ?? '',
          } as ResultRow;
        });
        setResults(finalRows);
        setViewRowIdx(0);
        setPhase('results');
      }
    }

    for (let i = 0; i < n; i++) {
      const pos = positions[i];
      const userSan = userMoves[i];
      const sameMove = userSan === pos.gameSan;

      const gameResF = getResultFen(pos.fenBefore, pos.gameSan);
      if (gameResF) {
        enqueueEval({
          fen: gameResF.fen,
          sideToMove: gameResF.sideToMove,
          onResult: (cp) => {
            rows[i].gameEvalCp = cp;
            onOneDone();
            if (sameMove) {
              rows[i].userEvalCp = cp;
              onOneDone();
            } else {
              const userResF = getResultFen(pos.fenBefore, userSan);
              if (userResF) {
                enqueueEval({
                  fen: userResF.fen,
                  sideToMove: userResF.sideToMove,
                  onResult: (cp2) => { rows[i].userEvalCp = cp2; onOneDone(); },
                });
              } else {
                onOneDone();
              }
            }
          },
        });
      } else {
        onOneDone(); // game
        onOneDone(); // user
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Game / color selection
  // ---------------------------------------------------------------------------

  function handleGameSelect(idx: number) {
    evalQueueRef.current = [];
    evalRunningRef.current = false;
    currentJobRef.current = null;
    workerRef.current?.postMessage('stop');

    setSelectedGameIdx(idx);
    setPhase('color-select');
    setResults([]);
    setViewRowIdx(null);
    userMovesRef.current = [];

    boardRef.current?.setPosition(INITIAL_FEN, { movable: 'none' });
  }

  function handleColorSelect(color: 'white' | 'black') {
    if (!selectedGame) return;
    const positions = getPositions(selectedGame, color);
    if (positions.length === 0) return;

    positionsRef.current = positions;
    playerColorRef.current = color;
    currentPosIdxRef.current = 0;
    userMovesRef.current = [];

    setCurrentPosIdx(0);
    setPhase('playing');
  }

  // ---------------------------------------------------------------------------
  // Right panel content
  // ---------------------------------------------------------------------------

  function renderRightPanel() {
    if (phase === 'idle') {
      return <p className="blunder-empty">Select a game from the list.</p>;
    }

    if (phase === 'color-select' && selectedGame) {
      return (
        <>
          <h3>Choose your color</h3>
          <p className="eval-battle-hint">
            {selectedGame.white} vs {selectedGame.black}
          </p>
          <div className="color-select-buttons">
            <button className="color-btn color-btn-white" onClick={() => handleColorSelect('white')}>
              White
            </button>
            <button className="color-btn color-btn-black" onClick={() => handleColorSelect('black')}>
              Black
            </button>
          </div>
        </>
      );
    }

    if (phase === 'playing') {
      const positions = positionsRef.current;
      const total = positions.length;
      const pos = positions[currentPosIdx];
      const moveNum = pos ? Math.floor(pos.moveIndex / 2) + 1 : 0;
      return (
        <>
          <button
            className="eval-end-btn"
            disabled={currentPosIdx === 0}
            onClick={() => startEvaluation(
              positionsRef.current.slice(0, currentPosIdxRef.current),
              [...userMovesRef.current],
            )}
          >
            End and see results
          </button>
          <h3>Your move</h3>
          <p className="eval-battle-hint">Playing as {playerColorRef.current}</p>
          <p className="eval-progress">{currentPosIdx + 1} / {total} — Move {moveNum}</p>
          <p className="eval-battle-hint" style={{ fontSize: '0.78rem', color: '#666' }}>
            Make your move on the board.
          </p>
        </>
      );
    }

    if (phase === 'evaluating') {
      const pct = evalTotal > 0 ? (evalProgress / evalTotal) * 100 : 0;
      return (
        <>
          <h3>Evaluating…</h3>
          <p className="eval-progress">{evalProgress} / {evalTotal}</p>
          <div className="eval-progress-bar-track">
            <div className="eval-progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      );
    }

    if (phase === 'results') {
      return (
        <>
          <h3>Results</h3>
          <div className="eval-results">
            <table className="eval-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="eval-game-san">Game</th>
                  <th className="eval-cell">Eval</th>
                  <th className="eval-user-san">You</th>
                  <th className="eval-cell">Eval</th>
                  <th className="eval-cell">Δ</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row, i) => {
                  const sameMove = row.userSan === row.gameSan;
                  const rawDelta = !sameMove && row.userEvalCp !== null && row.gameEvalCp !== null
                    ? row.userEvalCp - row.gameEvalCp
                    : null;
                  const delta = rawDelta !== null
                    ? rawDelta * (playerColorRef.current === 'black' ? -1 : 1)
                    : null;
                  return (
                    <tr
                      key={i}
                      className={i === viewRowIdx ? 'active' : ''}
                      onClick={() => setViewRowIdx(i)}
                    >
                      <td className="eval-move-num">
                        {row.moveNumber}{row.isWhiteMove ? '.' : '…'}
                      </td>
                      <td className="eval-game-san">{row.gameSan}</td>
                      <td className="eval-cell">{formatEval(row.gameEvalCp)}</td>
                      <td className="eval-user-san">{row.userSan}</td>
                      <td className="eval-cell">{formatEval(row.userEvalCp)}</td>
                      <td className="eval-cell">{sameMove ? '=' : formatEval(delta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Left column — game list */}
      <div id="eval-battle-list" className="side-panel">
        <h3>Games {games.length > 0 ? `(${games.length})` : ''}</h3>
        <div className="blunder-scroll">
          {games.length === 0 && (
            <p className="blunder-empty">
              No games found.<br />
              Make sure PGN files are in public/chess/.
            </p>
          )}
          {PGN_FILES.map(file => {
            const fileGames = games.map((g, i) => ({ g, i })).filter(({ g }) => g.sourceFile === file);
            if (fileGames.length === 0) return null;
            const collapsed = collapsedFiles.has(file);
            return (
              <div key={file} className="pgn-file-group">
                <div
                  className="pgn-file-header"
                  onClick={() => setCollapsedFiles(prev => {
                    const next = new Set(prev);
                    if (next.has(file)) next.delete(file); else next.add(file);
                    return next;
                  })}
                >
                  <span className="pgn-file-chevron">{collapsed ? '▶' : '▼'}</span>
                  {file} ({fileGames.length})
                </div>
                {!collapsed && fileGames.map(({ g, i }) => (
                  <div
                    key={i}
                    className={`blunder-item${selectedGameIdx === i ? ' selected' : ''}`}
                    onClick={() => handleGameSelect(i)}
                  >
                    <div className="blunder-item-players">
                      {g.white} vs {g.black}
                    </div>
                    <div className="blunder-item-meta">
                      {g.date} · {g.result === '1-0' ? '⚪' : g.result === '0-1' ? '⚫' : '↔️'} · ({Math.floor((g.moves.length + 1) / 2)} moves)
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Center column — board */}
      <div id="board-column">
        <UiBoard ref={boardRef} onMove={handleUserMove} />
      </div>

      {/* Right column — panel */}
      <div id="eval-battle-panel" className="side-panel">
        {renderRightPanel()}
      </div>
    </>
  );
}
