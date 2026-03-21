import { useEffect, useRef, useState } from "react";

import { INITIAL_FEN } from "chessops/fen";

import { UiBoard, type UiBoardHandle, type UiBoardMoveResult } from "./UiBoard";
import { UiBoardMoves } from "./UiBoardMoves";

export function ReviewGamePage() {
  const boardRef = useRef<UiBoardHandle>(null);
  const [moves, setMoves] = useState<string[]>([]);

  function handleMove({ san }: UiBoardMoveResult) {
    setMoves(prev => [...prev, san]);
  }

  useEffect(() => {
    boardRef.current?.setPosition(INITIAL_FEN, { movable: 'both' });
  }, []);

  return (
    <>
      <div /> {/* left spacer — mirrors the right column to keep the board centered */}
      <div id="review-board-wrapper">
        <UiBoard ref={boardRef} onMove={handleMove} showEval />
      </div>
      <div id="review-info" className="side-panel">
        <h3>Moves</h3>
        <UiBoardMoves boardRef={boardRef} moves={moves} autoScrollTo="bottom" />
      </div>
    </>
  );
}
