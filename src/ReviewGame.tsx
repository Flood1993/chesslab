import { useEffect, useRef, useState } from "react";

import { INITIAL_FEN } from "chessops/fen";

import { EvalGauge, type EvalState } from "./EvalGauge";
import { UiBoard, type UiBoardHandle, type UiBoardMoveResult } from "./UiBoard";
import { UiBoardMoves } from "./UiBoardMoves";

const ENGINE_DEPTH = 18;

export function ReviewGamePage() {
  const boardRef = useRef<UiBoardHandle>(null);
  const workerRef = useRef<Worker | null>(null);
  const analyzingForRef = useRef<'white' | 'black'>('white');
  const [evalState, setEvalState] = useState<EvalState>(null);
  const [moves, setMoves] = useState<string[]>([]);

  function analyzePosition() {
    const worker = workerRef.current;
    if (!worker || !boardRef.current) return;
    const fen = boardRef.current.getFen();
    analyzingForRef.current = boardRef.current.getTurn();
    worker.postMessage('stop');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${ENGINE_DEPTH}`);
  }

  function handleMove({ san }: UiBoardMoveResult) {
    setMoves(prev => [...prev, san]);
    analyzePosition();
  }

  // Initialise board at starting position with moves for both colors
  useEffect(() => {
    boardRef.current?.setPosition(INITIAL_FEN, { movable: 'both' });
    analyzePosition();
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

    return () => {
      worker.postMessage('quit');
      worker.terminate();
    };
  }, []);

  return (
    <>
      <div /> {/* left spacer — mirrors the right column to keep the board centered */}
      <div id="review-board-wrapper">
        <UiBoard ref={boardRef} onMove={handleMove} />
        <EvalGauge eval={evalState} />
      </div>
      <div id="review-info" className="side-panel">
        <h3>Moves</h3>
        <UiBoardMoves boardRef={boardRef} moves={moves} autoScrollTo="bottom" />
      </div>
    </>
  );
}
