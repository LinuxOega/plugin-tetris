import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, ROWS, TYPES, TYPE_ID, SHAPES,
  emptyBoard, createInitialState, collides, shift, rotate, rotateMatrix,
  getGhostY, lockActive, tick, softDrop, hardDrop, holdPiece,
  boardWithActive, scoreForLines, levelForLines, dropInterval,
} from '../src/core/tetris.js';

const rng = () => 0.42;

function withActive(state, type, x, y, matrix = SHAPES[type]) {
  return { ...state, active: { type, matrix, x, y }, over: false };
}

test('initial state is a clean 10x20 board with an active piece and 3 previews', () => {
  const s = createInitialState(rng);
  assert.equal(s.board.length, ROWS);
  assert.ok(s.board.every((row) => row.length === COLS && row.every((v) => v === 0)));
  assert.ok(s.active && TYPES.includes(s.active.type));
  assert.equal(s.queue.length, 3);
  assert.equal(s.score, 0);
  assert.equal(s.lines, 0);
  assert.equal(s.level, 1);
  assert.equal(s.pieces, 0);
  assert.equal(s.over, false);
});

test('7-bag: the first seven pieces contain every type exactly once', () => {
  const s = createInitialState(rng);
  const firstSeven = [s.active.type, ...s.queue, ...s.bag.slice().reverse()];
  assert.equal(firstSeven.length, 7);
  assert.deepEqual([...firstSeven].sort(), [...TYPES].sort());
});

test('the same RNG seed produces the same piece sequence', () => {
  let seed = 1;
  const seeded = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let seed2 = 1;
  const seeded2 = () => ((seed2 = (seed2 * 16807) % 2147483647) / 2147483647);
  const a = createInitialState(seeded);
  const b = createInitialState(seeded2);
  assert.deepEqual([a.active.type, ...a.queue], [b.active.type, ...b.queue]);
});

test('collides detects walls, floor and occupied cells, and ignores cells above the ceiling', () => {
  const board = emptyBoard();
  assert.equal(collides(board, SHAPES.O, -2, 5), true, 'left wall');
  assert.equal(collides(board, SHAPES.O, COLS, 5), true, 'right wall');
  assert.equal(collides(board, SHAPES.O, 3, ROWS - 1), true, 'floor');
  assert.equal(collides(board, SHAPES.O, 3, 5), false, 'open space');
  assert.equal(collides(board, SHAPES.O, 3, -2), false, 'above the ceiling is ignored');
  board[6][4] = 1;
  assert.equal(collides(board, SHAPES.O, 3, 5), true, 'occupied cell');
});

test('shift moves horizontally and returns the same reference when blocked', () => {
  const s = createInitialState(rng);
  const left = shift(s, -1, 0);
  assert.equal(left.active.x, s.active.x - 1);
  assert.equal(s.active.x, 3, 'original state is unchanged');
  const wall = { ...s, active: { ...s.active, x: 0 } };
  assert.equal(shift(wall, -1, 0), wall, 'blocked move returns the same reference');
  const over = { ...s, over: true };
  assert.equal(shift(over, 1, 0), over, 'game over is inert');
});

test('rotateMatrix rotates clockwise and counter-clockwise back to the original', () => {
  const m = SHAPES.T;
  const once = rotateMatrix(m, 1);
  assert.notDeepEqual(once, m);
  assert.deepEqual(rotateMatrix(rotateMatrix(rotateMatrix(rotateMatrix(m, 1), 1), 1), 1), m);
  assert.deepEqual(rotateMatrix(once, -1), m);
});

test('rotation applies a wall kick instead of refusing near the right edge', () => {
  const s = createInitialState(rng);
  const vertical = rotateMatrix(SHAPES.I, 1);
  const nearWall = withActive(s, 'I', 7, 5, vertical);
  assert.equal(collides(nearWall.board, vertical, 7, 5), false);
  const rotated = rotate(nearWall, -1);
  assert.notEqual(rotated, nearWall, 'a kick made the rotation possible');
  assert.ok(rotated.active.x < 7, 'piece was kicked left');
  assert.equal(collides(rotated.board, rotated.active.matrix, rotated.active.x, rotated.active.y), false);
});

test('O pieces never rotate', () => {
  const s = createInitialState(rng);
  const o = withActive(s, 'O', 4, 5);
  assert.equal(rotate(o, 1), o);
  assert.equal(rotate(o, -1), o);
});

test('hard drop locks the piece, scores 2 per row and spawns the next one', () => {
  const s = withActive(createInitialState(rng), 'O', 4, 0);
  const dropped = hardDrop(s);
  const distance = getGhostY(s) - s.active.y;
  assert.equal(dropped.pieces, 1);
  assert.equal(dropped.score, distance * 2);
  assert.equal(dropped.active.y, 0, 'next piece spawned at the top');
  assert.equal(dropped.board[ROWS - 1][5], TYPE_ID.O, 'piece merged into the board');
  assert.equal(s.pieces, 0, 'original state untouched');
});

test('soft drop scores 1 per row and locks at the bottom', () => {
  const s = withActive(createInitialState(rng), 'O', 4, 0);
  const soft = softDrop(s);
  assert.equal(soft.active.y, 1);
  assert.equal(soft.score, 1);
  const bottom = withActive(createInitialState(rng), 'O', 4, ROWS - 2);
  assert.equal(softDrop(bottom).pieces, 1, 'locks when it cannot fall further');
});

test('tick falls one row, then locks when the floor is reached', () => {
  const s = withActive(createInitialState(rng), 'O', 4, 0);
  assert.equal(tick(s).active.y, 1);
  const bottom = withActive(createInitialState(rng), 'O', 4, ROWS - 2);
  assert.equal(tick(bottom).pieces, 1);
});

test('clearing two lines scores 300 * level and empties those rows', () => {
  const board = emptyBoard();
  for (const row of [ROWS - 2, ROWS - 1]) {
    for (let c = 0; c < COLS; c += 1) board[row][c] = c === 5 || c === 6 ? 0 : 1;
  }
  const s = { ...withActive(createInitialState(rng), 'O', 4, ROWS - 2), board, level: 1 };
  const locked = lockActive(s);
  assert.equal(locked.lines, 2);
  assert.equal(locked.score, scoreForLines(2, 1));
  assert.ok(locked.board.every((row) => row.every((v) => v === 0)));
  assert.equal(locked.pieces, 1);
});

test('level rises every 10 cleared lines and gravity speeds up', () => {
  const board = emptyBoard();
  for (let c = 0; c < COLS; c += 1) board[ROWS - 1][c] = c === 5 || c === 6 ? 0 : 1;
  const s = {
    ...withActive(createInitialState(rng), 'O', 4, ROWS - 2),
    board, lines: 9, level: 1,
  };
  const locked = lockActive(s);
  assert.equal(locked.lines, 10);
  assert.equal(locked.level, 2);
  assert.ok(dropInterval(2) < dropInterval(1));
  assert.equal(levelForLines(0), 1);
  assert.equal(levelForLines(25), 3);
  assert.equal(dropInterval(99), 80, 'interval is floored');
});

test('hold swaps once per piece and unlocks again after a lock', () => {
  const s = createInitialState(rng);
  const held = holdPiece(s);
  assert.equal(held.hold, s.active.type);
  assert.equal(held.active.type, s.queue[0]);
  assert.equal(holdPiece(held), held, 'second hold before locking is a no-op');
  const locked = hardDrop(held);
  assert.equal(locked.canHold, true);
  const swapped = holdPiece(locked);
  assert.equal(swapped.active.type, held.hold, 'the stored piece comes back');
});

test('spawning into a full ceiling ends the game', () => {
  const board = emptyBoard();
  board[0][4] = 1;
  board[0][5] = 1;
  board[1][4] = 1;
  board[1][5] = 1;
  const s = { ...withActive(createInitialState(rng), 'O', 4, ROWS - 2), board };
  const over = lockActive(s);
  assert.equal(over.over, true);
  assert.equal(over.active, null);
  assert.equal(tick(over), over, 'all actions are inert after game over');
  assert.equal(hardDrop(over), over);
  assert.equal(holdPiece(over), over);
});

test('boardWithActive paints ghost, active and locked cells with distinct codes', () => {
  const s = withActive(createInitialState(rng), 'T', 3, 4);
  const view = boardWithActive(s);
  const values = new Set(view.flat());
  assert.ok(values.has(20), 'ghost cells present');
  assert.ok([...values].some((v) => v > 10 && v < 20), 'active cells present');
  assert.equal(s.board.flat().every((v) => v === 0), true, 'source board is not mutated');
  assert.equal(boardWithActive(s, false).flat().includes(20), false, 'ghost can be disabled');
});

test('scoring table matches the classic 1/2/3/4 line values', () => {
  assert.equal(scoreForLines(0, 3), 0);
  assert.equal(scoreForLines(1, 1), 100);
  assert.equal(scoreForLines(2, 1), 300);
  assert.equal(scoreForLines(3, 1), 500);
  assert.equal(scoreForLines(4, 2), 1600);
  assert.equal(scoreForLines(99, 1), 0, 'unknown line counts are ignored');
});
