import { useEffect, useRef } from "react";

import { INITIAL_FEN } from "chessops/fen";

import { UiBoard, type UiBoardHandle, type UiBoardMoveResult } from "./UiBoard";
import { UiBoardMoves, type UiBoardMovesHandle, type MoveNode } from "./UiBoardMoves";

export function ReviewGamePage() {
  const boardRef = useRef<UiBoardHandle>(null);
  const movesRef = useRef<UiBoardMovesHandle>(null);

  useEffect(() => {
    boardRef.current?.setPosition(INITIAL_FEN, { movable: 'both' });
  }, []);

  function handleMove({ san, fen, from, to, promotion }: UiBoardMoveResult) {
    movesRef.current?.addMove({ san, fen, from, to, promotion });
  }

  function handleNavigate(node: MoveNode | null, fen: string) {
    boardRef.current?.setPosition(fen, {
      movable: 'both',
      lastMove: node ? [node.from, node.to] as [string, string] : undefined,
    });
  }

  return (
    <>
      <div /> {/* left spacer */}
      <div id="review-board-wrapper">
        <UiBoard ref={boardRef} onMove={handleMove} showEval />
      </div>
      <div id="review-info" className="side-panel">
        <h3>Moves</h3>
        <UiBoardMoves ref={movesRef} initialFen={INITIAL_FEN} onNavigate={handleNavigate} />
      </div>
    </>
  );
}
