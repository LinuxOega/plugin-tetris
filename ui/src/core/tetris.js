/**
 * Pure, dependency-free Tetris rules engine.
 *
 * This module is the single source of truth for the game rules. It is consumed
 * as an ES module by the Node test suite and compiled into a classic script
 * (window.TetrisCore) by scripts/build-standalone.mjs for the static page.
 *
 * Every function is immutable: it returns a new state and never mutates the
 * argument. A move that is impossible returns the SAME state reference, which
 * callers use as a cheap "no-op" signal. No DOM, no timer, no network here.
 *
 * Board encoding (see boardWithActive):
 *   0        empty
 *   1..7     locked cell (tetromino id)
 *   11..17   active cell (10 + tetromino id)
 *   20       ghost cell
 */

export const COLS = 10;
export const ROWS = 20;

// All matrices are 4x4 so spawn/rotation logic is uniform. O is never rotated.
export const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
export const TYPE_ID = { I: 1, J: 2, L: 3, O: 4, S: 5, T: 6, Z: 7 };

const GRID = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

function shape(rows) {
  return GRID.map((blank, r) => (rows[r] || blank).slice());
}

export const SHAPES = {
  I: shape([[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]]),
  J: shape([[1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
  L: shape([[0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
  O: shape([[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
  S: shape([[0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
  T: shape([[0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
  Z: shape([[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
};

export function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function scoreForLines(count, level) {
  const table = [0, 100, 300, 500, 800];
  return (table[count] || 0) * Math.max(1, level);
}

export function levelForLines(lines) {
  return Math.min(20, Math.floor(Math.max(0, lines) / 10) + 1);
}

/** Gravity interval in milliseconds; faster with each level, floored at 80ms. */
export function dropInterval(level) {
  return Math.max(80, 800 - (Math.max(1, level) - 1) * 60);
}

function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Refill the 7-bag so `queue` always holds the active piece + 3 previews. */
function fillQueue(state) {
  let bag = state.bag.slice();
  const queue = state.queue.slice();
  while (queue.length < 4) {
    if (bag.length === 0) bag = shuffled(TYPES, state.rng);
    queue.push(bag.shift());
  }
  return { bag, queue };
}

function makeActive(type) {
  const matrix = SHAPES[type];
  return { type, matrix, x: Math.floor((COLS - matrix.length) / 2), y: 0 };
}

/**
 * Spawn a piece. Pass `type` to force one (Hold); otherwise consume the queue.
 * A collision at spawn means the stack reached the ceiling: game over.
 */
export function spawn(state, type) {
  if (state.over) return state;
  const filled = fillQueue(state);
  const chosen = type || filled.queue[0];
  const queue = type ? filled.queue : filled.queue.slice(1);
  const active = makeActive(chosen);
  const next = {
    ...state,
    bag: filled.bag,
    queue,
    active,
  };
  if (collides(next.board, active.matrix, active.x, active.y)) {
    return { ...next, active: null, over: true };
  }
  return next;
}

export function createInitialState(rng = Math.random) {
  return spawn({
    board: emptyBoard(),
    active: null,
    hold: null,
    canHold: true,
    bag: [],
    queue: [],
    score: 0,
    lines: 0,
    level: 1,
    pieces: 0,
    over: false,
    rng,
  });
}

/** Cells above the ceiling are ignored (they are simply not drawn). */
export function collides(board, matrix, x, y) {
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (!matrix[r][c]) continue;
      const nx = x + c;
      const ny = y + r;
      if (ny < 0) continue;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (board[ny][nx]) return true;
    }
  }
  return false;
}

/** Move the active piece; returns the same reference when blocked. */
export function shift(state, dx, dy) {
  if (state.over || !state.active) return state;
  const { matrix, x, y } = state.active;
  if (collides(state.board, matrix, x + dx, y + dy)) return state;
  return { ...state, active: { ...state.active, x: x + dx, y: y + dy } };
}

export function rotateMatrix(matrix, direction) {
  const size = matrix.length;
  const out = Array.from({ length: size }, () => Array(size).fill(0));
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (direction >= 0) out[c][size - 1 - r] = matrix[r][c];
      else out[size - 1 - c][r] = matrix[r][c];
    }
  }
  return out;
}

/** Clockwise / counter-clockwise rotation with a small wall-kick table. */
export function rotate(state, direction = 1) {
  if (state.over || !state.active || state.active.type === 'O') return state;
  const matrix = rotateMatrix(state.active.matrix, direction);
  const kicks = [
    [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0],
    [0, -1], [-1, -1], [1, -1], [0, -2],
  ];
  for (const [dx, dy] of kicks) {
    const x = state.active.x + dx;
    const y = state.active.y + dy;
    if (!collides(state.board, matrix, x, y)) {
      return { ...state, active: { ...state.active, matrix, x, y } };
    }
  }
  return state;
}

export function getGhostY(state) {
  if (state.over || !state.active) return 0;
  let y = state.active.y;
  const { matrix, x } = state.active;
  while (!collides(state.board, matrix, x, y + 1)) y += 1;
  return y;
}

/** Merge the active piece, clear full lines, score, then spawn the next one. */
export function lockActive(state, bonus = 0) {
  if (state.over || !state.active) return state;
  const board = cloneBoard(state.board);
  const { matrix, x, y, type } = state.active;
  const id = TYPE_ID[type];
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (!matrix[r][c]) continue;
      const nx = x + c;
      const ny = y + r;
      if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) continue;
      board[ny][nx] = id;
    }
  }
  const kept = board.filter((row) => row.some((value) => value === 0));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array(COLS).fill(0));
  const lines = state.lines + cleared;
  return spawn({
    ...state,
    board: kept,
    score: state.score + bonus + scoreForLines(cleared, state.level),
    lines,
    level: levelForLines(lines),
    pieces: state.pieces + 1,
    canHold: true,
    active: null,
  });
}

/** One gravity step: fall one row, or lock when the floor is reached. */
export function tick(state) {
  const next = shift(state, 0, 1);
  return next !== state ? next : lockActive(state);
}

/** Soft drop scores 1 point per row and locks immediately at the bottom. */
export function softDrop(state) {
  const next = shift(state, 0, 1);
  if (next !== state) return { ...next, score: next.score + 1 };
  return lockActive(state);
}

/** Hard drop scores 2 points per row and locks. */
export function hardDrop(state) {
  if (state.over || !state.active) return state;
  let current = state;
  let distance = 0;
  for (;;) {
    const next = shift(current, 0, 1);
    if (next === current) break;
    current = next;
    distance += 1;
  }
  return lockActive(current, distance * 2);
}

/** Swap with Hold; only one swap is allowed between two locks. */
export function holdPiece(state) {
  if (state.over || !state.active || !state.canHold) return state;
  const current = state.active.type;
  const held = state.hold;
  const base = { ...state, hold: current, canHold: false, active: null };
  return held ? spawn(base, held) : spawn(base);
}

/** Render state: locked 1..7, active 11..17, ghost 20. */
export function boardWithActive(state, withGhost = true) {
  const board = cloneBoard(state.board);
  if (state.over || !state.active) return board;
  const { matrix, x, type } = state.active;
  const id = TYPE_ID[type];
  const paint = (y, value) => {
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix[r].length; c += 1) {
        if (!matrix[r][c]) continue;
        const nx = x + c;
        const ny = y + r;
        if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) board[ny][nx] = value;
      }
    }
  };
  if (withGhost) paint(getGhostY(state), 20);
  paint(state.active.y, 10 + id);
  return board;
}
