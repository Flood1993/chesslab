import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Chessground } from "@lichess-org/chessground";
import type { Key } from "@lichess-org/chessground/types";
import type { DrawShape } from "@lichess-org/chessground/draw";

export type UiBoardShape = { orig: string; dest?: string; brush: string };

import { chessgroundDests } from 'chessops/compat';
import { Chess } from "chessops/chess";
import { parseFen, makeFen, INITIAL_FEN } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseSquare } from "chessops/util";
import { playSound, audioCapture, audioSelfMove } from "./sounds";
import { EvalGauge, type EvalState } from "./EvalGauge";

const EVAL_DEPTH = 18;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UiBoardMoveResult = {
  san: string;
  from: string;
  to: string;
  promotion?: 'queen' | 'rook' | 'bishop' | 'knight';
  fen: string;
  turn: 'white' | 'black';
  isCapture: boolean;
};

export type UiBoardSetPositionOpts = {
  orientation?: 'white' | 'black';
  // 'none' = display only; 'white'/'black'/'both' = legal moves for that color; 'free' = any move
  movable?: 'none' | 'white' | 'black' | 'both' | 'free';
  lastMove?: [string, string];
};

export type UiBoardHandle = {
  setPosition(fen: string, opts?: UiBoardSetPositionOpts): void;
  setShapes(shapes: UiBoardShape[]): void;
  setOrientation(color: 'white' | 'black'): void;
  getFen(): string;
  getTurn(): 'white' | 'black';
};

type UiBoardProps = {
  onMove?: (result: UiBoardMoveResult) => void;
  playSounds?: boolean;
  showEval?: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UiBoard = forwardRef<UiBoardHandle, UiBoardProps>(function UiBoard(
  { onMove, playSounds = true, showEval = false },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<ReturnType<typeof Chessground> | null>(null);
  const chessRef = useRef<Chess>(Chess.fromSetup(parseFen(INITIAL_FEN).unwrap()).unwrap());
  const orientationRef = useRef<'white' | 'black'>('white');
  const movableRef = useRef<UiBoardSetPositionOpts['movable']>('none');
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const playSoundsRef = useRef(playSounds);
  playSoundsRef.current = playSounds;

  // Eval state — only used when showEval=true
  const [evalState, setEvalState] = useState<EvalState>(null);
  const workerRef = useRef<Worker | null>(null);
  const analyzingForRef = useRef<'white' | 'black'>('white');

  // ---------------------------------------------------------------------------
  // Eval: Stockfish worker
  // ---------------------------------------------------------------------------

  function analyzePosition() {
    const worker = workerRef.current;
    if (!worker) return;
    const fen = makeFen(chessRef.current.toSetup());
    analyzingForRef.current = chessRef.current.turn;
    worker.postMessage('stop');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${EVAL_DEPTH}`);
  }

  useEffect(() => {
    if (!showEval) return;

    const worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`);
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<string>) => {
      const line = e.data;
      if (!line.startsWith('info') || !line.includes(' score ')) return;

      const depthMatch = line.match(/\bdepth (\d+)/);
      if (!depthMatch || parseInt(depthMatch[1]) < 1) return;

      const mateMatch = line.match(/\bscore mate (-?\d+)/);
      const cpMatch = line.match(/\bscore cp (-?\d+)/);
      const turn = analyzingForRef.current;

      if (mateMatch) {
        const mateVal = parseInt(mateMatch[1]);
        setEvalState({ type: 'mate', value: turn === 'white' ? mateVal : -mateVal });
      } else if (cpMatch) {
        const cp = parseInt(cpMatch[1]);
        setEvalState({ type: 'cp', value: turn === 'white' ? cp : -cp });
      }
    };

    worker.postMessage('uci');
    worker.postMessage('setoption name MultiPV value 1');
    worker.postMessage('isready');
    analyzePosition();

    return () => {
      worker.postMessage('quit');
      worker.terminate();
      workerRef.current = null;
    };
  }, [showEval]);

  // ---------------------------------------------------------------------------
  // Internal move handler (registered as Chessground after-move callback)
  // ---------------------------------------------------------------------------

  function handleMove(orig: string, dest: string) {
    if (movableRef.current === 'free') return; // Chessground handles free moves on its own visually

    const chess = chessRef.current;
    const from = parseSquare(orig);
    if (from === undefined) return;

    const piece = chess.board.get(from);

    // Pawn promotion check
    if (piece?.role === 'pawn') {
      const rank = dest[1];
      if ((piece.color === 'white' && rank === '8') || (piece.color === 'black' && rank === '1')) {
        const choice = prompt('Promote to (q, r, b, n)?');
        let promotion: 'queen' | 'rook' | 'bishop' | 'knight' | undefined;
        switch (choice) {
          case 'q': promotion = 'queen'; break;
          case 'r': promotion = 'rook'; break;
          case 'b': promotion = 'bishop'; break;
          case 'n': promotion = 'knight'; break;
          default: {
            // Reset board to current position, re-enable moves
            cgRef.current?.set({
              fen: makeFen(chess.toSetup()),
              movable: { dests: chessgroundDests(chess), events: { after: handleMove } },
            });
            return;
          }
        }
        applyMove(orig, dest, promotion);
        return;
      }
    }

    applyMove(orig, dest);
  }

  function applyMove(orig: string, dest: string, promotion?: 'queen' | 'rook' | 'bishop' | 'knight') {
    const chess = chessRef.current;
    const from = parseSquare(orig);
    if (from === undefined) return;

    // Chessground sends the king's visual landing square for castling;
    // chessops expects king-captures-rook notation.
    let chessDest = dest;
    const piece = chess.board.get(from);
    if (piece?.role === 'king') {
      const diff = dest.charCodeAt(0) - orig.charCodeAt(0);
      if (diff === 2) chessDest = 'h' + dest[1];
      else if (diff === -2) chessDest = 'a' + dest[1];
    }

    const to = parseSquare(chessDest);
    if (to === undefined) return;

    const destPiece = chess.board.get(to);
    const isCastling = piece?.role === 'king' && destPiece?.color === piece.color;
    const isCapture = !isCastling && (
      destPiece !== undefined ||
      (piece?.role === 'pawn' && to === chess.epSquare)
    );

    const san = makeSan(chess, { from, to, promotion });
    chess.play({ from, to, promotion });
    if (playSoundsRef.current) playSound(isCapture ? audioCapture : audioSelfMove);

    const fen = makeFen(chess.toSetup());
    const turn = chess.turn;

    // Re-enable moves for the next player if movable is 'both', or if it matches the new turn
    const mc = movableRef.current;
    if (mc === 'both' || mc === turn) {
      cgRef.current?.set({
        fen,
        check: chess.isCheck(),
        turnColor: turn,
        movable: {
          color: mc === 'both' ? 'both' : turn,
          free: false,
          dests: chessgroundDests(chess),
          events: { after: handleMove },
        },
      });
    } else {
      cgRef.current?.set({
        fen,
        check: chess.isCheck(),
        turnColor: turn,
        movable: { color: undefined, free: false },
      });
    }

    analyzePosition();
    onMoveRef.current?.({ san, from: orig, to: dest, promotion, fen, turn, isCapture });
  }

  // ---------------------------------------------------------------------------
  // Imperative handle
  // ---------------------------------------------------------------------------

  useImperativeHandle(ref, () => ({
    setPosition(fen, opts = {}) {
      const setupResult = parseFen(fen);
      if (!setupResult.isOk) return;
      const posResult = Chess.fromSetup(setupResult.unwrap());
      if (!posResult.isOk) return;

      chessRef.current = posResult.unwrap();
      const chess = chessRef.current;
      const mc = opts.movable ?? 'none';
      movableRef.current = mc;
      if (opts.orientation) orientationRef.current = opts.orientation;

      let movableConfig: object;
      if (mc === 'none') {
        movableConfig = { color: undefined, free: false, dests: undefined };
      } else if (mc === 'free') {
        movableConfig = { color: 'both', free: true, events: { after: handleMove } };
      } else {
        movableConfig = {
          color: mc,
          free: false,
          dests: chessgroundDests(chess),
          events: { after: handleMove },
        };
      }

      cgRef.current?.set({
        fen,
        orientation: opts.orientation ?? orientationRef.current,
        turnColor: mc !== 'none' ? chess.turn : undefined,
        movable: movableConfig,
        lastMove: opts.lastMove as [Key, Key] | undefined,
        check: mc !== 'none' ? chess.isCheck() : false,
      });
      cgRef.current?.setAutoShapes([]);
      cgRef.current?.set({ highlight: { custom: new Map() } });
    },

    setShapes(shapes) {
      cgRef.current?.setAutoShapes(shapes as DrawShape[]);
    },

    setOrientation(color) {
      orientationRef.current = color;
      cgRef.current?.set({ orientation: color });
    },

    getFen() {
      return makeFen(chessRef.current.toSetup());
    },

    getTurn() {
      return chessRef.current.turn;
    },
  }));

  // ---------------------------------------------------------------------------
  // Chessground init
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current) return;
    cgRef.current = Chessground(containerRef.current, {
      fen: makeFen(chessRef.current.toSetup()),
      orientation: 'white',
      movable: { free: false, color: undefined },
    });
    return () => cgRef.current?.destroy?.();
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const boardDiv = <div id="contref" ref={containerRef} />;

  if (showEval) {
    return (
      <>
        {boardDiv}
        <EvalGauge eval={evalState} />
      </>
    );
  }

  return boardDiv;
});
