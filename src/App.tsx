import { useEffect, useRef, useState } from "react";

import { Chessground } from "@lichess-org/chessground";
import { type Config } from "@lichess-org/chessground/config";

import { chessgroundDests } from 'chessops/compat';
import { Chess } from "chessops/chess";
import { parseSquare, makeSquare } from "chessops/util";
import { parseFen, makeFen, INITIAL_FEN } from "chessops/fen";
import { parsePgn, startingPosition, type Node, type PgnNodeData } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { AboutPage } from "./About";
import { Move } from "./basetypes";

function playSound(audio: HTMLAudioElement) {
  audio.currentTime = 0;
  audio.play();
}

const audioCapture = new Audio(`${import.meta.env.BASE_URL}/sound/Capture.mp3`);
const audioGameEnd = new Audio(`${import.meta.env.BASE_URL}/sound/Victory.mp3`);
const audioGameStart = new Audio(`${import.meta.env.BASE_URL}/sound/GenericNotify.mp3`);
const audioIllegalMove = new Audio(`${import.meta.env.BASE_URL}/sound/Error.mp3`);
const audioSelfMove = new Audio(`${import.meta.env.BASE_URL}/sound/Move.mp3`);

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

class PracticeLine {
  orientation: "white" | "black";
  variation: Move[];

  constructor(orientation: "white" | "black", variation: Move[]) {
    this.orientation = orientation;
    this.variation = variation.map(m => new Move(m.from, m.to, m.promotion));
  }

  toString() {
    return `PracticeLine(${this.orientation}, ${this.variation.length} moves)`;
  }
}

type GameGroup = {
  name: string;
  orientation: "white" | "black";
  variations: Move[][];
};

// ---------------------------------------------------------------------------
// Line key helpers
// ---------------------------------------------------------------------------

function makeLineKey(groupName: string, variation: Move[]): string {
  return groupName + ':' + variation.map(m => m.from + m.to + (m.promotion || '')).join(',');
}

// ---------------------------------------------------------------------------
// PGN parsing helpers (outside component — no hooks, pure functions)
// ---------------------------------------------------------------------------

function inferOrientation(headers: Map<string, string>): "white" | "black" {
  const black = headers.get('Black');
  if (black && black !== '?') return 'black';
  return 'white';
}

function inferName(headers: Map<string, string>): string {
  const chapter = headers.get('ChapterName');
  if (chapter) return chapter;
  return "Unknown";
}

function extractVariations(gameNode: Node<PgnNodeData>, startPos: Chess): Move[][] {
  const result: Move[][] = [];

  function traverse(node: Node<PgnNodeData>, pos: Chess, moves: Move[]) {
    if (node.children.length === 0) {
      if (moves.length > 0) result.push(moves);
      return;
    }
    for (const child of node.children) {
      const chessopsMove = parseSan(pos, child.data.san);
      if (!chessopsMove || !('from' in chessopsMove)) continue;

      let fromSq: number = chessopsMove.from;
      let toSq: number = chessopsMove.to;

      // Translate castling: chessops uses king-to-rook square, convert to king's landing square
      const piece = pos.board.get(fromSq);
      if (piece?.role === 'king') {
        const fromFile = fromSq & 7;
        const toFile = toSq & 7;
        if (Math.abs(fromFile - toFile) > 1) {
          const rank = fromSq >> 3;
          toSq = rank * 8 + (toFile > fromFile ? fromFile + 2 : fromFile - 2);
        }
      }

      const promotion = chessopsMove.promotion as Move['promotion'] | undefined;
      const appMove = new Move(makeSquare(fromSq), makeSquare(toSq), promotion);

      const newPos = pos.clone();
      newPos.play(chessopsMove);
      traverse(child, newPos, [...moves, appMove]);
    }
  }

  traverse(gameNode, startPos, []);
  return result;
}

function parseAllGameGroups(pgnText: string): GameGroup[] {
  const games = parsePgn(pgnText);
  const groups: GameGroup[] = [];

  for (const game of games) {
    const startPosResult = startingPosition(game.headers);
    if (!startPosResult.isOk) continue;

    const variations = extractVariations(game.moves, startPosResult.value as Chess);
    if (variations.length === 0) continue;

    groups.push({
      name: inferName(game.headers),
      orientation: inferOrientation(game.headers),
      variations,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------

type InfoPanelProps = {
  showDebug: boolean;
  onToggleDebug: () => void;
  debugInfo: { currentLine: string; lastMove: string; expectedMove: string };
}

function InfoPanel({ showDebug, onToggleDebug, debugInfo }: InfoPanelProps) {
  return (
    <div className="info">
      <button onClick={onToggleDebug}>
        {showDebug ? "Hide info" : "Show info"}
      </button>
      {showDebug && (
        <div>
          <p>Current line: {debugInfo.currentLine}</p>
          <p>Last attempted move: {debugInfo.lastMove}</p>
          <p>Expected next move: {debugInfo.expectedMove}</p>
        </div>
      )}
    </div>
  )
}

type OptionsPanelProps = {
  hintOnErrors: boolean;
  onToggleHint: () => void;
};

function OptionsPanel({ hintOnErrors, onToggleHint }: OptionsPanelProps) {
  return (
    <div className="side-panel">
      <h3>Options</h3>
      <label>
        <input type="checkbox" checked={hintOnErrors} onChange={onToggleHint} />
        Hint on errors
      </label>
    </div>
  );
}

type GameTogglesProps = {
  gameGroups: GameGroup[];
  enabledGames: Set<string>;
  completedLines: Set<string>;
  onToggle: (name: string) => void;
  onLoadFromLichess: () => void;
  onResetProgress: () => void;
};

function GameToggles({ gameGroups, enabledGames, completedLines, onToggle, onLoadFromLichess, onResetProgress }: GameTogglesProps) {
  return (
    <div id="game-toggles" className="side-panel">
      <h3>Openings</h3>
      {gameGroups.map(g => {
        const solvedCount = g.variations.filter(v => completedLines.has(makeLineKey(g.name, v))).length;
        return (
          <label key={g.name}>
            <input
              type="checkbox"
              checked={enabledGames.has(g.name)}
              onChange={() => onToggle(g.name)}
            />
            {g.name} [{solvedCount}/{g.variations.length}]
          </label>
        );
      })}
      <div className="game-toggles-actions">
        <button className="icon-btn" onClick={onResetProgress} title="Reset progress">
          <img src={`${import.meta.env.BASE_URL}svg/reset.svg`} alt="Reset progress" />
        </button>
        <button className="icon-btn" onClick={onLoadFromLichess} title="Load from Lichess study">
          <img src={`${import.meta.env.BASE_URL}svg/search-internet.svg`} alt="Load from Lichess study" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function OpeningTrainingPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chessgroundRef = useRef<any>(null);

  const initialSetup = parseFen(INITIAL_FEN).unwrap();
  const chessLogicRef = useRef(Chess.fromSetup(initialSetup).unwrap());

  const lineRef = useRef<Move[]>([]);
  const moveNoRef = useRef<number>(0);
  const isPlayerWhiteRef = useRef<boolean>(true);

  const [lastAttemptedMove, setLastAttemptedMove] = useState<Move | undefined>();
  const [expectedNextMove, setExpectedNextMove] = useState<Move | undefined>();
  const expectedNextMoveRef = useRef<Move | undefined>(undefined);

  const [gameGroups, setGameGroups] = useState<GameGroup[]>([]);
  const [enabledGames, setEnabledGames] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [hintOnErrors, setHintOnErrors] = useState(true);
  const hintOnErrorsRef = useRef(true);

  const [completedLines, setCompletedLines] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('openingTrainer_completedLines');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const completedLinesRef = useRef<Set<string>>(completedLines);
  const currentLineKeyRef = useRef<string>('');
  const lineHasErrorRef = useRef<boolean>(false);

  function isCpuTurn(): boolean {
    const curTurn: "black" | "white" = chessLogicRef.current.turn;
    return (isPlayerWhiteRef.current && curTurn === "black") || (!isPlayerWhiteRef.current && curTurn === "white");
  }

  function getValidMoves() {
    return chessgroundDests(chessLogicRef.current, { chess960: false });
  }

  function handleMove(orig: string, dest: string) {
    if (isPromotion(orig, dest)) {
      showPromotionDialog(orig, dest);
      return;
    }
    playMove(new Move(orig, dest));
  }

  function playMove(inputMove: Move) {
    console.log(`Move detected: ${inputMove.toString()}`);
    setLastAttemptedMove(inputMove);
    chessgroundRef.current.setAutoShapes([]);

    const currentExpected = expectedNextMoveRef.current;
    if (!inputMove.equals(currentExpected)) {
      console.log(
        `Played unexpected move ${inputMove.toString()} while ${currentExpected?.toString()} was expected, skipping...`
      );
      console.log("CANCELLING MOVE");
      updateUi({});
      lineHasErrorRef.current = true;
      playSound(audioIllegalMove);
      if (hintOnErrorsRef.current && currentExpected) {
        chessgroundRef.current.set({ highlight: { custom: new Map([[currentExpected.from, 'hint-square']]) } });
      }
      return;
    } else {
      console.log(`Played expected move ${currentExpected?.toString()}.`);
      chessgroundRef.current.set({ highlight: { custom: new Map() } });
    }

    const _from = parseSquare(inputMove.from);
    if (_from === undefined) return;

    // chessground sends king's final square for castling (e.g. g1/c1),
    // but chessops expects king-captures-rook notation (h1/a1).
    let chessopsTo = inputMove.to;
    const movingPiece = chessLogicRef.current.board.get(_from);
    if (movingPiece?.role === 'king') {
      const fileDiff = inputMove.to.charCodeAt(0) - inputMove.from.charCodeAt(0);
      if (fileDiff === 2) chessopsTo = 'h' + inputMove.to[1];
      else if (fileDiff === -2) chessopsTo = 'a' + inputMove.to[1];
    }

    const _to = parseSquare(chessopsTo);
    if (_to === undefined) return;

    const destPiece = chessLogicRef.current.board.get(_to);
    const isCastling = movingPiece?.role === 'king' && destPiece?.color === movingPiece?.color;
    const isCapture = !isCastling && (
      destPiece !== undefined ||
      (movingPiece?.role === 'pawn' && _to === chessLogicRef.current.epSquare)
    );

    chessLogicRef.current.play({ from: _from, to: _to, promotion: inputMove.promotion });
    updateUi({});
    playSound(isCapture ? audioCapture : audioSelfMove);

    // Advance to next move
    moveNoRef.current += 1;
    if (lineRef.current && moveNoRef.current < lineRef.current.length) {
      const nextMove = lineRef.current[moveNoRef.current];
      const nextMoveInstance = new Move(nextMove.from, nextMove.to, nextMove.promotion);
      console.log(`Setting next move to #${moveNoRef.current}: ${nextMoveInstance.toString()}`);
      setExpectedNextMove(nextMoveInstance);
    } else {
      console.log("No more moves in line.");
      setExpectedNextMove(undefined);
      playSound(audioGameEnd);
      const key = currentLineKeyRef.current;
      if (key && !lineHasErrorRef.current && !completedLinesRef.current.has(key)) {
        const next = new Set([...completedLinesRef.current, key]);
        completedLinesRef.current = next;
        setCompletedLines(next);
        try { localStorage.setItem('openingTrainer_completedLines', JSON.stringify([...next])); } catch {}
      }
    }
  }

  function isPromotion(orig: string, dest: string) {
    const piece = chessLogicRef.current.board.get(parseSquare(orig) as any);
    if (!piece || piece.role !== 'pawn') return false;
    const rank = dest[1];
    return (piece.color === 'white' && rank === '8') || (piece.color === 'black' && rank === '1');
  }

  function showPromotionDialog(orig: string, dest: string) {
    const choice = prompt("Promote to (q, r, b, n)?");
    if (!choice) return;

    let result: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king" | undefined;
    switch(choice) {
      case 'q': result = "queen"; break;
      case 'r': result = "rook"; break;
      case 'b': result = "bishop"; break;
      case 'n': result = "knight"; break;
      default:
        console.log("Invalid promotion choice");
        return;
    }

    playMove(new Move(orig, dest, result));
  }

  function updateUi({ reset, orientation }: { reset?: boolean, orientation?: "black" | "white" }) {
    const current_fen = makeFen(chessLogicRef.current.toSetup());
    const configDelta: Config = {
      check: chessLogicRef.current.isCheck(),
      fen: current_fen,
      turnColor: chessLogicRef.current.turn,
      movable: {
        free: false,
        dests: getValidMoves(),
        events: {
          after: handleMove
        }
      }
    };

    if (reset) configDelta.lastMove = undefined;
    if (orientation) configDelta.orientation = orientation;

    chessgroundRef.current.set(configDelta);
  }

  function handleNewLine(practiceLine: PracticeLine) {
    console.log(`= Handling new line: ${practiceLine.toString()} =`);

    isPlayerWhiteRef.current = practiceLine.orientation === "white";
    chessLogicRef.current = Chess.fromSetup(initialSetup).unwrap();

    const moveInstances = practiceLine.variation.map(m => new Move(m.from, m.to, m.promotion));
    lineRef.current = moveInstances;
    moveNoRef.current = 0;

    if (moveInstances.length > 0) {
      setExpectedNextMove(new Move(moveInstances[0].from, moveInstances[0].to, moveInstances[0].promotion));
    }

    updateUi({ reset: true, orientation: practiceLine.orientation });
    chessgroundRef.current.set({ highlight: { custom: new Map() } });

    // Show a hint arrow for the player's first move when playing as white
    if (isPlayerWhiteRef.current && moveInstances.length > 0) {
      chessgroundRef.current.setAutoShapes([
        { orig: moveInstances[0].from, dest: moveInstances[0].to, brush: 'green' }
      ]);
    } else {
      chessgroundRef.current.setAutoShapes([]);
    }

    playSound(audioGameStart);
  }

  function loadRandomLine(groups: GameGroup[]) {
    if (groups.length === 0) {
      console.error('No games enabled');
      return;
    }
    const allVariations = groups.flatMap(g =>
      g.variations.map(v => ({ variation: v, orientation: g.orientation, key: makeLineKey(g.name, v) }))
    );
    const remaining = allVariations.filter(item => !completedLinesRef.current.has(item.key));
    if (remaining.length === 0) {
      console.log('All lines in enabled openings have been completed.');
      return;
    }
    console.log(`Picking at random from ${remaining.length} remaining variations...`);
    const picked = remaining[Math.floor(Math.random() * remaining.length)];
    currentLineKeyRef.current = picked.key;
    lineHasErrorRef.current = false;
    handleNewLine(new PracticeLine(picked.orientation, picked.variation));
  }

  function fetchLine() {
    loadRandomLine(gameGroups.filter(g => enabledGames.has(g.name)));
  }

  function loadFromLichess() {
    const input = prompt("Paste a Lichess study URL (e.g. https://lichess.org/study/9LoiiCWo):");
    if (!input) return;

    const match = input.match(/lichess\.org\/study\/([a-zA-Z0-9]+)/);
    if (!match) {
      alert("Could not find a study ID in that URL.");
      return;
    }
    const studyId = match[1];

    fetch(`https://lichess.org/api/study/${studyId}.pgn`)
      .then(r => {
        if (!r.ok) throw new Error(`Lichess API returned ${r.status}`);
        return r.text();
      })
      .then(pgnText => {
        const groups = parseAllGameGroups(pgnText);
        if (groups.length === 0) {
          alert("No playable lines found in that study.");
          return;
        }
        setGameGroups(groups);
        setEnabledGames(new Set(groups.map(g => g.name)));
      })
      .catch(err => {
        console.error('Error loading Lichess study:', err);
        alert(`Failed to load study: ${err.message}`);
      });
  }

  function resetProgress() {
    const empty = new Set<string>();
    completedLinesRef.current = empty;
    setCompletedLines(empty);
    try { localStorage.removeItem('openingTrainer_completedLines'); } catch {}
  }

  function toggleHintOnErrors() {
    const next = !hintOnErrorsRef.current;
    hintOnErrorsRef.current = next;
    setHintOnErrors(next);
    if (!next) chessgroundRef.current.set({ highlight: { custom: new Map() } });
  }

  function toggleGame(name: string) {
    setEnabledGames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Spacebar → fetch new line
  const fetchLineRef = useRef(fetchLine);
  useEffect(() => { fetchLineRef.current = fetchLine; });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        fetchLineRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Load PGN and parse all game groups on mount
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}chess/guimotron-openings.pgn`, { signal: controller.signal })
      .then(r => r.text())
      .then(pgnText => {
        const groups = parseAllGameGroups(pgnText);
        setGameGroups(groups);
        setEnabledGames(new Set(groups.map(g => g.name)));
        loadRandomLine(groups);
      })
      .catch(err => {
        if (err.name !== 'AbortError') console.error('Error loading PGN:', err);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    expectedNextMoveRef.current = expectedNextMove;

    if (!expectedNextMove || !isCpuTurn()) return;

    // Disable moving pieces during the CPU turn
    chessgroundRef.current.set({ movable: { free: false, dests: new Map() } });

    const timeout = setTimeout(() => {
      if (expectedNextMoveRef.current) {
        playMove(expectedNextMoveRef.current);
      }
    }, 500); // CPU delay

    return () => clearTimeout(timeout);
  }, [expectedNextMove]);

  useEffect(() => {
    if (!containerRef.current) return;
    chessgroundRef.current = Chessground(containerRef.current, {});
    updateUi({});
    return () => chessgroundRef.current?.destroy?.();
  }, []);

  return (
    <>
      <GameToggles
        gameGroups={gameGroups}
        enabledGames={enabledGames}
        completedLines={completedLines}
        onToggle={toggleGame}
        onLoadFromLichess={loadFromLichess}
        onResetProgress={resetProgress}
      />
      <div id="board-column">
        <div
          id="contref"
          ref={containerRef}
        />
        <div id="shortcuts">
          <button className="icon-btn" onClick={() => fetchLineRef.current()} title="Skip current line">
            <img src={`${import.meta.env.BASE_URL}svg/next.svg`} alt="Skip current line" />
          </button>
        </div>
      </div>
      <div id="info">
        <OptionsPanel
          hintOnErrors={hintOnErrors}
          onToggleHint={toggleHintOnErrors}
        />
        <InfoPanel
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug(v => !v)}
          debugInfo={{
            currentLine: lineRef.current.toString(),
            lastMove: lastAttemptedMove?.toString() ?? "",
            expectedMove: expectedNextMove?.toString() ?? "",
          }}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pages & navigation
// ---------------------------------------------------------------------------

type Page = 'about' | 'training';

type NavBarProps = {
  current: Page;
  onNavigate: (page: Page) => void;
};

function NavBar({ current, onNavigate }: NavBarProps) {
  return (
    <nav id="navbar">
      <button
        className={current === 'about' ? 'active' : ''}
        onClick={() => onNavigate('about')}
      >
        About
      </button>
      <button
        className={current === 'training' ? 'active' : ''}
        onClick={() => onNavigate('training')}
      >
        Opening training
      </button>
    </nav>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('training');

  return (
    <div id="app">
      <NavBar current={page} onNavigate={setPage} />
      <main>
        <div id="canvas" className={page === 'training' ? 'training-layout' : ''}>
          {page === 'about' && <AboutPage />}
          {page === 'training' && <OpeningTrainingPage />}
        </div>
      </main>
    </div>
  );
}
