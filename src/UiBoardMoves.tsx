import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { INITIAL_FEN } from 'chessops/fen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MoveNode = {
  id: string;
  san: string;
  fen: string;
  from: string;
  to: string;
  promotion?: string;
  isBlunder?: boolean;
  ply: number;         // 0-based half-move ply (0 = white's first move)
  children: MoveNode[];
  parent: RootNode | MoveNode;
};

export type RootNode = {
  id: 'root';
  fen: string;
  children: MoveNode[];
};

export type UiBoardMovesHandle = {
  /** Append or reuse a move after the current cursor, then advance cursor. */
  addMove(move: { san: string; fen: string; from: string; to: string; promotion?: string }): void;
  /** Replace the entire tree with a linear sequence. `startAtPly` navigates to that ply. */
  loadLine(
    moves: Array<{ san: string; fen: string; from: string; to: string; promotion?: string; isBlunder?: boolean }>,
    initialFen?: string,
    startAtPly?: number,
  ): void;
  /** Clear the tree and reset to a starting position. */
  reset(initialFen?: string): void;
};

type UiBoardMovesProps = {
  initialFen?: string;
  /**
   * Fired whenever the cursor moves to a new position.
   * @param node   The node now at the cursor, or null if at root.
   * @param fen    FEN of the position AT the cursor (after node's move, or startFen if root).
   * @param parentFen  FEN of the PARENT position (before node's move).
   */
  onNavigate?: (node: MoveNode | null, fen: string, parentFen: string) => void;
};

type ContextMenuState = { node: MoveNode; x: number; y: number };

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

let _nextId = 0;

function makeRoot(fen: string): RootNode {
  return { id: 'root', fen, children: [] };
}

function makeNode(
  san: string, fen: string, from: string, to: string, ply: number,
  parent: RootNode | MoveNode,
  promotion?: string, isBlunder?: boolean,
): MoveNode {
  return { id: `mn${_nextId++}`, san, fen, from, to, ply, children: [], parent, promotion, isBlunder };
}

// ---------------------------------------------------------------------------
// Tree utilities
// ---------------------------------------------------------------------------

function isInSubtree(candidate: RootNode | MoveNode, subtreeRoot: MoveNode): boolean {
  let cur: RootNode | MoveNode = candidate;
  while (cur.id !== 'root') {
    if (cur.id === subtreeRoot.id) return true;
    cur = (cur as MoveNode).parent;
  }
  return false;
}

function isVariation(node: MoveNode): boolean {
  return node.parent.children[0]?.id !== node.id;
}

function mainLineEnd(start: RootNode | MoveNode): RootNode | MoveNode {
  let cur = start;
  while (cur.children.length > 0) cur = cur.children[0];
  return cur;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

type RenderCtx = {
  cursorId: string;
  onClickNode: (node: MoveNode) => void;
  onContextMenu: (node: MoveNode, x: number, y: number) => void;
};

function MoveNum({ ply, ellipsis }: { ply: number; ellipsis?: boolean }) {
  return (
    <span className="move-number">
      {Math.floor(ply / 2) + 1}{ellipsis ? '…' : '.'}
    </span>
  );
}

function MoveSpan({ node, ctx }: { node: MoveNode; ctx: RenderCtx }) {
  const isActive = node.id === ctx.cursorId;
  return (
    <span
      data-node-id={node.id}
      className={[
        'move-san',
        'move-clickable',
        isActive ? 'move-active' : '',
        node.isBlunder ? 'move-blunder' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => ctx.onClickNode(node)}
      onContextMenu={e => { e.preventDefault(); ctx.onContextMenu(node, e.clientX, e.clientY); }}
    >
      {node.san}
    </span>
  );
}

/**
 * Renders `node` itself (with a move number) followed by its subtree.
 * Used to render the first move of a variation.
 */
function renderVariation(node: MoveNode, ctx: RenderCtx): ReactNode[] {
  const isWhite = node.ply % 2 === 0;
  return [
    <MoveNum key={`vn-${node.id}`} ply={node.ply} ellipsis={!isWhite} />,
    ' ',
    <MoveSpan key={node.id} node={node} ctx={ctx} />,
    ' ',
    ...renderLine(node, false, ctx),
  ];
}

/**
 * Renders all children of `parent` along the main line, with inline variations.
 * @param needsNum  Force show a move number on the first move even if it's black's.
 */
function renderLine(parent: RootNode | MoveNode, needsNum: boolean, ctx: RenderCtx): ReactNode[] {
  if (parent.children.length === 0) return [];

  const [main, ...variants] = parent.children;
  const isWhite = main.ply % 2 === 0;
  const elems: ReactNode[] = [];

  if (isWhite || needsNum) {
    elems.push(<MoveNum key={`mn-${main.id}`} ply={main.ply} ellipsis={!isWhite} />);
    elems.push(' ');
  }
  elems.push(<MoveSpan key={main.id} node={main} ctx={ctx} />);
  elems.push(' ');

  for (const alt of variants) {
    elems.push(
      <span key={`var-${alt.id}`} className="variation">
        ( {renderVariation(alt, ctx)} )
      </span>
    );
    elems.push(' ');
  }

  // After showing variations following a WHITE move, the black continuation needs a number.
  elems.push(...renderLine(main, variants.length > 0 && isWhite, ctx));

  return elems;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UiBoardMoves = forwardRef<UiBoardMovesHandle, UiBoardMovesProps>(
  function UiBoardMoves({ initialFen = INITIAL_FEN, onNavigate }, ref) {
    const rootRef = useRef<RootNode>(makeRoot(initialFen));
    const cursorRef = useRef<RootNode | MoveNode>(rootRef.current);
    const [cursorId, setCursorId] = useState<string>('root');
    const [, bumpTree] = useReducer(v => v + 1, 0);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const onNavigateRef = useRef(onNavigate);
    onNavigateRef.current = onNavigate;

    const navigateTo = useCallback((node: RootNode | MoveNode) => {
      cursorRef.current = node;
      const moveNode = node.id !== 'root' ? (node as MoveNode) : null;
      const fen = node.fen;
      const parentFen = moveNode ? moveNode.parent.fen : fen;
      setCursorId(node.id);
      onNavigateRef.current?.(moveNode, fen, parentFen);
    }, []);

    // Scroll active move into view after cursor changes
    useEffect(() => {
      if (cursorId === 'root') return;
      const el = listRef.current?.querySelector(`[data-node-id="${cursorId}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [cursorId]);

    // Close context menu on outside click
    useEffect(() => {
      if (!contextMenu) return;
      const close = () => setContextMenu(null);
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }, [contextMenu]);

    // Arrow key navigation
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        const { key } = e;
        if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();

        const cur = cursorRef.current;
        if (key === 'ArrowLeft') {
          if (cur.id !== 'root') navigateTo((cur as MoveNode).parent);
        } else if (key === 'ArrowRight') {
          if (cur.children.length > 0) navigateTo(cur.children[0]);
        } else if (key === 'ArrowUp') {
          if (cur.id !== 'root') navigateTo(rootRef.current);
        } else if (key === 'ArrowDown') {
          const end = mainLineEnd(cur);
          if (end.id !== cur.id) navigateTo(end as MoveNode);
        }
      }
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [navigateTo]);

    useImperativeHandle(ref, () => ({
      addMove({ san, fen, from, to, promotion }) {
        const cursor = cursorRef.current;
        const existing = cursor.children.find(c => c.san === san);
        if (existing) {
          navigateTo(existing);
          return;
        }
        const ply = cursor.id === 'root' ? 0 : (cursor as MoveNode).ply + 1;
        const node = makeNode(san, fen, from, to, ply, cursor, promotion);
        cursor.children.push(node);
        navigateTo(node);
      },

      loadLine(moves, initFen, startAtPly) {
        const root = makeRoot(initFen ?? rootRef.current.fen);
        let parent: RootNode | MoveNode = root;
        moves.forEach((m, i) => {
          const node = makeNode(m.san, m.fen, m.from, m.to, i, parent, m.promotion, m.isBlunder);
          parent.children.push(node);
          parent = node;
        });
        rootRef.current = root;
        bumpTree();

        if (startAtPly !== undefined && startAtPly >= 0) {
          let target: RootNode | MoveNode = root;
          for (let i = 0; i <= startAtPly && target.children.length > 0; i++) {
            target = target.children[0];
          }
          cursorRef.current = target;
          const moveNode = target.id !== 'root' ? (target as MoveNode) : null;
          const fen = target.fen;
          const parentFen = moveNode ? moveNode.parent.fen : fen;
          setCursorId(target.id);
          onNavigateRef.current?.(moveNode, fen, parentFen);
        } else {
          cursorRef.current = root;
          setCursorId('root');
          onNavigateRef.current?.(null, root.fen, root.fen);
        }
      },

      reset(initFen) {
        const root = makeRoot(initFen ?? rootRef.current.fen);
        rootRef.current = root;
        cursorRef.current = root;
        bumpTree();
        setCursorId('root');
        onNavigateRef.current?.(null, root.fen, root.fen);
      },
    }));

    function handleDelete(node: MoveNode) {
      const parent = node.parent;
      parent.children = parent.children.filter(c => c.id !== node.id);
      const cur = cursorRef.current;
      if (cur.id === node.id || (cur.id !== 'root' && isInSubtree(cur, node))) {
        navigateTo(parent);
      } else {
        bumpTree();
      }
      setContextMenu(null);
    }

    function handlePromote(node: MoveNode) {
      const parent = node.parent;
      parent.children = [node, ...parent.children.filter(c => c.id !== node.id)];
      bumpTree();
      setContextMenu(null);
    }

    const ctx: RenderCtx = {
      cursorId,
      onClickNode: navigateTo,
      onContextMenu: (node, x, y) => setContextMenu({ node, x, y }),
    };

    const content = renderLine(rootRef.current, true, ctx);

    return (
      <div className="move-list" ref={listRef}>
        {content.length === 0
          ? <span className="move-list-empty">No moves yet</span>
          : content
        }
        {contextMenu && (
          <div
            className="move-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            {isVariation(contextMenu.node) ? (
              <>
                <div className="move-context-item" onClick={() => handlePromote(contextMenu.node)}>
                  Promote to main line
                </div>
                <div className="move-context-item" onClick={() => handleDelete(contextMenu.node)}>
                  Delete variation
                </div>
              </>
            ) : (
              <div className="move-context-item move-context-disabled">
                Main line move
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);
