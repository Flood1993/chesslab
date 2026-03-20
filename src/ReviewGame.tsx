import { useEffect, useRef, useState } from "react";

import { Chessground } from "@lichess-org/chessground";
import { type Config } from "@lichess-org/chessground/config";

import { chessgroundDests } from 'chessops/compat';
import { Chess } from "chessops/chess";
import { parseSquare } from "chessops/util";
import { parseFen, makeFen, INITIAL_FEN } from "chessops/fen";
import { playSound, audioCapture, audioSelfMove } from "./sounds";
import { EvalGauge, type EvalState } from "./EvalGauge";

// Depth used by Lichess for cloud evaluations
const ENGINE_DEPTH = 18;

export function ReviewGamePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chessgroundRef = useRef<any>(null);
  const chessLogicRef = useRef(Chess.fromSetup(parseFen(INITIAL_FEN).unwrap()).unwrap());

  const workerRef = useRef<Worker | null>(null);
  const analyzingForRef = useRef<'white' | 'black'>('white');
  const [evalState, setEvalState] = useState<EvalState>(null);

  function getValidMoves() {
    return chessgroundDests(chessLogicRef.current, { chess960: false });
  }

  function isPromotion(orig: string, dest: string) {
    const piece = chessLogicRef.current.board.get(parseSquare(orig) as any);
    if (!piece || piece.role !== 'pawn') return false;
    const rank = dest[1];
    return (piece.color === 'white' && rank === '8') || (piece.color === 'black' && rank === '1');
  }

  function analyzePosition() {
    const worker = workerRef.current;
    if (!worker) return;
    const fen = makeFen(chessLogicRef.current.toSetup());
    analyzingForRef.current = chessLogicRef.current.turn;
    worker.postMessage('stop');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${ENGINE_DEPTH}`);
  }

  function applyMove(orig: string, dest: string, promotion?: "queen" | "rook" | "bishop" | "knight") {
    const _from = parseSquare(orig);
    if (_from === undefined) return;

    // Chessground sends king's landing square for castling; chessops expects king-captures-rook.
    let chessopsTo = dest;
    const movingPiece = chessLogicRef.current.board.get(_from);
    if (movingPiece?.role === 'king') {
      const fileDiff = dest.charCodeAt(0) - orig.charCodeAt(0);
      if (fileDiff === 2) chessopsTo = 'h' + dest[1];
      else if (fileDiff === -2) chessopsTo = 'a' + dest[1];
    }

    const _to = parseSquare(chessopsTo);
    if (_to === undefined) return;

    const destPiece = chessLogicRef.current.board.get(_to);
    const isCastling = movingPiece?.role === 'king' && destPiece?.color === movingPiece?.color;
    const isCapture = !isCastling && (
      destPiece !== undefined ||
      (movingPiece?.role === 'pawn' && _to === chessLogicRef.current.epSquare)
    );

    chessLogicRef.current.play({ from: _from, to: _to, promotion });
    updateUi();
    playSound(isCapture ? audioCapture : audioSelfMove);
    analyzePosition();
  }

  function handleMove(orig: string, dest: string) {
    if (isPromotion(orig, dest)) {
      const choice = prompt("Promote to (q, r, b, n)?");
      let promotion: "queen" | "rook" | "bishop" | "knight" | undefined;
      switch (choice) {
        case 'q': promotion = "queen"; break;
        case 'r': promotion = "rook"; break;
        case 'b': promotion = "bishop"; break;
        case 'n': promotion = "knight"; break;
        default:
          updateUi();
          return;
      }
      applyMove(orig, dest, promotion);
    } else {
      applyMove(orig, dest);
    }
  }

  function updateUi() {
    const configDelta: Config = {
      check: chessLogicRef.current.isCheck(),
      fen: makeFen(chessLogicRef.current.toSetup()),
      turnColor: chessLogicRef.current.turn,
      movable: {
        color: 'both',
        free: false,
        dests: getValidMoves(),
        events: { after: handleMove },
      },
    };
    chessgroundRef.current.set(configDelta);
  }

  // Initialise chessboard
  useEffect(() => {
    if (!containerRef.current) return;
    chessgroundRef.current = Chessground(containerRef.current, {});
    updateUi();
    return () => chessgroundRef.current?.destroy?.();
  }, []);

  // Initialise stockfish worker
  useEffect(() => {
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

    // Analyse the starting position immediately
    analyzePosition();

    return () => {
      worker.postMessage('quit');
      worker.terminate();
    };
  }, []);

  return (
    <div id="review-board-wrapper">
      <div id="contref" ref={containerRef} />
      <EvalGauge eval={evalState} />
    </div>
  );
}
