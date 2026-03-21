import { useEffect, useRef } from "react";

import type { UiBoardHandle } from "./UiBoard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UiBoardMovesProps = {
  boardRef?: React.RefObject<UiBoardHandle | null>;
  moves: string[];
  activeMoveIndex?: number;
  highlightedIndices?: Set<number>;
  onMoveClick?: (moveIndex: number) => void;
  // 'bottom': auto-scroll to end (e.g. live game); 'active': scroll to active move
  autoScrollTo?: 'bottom' | 'active';
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UiBoardMoves({
  moves,
  activeMoveIndex,
  highlightedIndices,
  onMoveClick,
  autoScrollTo = 'bottom',
}: UiBoardMovesProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listRef.current) return;
    if (autoScrollTo === 'bottom') {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    } else if (autoScrollTo === 'active' && activeMoveIndex !== undefined && activeMoveIndex >= 0) {
      const pairIndex = Math.floor(activeMoveIndex / 2);
      const pairs = listRef.current.querySelectorAll('.move-pair');
      pairs[pairIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [moves, activeMoveIndex, autoScrollTo]);

  const movePairs = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => ({
    num: i + 1,
    whiteIdx: i * 2,
    blackIdx: i * 2 + 1,
    white: moves[i * 2],
    black: moves[i * 2 + 1] as string | undefined,
  }));

  return (
    <div className="move-list" ref={listRef}>
      {movePairs.map(({ num, whiteIdx, blackIdx, white, black }) => (
        <div key={num} className="move-pair">
          <span className="move-number">{num}.</span>
          <span
            className={[
              'move-san',
              onMoveClick ? 'move-clickable' : '',
              highlightedIndices?.has(whiteIdx) ? 'move-blunder' : '',
              activeMoveIndex === whiteIdx ? 'move-active' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onMoveClick?.(whiteIdx)}
          >{white}</span>
          <span
            className={[
              'move-san',
              onMoveClick && black !== undefined ? 'move-clickable' : '',
              highlightedIndices?.has(blackIdx) ? 'move-blunder' : '',
              activeMoveIndex === blackIdx && black !== undefined ? 'move-active' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => black !== undefined && onMoveClick?.(blackIdx)}
          >{black ?? ''}</span>
        </div>
      ))}
    </div>
  );
}
