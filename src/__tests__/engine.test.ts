import {
  PRESETS,
  analyzeBoard,
  chordMutable,
  completeWinningBoard,
  countRevealedSafe,
  createBoard,
  didWin,
  getNeighbors,
  makeEmptyBoard,
  makeLossReviewHint,
  revealMutable,
  revealTileLayer,
  scoreMatch,
} from '../game/engine';
import { createStats } from '../storage/stats';

describe('game engine', () => {
  test('createBoard keeps the first click and neighbors mine-free', () => {
    const setup = PRESETS.beginner;
    const first = { row: 4, col: 4 };
    const board = createBoard(setup, first.row, first.col, makeEmptyBoard(setup.rows, setup.cols));

    expect(board[first.row][first.col].isMine).toBe(false);
    expect(getNeighbors(board, first.row, first.col).some((cell) => cell.isMine)).toBe(false);
  });

  test('revealMutable flood-fills empty safe regions', () => {
    const board = makeEmptyBoard(3, 3);
    const result = revealMutable(board, 1, 1);

    expect(result.hitMine).toBe(false);
    expect(result.changed).toBe(9);
    expect(countRevealedSafe(board)).toBe(9);
  });

  test('chordMutable opens safe neighbors when flags satisfy the clue', () => {
    const board = makeEmptyBoard(2, 2);
    board[0][0].isRevealed = true;
    board[0][0].neighborMines = 1;
    board[0][1].isMine = true;
    board[0][1].isFlagged = true;
    board[1][0].neighborMines = 1;
    board[1][1].neighborMines = 1;

    const result = chordMutable(board, 0, 0);

    expect(result.kind).toBe('opened');
    expect(result.hitMine).toBe(false);
    expect(board[1][0].isRevealed).toBe(true);
    expect(board[1][1].isRevealed).toBe(true);
  });

  test('chordMutable reports a mine hit when a satisfied clue has a wrong flag', () => {
    const board = makeEmptyBoard(2, 2);
    board[0][0].isRevealed = true;
    board[0][0].neighborMines = 1;
    board[0][1].isFlagged = true;
    board[1][0].isMine = true;
    board[1][0].neighborMines = 1;
    board[1][1].neighborMines = 1;

    const result = chordMutable(board, 0, 0);

    expect(result.kind).toBe('hit-mine');
    expect(result.hitMine).toBe(true);
    expect(result.exploded).toEqual([{ row: 1, col: 0 }]);
  });

  test('didWin becomes true after completing a winning board', () => {
    const setup = { key: 'custom' as const, label: 'Custom', rows: 2, cols: 2, mines: 1 };
    const board = makeEmptyBoard(2, 2);
    board[0][0].isMine = true;

    completeWinningBoard(board);

    expect(didWin(board, setup)).toBe(true);
  });

  test('scoreMatch rewards winning over comparable losing progress', () => {
    const setup = PRESETS.beginner;
    const base = {
      level: setup.key,
      levelLabel: setup.label,
      time: 40,
      clicks: 12,
      chords: 2,
      hints: 0,
      efficiency: 3,
    };

    expect(scoreMatch({ ...base, won: true }, setup)).toBeGreaterThan(
      scoreMatch({ ...base, won: false }, setup),
    );
  });

  test('analyzeBoard finds safe opens from satisfied clues', () => {
    const board = makeEmptyBoard(2, 2);
    board[0][0].isRevealed = true;
    board[0][0].neighborMines = 1;
    board[0][1].isFlagged = true;
    board[1][1].isRevealed = true;

    const hint = analyzeBoard(board, PRESETS.beginner, 'playing', createStats(), 10, 1, 0);

    expect(hint.action).toBe('open');
    expect(hint.category).toBe('safe');
    expect(hint.targets).toEqual(expect.arrayContaining([{ row: 1, col: 0 }]));
  });

  test('hint review helpers keep tile targets and brief postgame color language', () => {
    const concept = analyzeBoard(
      makeEmptyBoard(3, 3),
      { key: 'custom', label: 'Custom', rows: 3, cols: 3, mines: 3 },
      'ready',
      createStats(),
      0,
      0,
      0,
    );
    const tile = revealTileLayer(concept);
    const loss = makeLossReviewHint({
      beforeHint: null,
      action: 'open',
      target: { row: 1, col: 1 },
      exploded: [{ row: 1, col: 1 }],
    });

    expect(tile.layer).toBe('tile');
    expect(tile.targets.length).toBeGreaterThan(0);
    expect(loss.message).toContain('Yellow');
    expect(loss.message).toContain('unlucky guess');
  });
});
