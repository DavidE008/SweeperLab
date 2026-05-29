import type { Board, Cell, Coordinate, GameStatus, Hint, HintAction, HintCategory, HintGoal, HintLayer, InvalidChordAttempt, LevelKey, LossReviewInput, MatchSummary, MoveAction, Setup, StoredStats } from './types';

const MIN_ROWS = 6;
const MAX_ROWS = 24;
const MIN_COLS = 6;
const MAX_COLS = 30;
const MIN_MINES = 3;
const MAX_MINE_RATIO = 0.35;

const PRESETS: Record<Exclude<LevelKey, 'custom'>, Setup> = {
  beginner: { key: 'beginner', label: 'Beginner', rows: 9, cols: 9, mines: 10 },
  intermediate: {
    key: 'intermediate',
    label: 'Intermediate',
    rows: 16,
    cols: 16,
    mines: 40,
  },
  expert: { key: 'expert', label: 'Expert', rows: 16, cols: 30, mines: 99 },
};

const IDLE_HINT: Hint = {
  category: 'idle',
  layer: 'concept',
  targets: [],
  supports: [],
  action: 'none',
  goal: 'reasoning',
  title: 'Coach',
  message: 'Press Scan or Hint when you want the coach to mark a move.',
  tileMessage: 'No move is selected yet.',
  confidence: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function maxMines(rows: number, cols: number) {
  return Math.max(MIN_MINES, Math.floor(rows * cols * MAX_MINE_RATIO));
}

function safeCells(setup: Setup) {
  return setup.rows * setup.cols - setup.mines;
}

function makeEmptyBoard(rows: number, cols: number): Board {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({
      row,
      col,
      isMine: false,
      isRevealed: false,
      isFlagged: false,
      neighborMines: 0,
    })),
  );
}

function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

function keyOf(row: number, col: number) {
  return `${row}:${col}`;
}

function getNeighbors(board: Board, row: number, col: number): Cell[] {
  const cells: Cell[] = [];
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) {
        continue;
      }
      const nextRow = row + rowOffset;
      const nextCol = col + colOffset;
      if (
        nextRow >= 0 &&
        nextRow < board.length &&
        nextCol >= 0 &&
        nextCol < board[0].length
      ) {
        cells.push(board[nextRow][nextCol]);
      }
    }
  }
  return cells;
}

function createBoard(setup: Setup, firstRow: number, firstCol: number, previousBoard: Board) {
  const board = makeEmptyBoard(setup.rows, setup.cols);
  const safeZone = new Set<string>();
  safeZone.add(keyOf(firstRow, firstCol));
  getNeighbors(board, firstRow, firstCol).forEach((cell) => safeZone.add(keyOf(cell.row, cell.col)));

  let candidates: Coordinate[] = [];
  for (let row = 0; row < setup.rows; row += 1) {
    for (let col = 0; col < setup.cols; col += 1) {
      if (!safeZone.has(keyOf(row, col))) {
        candidates.push({ row, col });
      }
    }
  }

  if (candidates.length < setup.mines) {
    candidates = [];
    for (let row = 0; row < setup.rows; row += 1) {
      for (let col = 0; col < setup.cols; col += 1) {
        if (row !== firstRow || col !== firstCol) {
          candidates.push({ row, col });
        }
      }
    }
  }

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }

  candidates.slice(0, setup.mines).forEach(({ row, col }) => {
    board[row][col].isMine = true;
  });

  for (let row = 0; row < setup.rows; row += 1) {
    for (let col = 0; col < setup.cols; col += 1) {
      board[row][col].neighborMines = getNeighbors(board, row, col).filter((cell) => cell.isMine).length;
      board[row][col].isFlagged = previousBoard[row]?.[col]?.isFlagged ?? false;
    }
  }

  return board;
}

function revealMutable(board: Board, row: number, col: number) {
  const start = board[row]?.[col];
  if (!start || start.isRevealed || start.isFlagged) {
    return { hitMine: false, changed: 0 };
  }

  if (start.isMine) {
    start.isRevealed = true;
    start.isExploded = true;
    return { hitMine: true, changed: 1 };
  }

  let changed = 0;
  const queue: Coordinate[] = [{ row, col }];
  const queued = new Set<string>([keyOf(row, col)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const cell = board[current.row][current.col];
    if (cell.isRevealed || cell.isFlagged || cell.isMine) {
      continue;
    }
    cell.isRevealed = true;
    changed += 1;

    if (cell.neighborMines === 0) {
      getNeighbors(board, cell.row, cell.col).forEach((neighbor) => {
        const neighborKey = keyOf(neighbor.row, neighbor.col);
        if (!queued.has(neighborKey) && !neighbor.isFlagged && !neighbor.isRevealed) {
          queued.add(neighborKey);
          queue.push({ row: neighbor.row, col: neighbor.col });
        }
      });
    }
  }

  return { hitMine: false, changed };
}

function revealAllMines(board: Board) {
  board.forEach((row) => {
    row.forEach((cell) => {
      if (cell.isMine) {
        cell.isRevealed = true;
      }
      if (cell.isFlagged && !cell.isMine) {
        cell.isWrongFlag = true;
      }
    });
  });
}

function chordMutable(board: Board, row: number, col: number) {
  const cell = board[row]?.[col];
  if (!cell || !cell.isRevealed || cell.neighborMines === 0) {
    return {
      kind: 'ignored',
      hitMine: false,
      changed: 0,
      flags: 0,
      needed: cell?.neighborMines ?? 0,
      exploded: [] as Coordinate[],
    };
  }

  const neighbors = getNeighbors(board, row, col);
  const flagCount = neighbors.filter((neighbor) => neighbor.isFlagged).length;
  if (flagCount < cell.neighborMines) {
    return {
      kind: 'missing-flags',
      hitMine: false,
      changed: 0,
      flags: flagCount,
      needed: cell.neighborMines,
      exploded: [] as Coordinate[],
    };
  }
  if (flagCount > cell.neighborMines) {
    return {
      kind: 'over-flagged',
      hitMine: true,
      changed: 0,
      flags: flagCount,
      needed: cell.neighborMines,
      exploded: [] as Coordinate[],
    };
  }

  let hitMine = false;
  let changed = 0;
  const exploded: Coordinate[] = [];
  neighbors
    .filter((neighbor) => !neighbor.isFlagged && !neighbor.isRevealed)
    .forEach((neighbor) => {
      const result = revealMutable(board, neighbor.row, neighbor.col);
      changed += result.changed;
      if (result.hitMine) {
        hitMine = true;
        exploded.push({ row: neighbor.row, col: neighbor.col });
      }
    });

  return {
    kind: hitMine ? 'hit-mine' : 'opened',
    hitMine,
    changed,
    flags: flagCount,
    needed: cell.neighborMines,
    exploded,
  };
}

function completeWinningBoard(board: Board) {
  board.forEach((row) => {
    row.forEach((cell) => {
      if (cell.isMine) {
        cell.isFlagged = true;
      } else {
        cell.isRevealed = true;
      }
    });
  });
}

function countFlags(board: Board) {
  return board.flat().filter((cell) => cell.isFlagged).length;
}

function countRevealedSafe(board: Board) {
  return board.flat().filter((cell) => cell.isRevealed && !cell.isMine).length;
}

function countHidden(board: Board) {
  return board.flat().filter((cell) => !cell.isRevealed && !cell.isFlagged).length;
}

function didWin(board: Board, setup: Setup) {
  return countRevealedSafe(board) >= safeCells(setup);
}

function coordinateKey(coordinate: Coordinate) {
  return keyOf(coordinate.row, coordinate.col);
}

function coordinateLabel(coordinate: Coordinate) {
  return `row ${coordinate.row + 1}, column ${coordinate.col + 1}`;
}

function uniqueCoordinates(coordinates: Coordinate[]) {
  const seen = new Set<string>();
  return coordinates.filter((coordinate) => {
    const key = coordinateKey(coordinate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hiddenNeighbors(board: Board, cell: Cell) {
  return getNeighbors(board, cell.row, cell.col).filter((neighbor) => !neighbor.isRevealed && !neighbor.isFlagged);
}

function flagCountAround(board: Board, cell: Cell) {
  return getNeighbors(board, cell.row, cell.col).filter((neighbor) => neighbor.isFlagged).length;
}

function makeHint({
  category,
  layer = 'concept',
  targets = [],
  supports = [],
  action,
  goal,
  title,
  message,
  tileMessage,
  confidence,
  risk,
}: {
  category: HintCategory;
  layer?: HintLayer;
  targets?: Coordinate[];
  supports?: Coordinate[];
  action: HintAction;
  goal: HintGoal;
  title: string;
  message: string;
  tileMessage?: string;
  confidence: number;
  risk?: number;
}): Hint {
  return {
    category,
    layer,
    targets: uniqueCoordinates(targets),
    supports: uniqueCoordinates(supports),
    action,
    goal,
    title,
    message,
    tileMessage: tileMessage ?? message,
    confidence,
    risk,
  };
}

function revealTileLayer(hint: Hint): Hint {
  if (hint.targets.length === 0) {
    return hint;
  }
  return {
    ...hint,
    layer: 'tile',
    message: hint.tileMessage,
  };
}

function hasCoordinate(coordinates: Coordinate[], target: Coordinate) {
  return coordinates.some((coordinate) => coordinate.row === target.row && coordinate.col === target.col);
}

function coordinateListLabel(coordinates: Coordinate[], limit = 3) {
  const visible = coordinates.slice(0, limit).map(coordinateLabel).join(', ');
  const remaining = coordinates.length - limit;
  return remaining > 0 ? `${visible}, and ${remaining} more` : visible;
}

function makeInvalidChordHint(attempt: InvalidChordAttempt): Hint {
  return makeHint({
    category: 'chord',
    supports: [{ row: attempt.row, col: attempt.col }],
    action: 'none',
    goal: 'reasoning',
    title: 'Chord Needs Flags',
    message: `That clue needs ${attempt.needed} surrounding flag(s), but it currently has ${attempt.flags}. Nothing changed because the chord was not ready.`,
    tileMessage: `Review ${coordinateLabel(attempt)}. Add or remove flags until the count matches ${attempt.needed}, then chord again.`,
    confidence: 100,
  });
}

function makeLossReviewHint({
  beforeHint,
  action,
  target,
  exploded = [],
  wrongFlags = [],
  missingMines = [],
  chordValue,
  chordFlags,
}: LossReviewInput): Hint {
  const targets = exploded.length > 0 ? exploded : [target];
  const supports = uniqueCoordinates([...wrongFlags, ...missingMines, ...(beforeHint?.supports ?? [])]);

  if (action === 'chord' && chordValue !== undefined && chordFlags !== undefined && chordFlags > chordValue) {
    return makeHint({
      category: 'postgame',
      layer: 'tile',
      targets: [target],
      supports,
      action: 'none',
      goal: 'reasoning',
      title: 'Too Many Flags',
      message: `Yellow marks the chorded clue. It needed ${chordValue} flags but had ${chordFlags}, so the chord was unsafe.`,
      tileMessage: `Yellow marks the chorded clue. Re-check its surrounding flags before chording.`,
      confidence: 100,
    });
  }

  if (action === 'chord' && wrongFlags.length > 0) {
    return makeHint({
      category: 'postgame',
      layer: 'tile',
      targets,
      supports,
      action: 'none',
      goal: 'reasoning',
      title: 'Bad Flag Chord',
      message: 'Yellow shows what the chord opened. Blue marks the flag/mine mismatch. The count matched, but a flag was on the wrong cell.',
      tileMessage: 'Yellow shows what opened; blue marks the flag set to re-check.',
      confidence: 100,
    });
  }

  if (!beforeHint || beforeHint.category === 'guess' || beforeHint.category === 'idle' || beforeHint.category === 'postgame') {
    const bestGuess = beforeHint?.targets[0];
    const matchedCoachGuess = Boolean(bestGuess && hasCoordinate(beforeHint?.targets ?? [], target));
    const riskText = beforeHint?.risk === undefined ? '' : ` Risk was about ${beforeHint.risk}%.`;
    const guessText =
      matchedCoachGuess || !bestGuess
        ? 'No forced safe move was visible first. This was an unlucky guess.'
        : 'No forced move was visible, but blue marks the lower-risk guess Coach preferred.';
    return makeHint({
      category: 'postgame',
      layer: 'tile',
      targets,
      supports: matchedCoachGuess || !bestGuess ? supports : uniqueCoordinates([bestGuess, ...supports]),
      action: 'none',
      goal: 'completion',
      title: matchedCoachGuess || !bestGuess ? 'Unlucky Guess' : 'Guess Review',
      message: `Yellow marks the final mine. ${guessText}${riskText}`,
      tileMessage: `Yellow marks the final mine. ${guessText}${riskText}`,
      confidence: matchedCoachGuess ? 100 : beforeHint?.confidence ?? 70,
      risk: beforeHint?.risk,
    });
  }

  return makeHint({
    category: 'postgame',
    layer: 'tile',
    targets,
    supports: uniqueCoordinates([...supports, ...beforeHint.targets]),
    action: 'none',
    goal: 'reasoning',
    title: 'Missed Proven Move',
    message: `Yellow marks the final mine. Blue marks the proven move or pattern that was available first.`,
    tileMessage: `Yellow marks the final mine. Blue marks the safer board evidence.`,
    confidence: 100,
  });
}

function reviewMove(hint: Hint, action: MoveAction, target: Coordinate) {
  const actionNames: Record<MoveAction, string> = {
    open: 'open',
    flag: 'flag',
    chord: 'chord',
  };

  if (hint.category === 'guess' || hint.category === 'idle' || hint.category === 'postgame') {
    const riskText = hint.risk === undefined ? '' : ` Estimated risk was ${hint.risk}%.`;
    return `That ${actionNames[action]} was a guess position. The coach did not see a forced safe move or useful flag before it.${riskText}`;
  }

  if (hint.action === action && hasCoordinate(hint.targets, target)) {
    return `Good read. That ${actionNames[action]} matched the proven ${hint.title.toLowerCase()} the coach would have suggested.`;
  }

  if (hint.action !== 'none' && hint.targets.length > 0) {
    return `Before that ${actionNames[action]}, there was a proven ${hint.title.toLowerCase()}: ${hint.tileMessage}`;
  }

  return `That ${actionNames[action]} happened while the coach saw a pattern to study, but not a direct move to apply.`;
}

function wouldFlagsEnableChord(board: Board, targets: Coordinate[]) {
  const targetKeys = new Set(targets.map(coordinateKey));
  return board.flat().some((cell) => {
    if (!cell.isRevealed || cell.neighborMines === 0) {
      return false;
    }
    const neighbors = getNeighbors(board, cell.row, cell.col);
    const flagsAfter = neighbors.filter(
      (neighbor) => neighbor.isFlagged || targetKeys.has(keyOf(neighbor.row, neighbor.col)),
    ).length;
    const hiddenAfter = neighbors.filter(
      (neighbor) =>
        !neighbor.isRevealed &&
        !neighbor.isFlagged &&
        !targetKeys.has(keyOf(neighbor.row, neighbor.col)),
    );
    return flagsAfter === cell.neighborMines && hiddenAfter.length > 0;
  });
}

function findSatisfiedClues(board: Board) {
  return board
    .flat()
    .filter((cell) => cell.isRevealed && cell.neighborMines > 0)
    .map((cell) => ({
      cell,
      flags: flagCountAround(board, cell),
      hidden: hiddenNeighbors(board, cell),
    }))
    .filter((item) => item.hidden.length > 0 && item.flags === item.cell.neighborMines);
}

function findUsefulFlagClue(board: Board) {
  return board
    .flat()
    .filter((cell) => cell.isRevealed && cell.neighborMines > 0)
    .map((cell) => {
      const flags = flagCountAround(board, cell);
      const hidden = hiddenNeighbors(board, cell);
      const targets = hidden.map((neighbor) => ({ row: neighbor.row, col: neighbor.col }));
      return { cell, flags, hidden, targets };
    })
    .find((item) => {
      if (item.hidden.length === 0 || item.flags + item.hidden.length !== item.cell.neighborMines) {
        return false;
      }
      return wouldFlagsEnableChord(board, item.targets);
    });
}

function clueSummaries(board: Board) {
  return board
    .flat()
    .filter((cell) => cell.isRevealed && cell.neighborMines > 0)
    .map((cell) => {
      const hidden = hiddenNeighbors(board, cell);
      const remaining = cell.neighborMines - flagCountAround(board, cell);
      return { cell, hidden, remaining };
    })
    .filter((item) => item.hidden.length > 0 && item.remaining >= 0 && item.remaining <= item.hidden.length);
}

function cellSet(cells: Cell[]) {
  return new Set(cells.map((cell) => keyOf(cell.row, cell.col)));
}

function isCellSubset(subset: Cell[], superset: Cell[]) {
  const keys = cellSet(superset);
  return subset.every((cell) => keys.has(keyOf(cell.row, cell.col)));
}

function differenceCells(base: Cell[], remove: Cell[]) {
  const removeKeys = cellSet(remove);
  return base.filter((cell) => !removeKeys.has(keyOf(cell.row, cell.col)));
}

function patternTitle(smallerRemaining: number, largerRemaining: number, hasFlags: boolean) {
  if (hasFlags) {
    return 'Reduction Pattern';
  }
  if (smallerRemaining === 1 && largerRemaining === 1) {
    return '1-1 Pattern';
  }
  if (smallerRemaining === 1 && largerRemaining === 2) {
    return '1-2 Pattern';
  }
  return 'Subset Pattern';
}

function findSubsetPattern(board: Board): Hint | null {
  const summaries = clueSummaries(board);
  for (const smaller of summaries) {
    for (const larger of summaries) {
      if (smaller.cell === larger.cell || smaller.hidden.length >= larger.hidden.length) {
        continue;
      }
      if (!isCellSubset(smaller.hidden, larger.hidden)) {
        continue;
      }
      const extra = differenceCells(larger.hidden, smaller.hidden);
      if (extra.length === 0) {
        continue;
      }
      const targets = extra.map((cell) => ({ row: cell.row, col: cell.col }));
      const hasFlags = flagCountAround(board, smaller.cell) > 0 || flagCountAround(board, larger.cell) > 0;
      const title = patternTitle(smaller.remaining, larger.remaining, hasFlags);

      if (smaller.remaining === larger.remaining) {
        return makeHint({
          category: 'pattern',
          targets,
          supports: [
            { row: smaller.cell.row, col: smaller.cell.col },
            { row: larger.cell.row, col: larger.cell.col },
          ],
          action: 'open',
          goal: 'reasoning',
          title,
          message: `${coordinateLabel(smaller.cell)} and ${coordinateLabel(larger.cell)} share the same mine group. Since both clues need ${smaller.remaining} mine(s), the extra covered cell(s) beside the larger clue are safe.`,
          tileMessage: `Open ${targets.map(coordinateLabel).join(', ')}. This is the safe side of the ${title.toLowerCase()}.`,
          confidence: 100,
        });
      }

      if (larger.remaining - smaller.remaining === extra.length) {
        if (!wouldFlagsEnableChord(board, targets)) {
          continue;
        }
        return makeHint({
          category: 'flag-for-info',
          targets,
          supports: [
            { row: smaller.cell.row, col: smaller.cell.col },
            { row: larger.cell.row, col: larger.cell.col },
          ],
          action: 'flag',
          goal: wouldFlagsEnableChord(board, targets) ? 'efficiency' : 'reasoning',
          title,
          message: `${coordinateLabel(smaller.cell)} limits the shared group to ${smaller.remaining} mine(s). ${coordinateLabel(larger.cell)} needs ${larger.remaining}, so the extra covered cell(s) must contain the remaining mine(s).`,
          tileMessage: `Flag ${targets.map(coordinateLabel).join(', ')}. This flag comes from pattern reasoning, not from guessing.`,
          confidence: 100,
        });
      }
    }
  }
  return null;
}

type SolverConstraint = {
  clue: Cell;
  variables: string[];
  remaining: number;
};

type SolverResult = {
  alwaysMines: Coordinate[];
  alwaysSafe: Coordinate[];
  supportsByTarget: Map<string, Coordinate[]>;
};

const MAX_SOLVER_COMPONENT_SIZE = 18;

function buildSolverConstraints(board: Board) {
  const variableCells = new Map<string, Cell>();
  const constraints = clueSummaries(board).map((summary) => {
    const variables = summary.hidden.map((cell) => {
      const key = keyOf(cell.row, cell.col);
      variableCells.set(key, cell);
      return key;
    });
    return {
      clue: summary.cell,
      variables,
      remaining: summary.remaining,
    };
  });

  return {
    constraints: constraints.filter((constraint) => constraint.variables.length > 0),
    variableCells,
  };
}

function variableComponents(variableKeys: string[], constraints: SolverConstraint[]) {
  const neighbors = new Map<string, Set<string>>();
  variableKeys.forEach((key) => neighbors.set(key, new Set()));
  constraints.forEach((constraint) => {
    constraint.variables.forEach((key) => {
      const connected = neighbors.get(key);
      if (!connected) {
        return;
      }
      constraint.variables.forEach((otherKey) => {
        if (otherKey !== key) {
          connected.add(otherKey);
        }
      });
    });
  });

  const seen = new Set<string>();
  const components: string[][] = [];
  variableKeys.forEach((key) => {
    if (seen.has(key)) {
      return;
    }
    const stack = [key];
    const component: string[] = [];
    seen.add(key);
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      component.push(current);
      neighbors.get(current)?.forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      });
    }
    components.push(component);
  });

  return components;
}

function enumerateComponentSolutions(componentKeys: string[], constraints: SolverConstraint[]) {
  const indexByKey = new Map(componentKeys.map((key, index) => [key, index]));
  const localConstraints = constraints
    .filter((constraint) => constraint.variables.every((key) => indexByKey.has(key)))
    .map((constraint) => ({
      indices: constraint.variables.map((key) => indexByKey.get(key) as number),
      remaining: constraint.remaining,
      clue: constraint.clue,
    }));
  const assignments = Array(componentKeys.length).fill(-1);
  const mineCounts = Array(componentKeys.length).fill(0);
  let totalSolutions = 0;

  function isPartialValid() {
    return localConstraints.every((constraint) => {
      let assignedMines = 0;
      let unknown = 0;
      constraint.indices.forEach((index) => {
        if (assignments[index] === 1) {
          assignedMines += 1;
        } else if (assignments[index] === -1) {
          unknown += 1;
        }
      });
      return assignedMines <= constraint.remaining && assignedMines + unknown >= constraint.remaining;
    });
  }

  function search(index: number) {
    if (!isPartialValid()) {
      return;
    }
    if (index === componentKeys.length) {
      totalSolutions += 1;
      assignments.forEach((value, assignmentIndex) => {
        if (value === 1) {
          mineCounts[assignmentIndex] += 1;
        }
      });
      return;
    }

    assignments[index] = 0;
    search(index + 1);
    assignments[index] = 1;
    search(index + 1);
    assignments[index] = -1;
  }

  search(0);

  return {
    totalSolutions,
    mineCounts,
    supports: localConstraints.map((constraint) => ({ row: constraint.clue.row, col: constraint.clue.col })),
  };
}

function solveLocalConstraints(board: Board): SolverResult {
  const { constraints, variableCells } = buildSolverConstraints(board);
  const variableKeys = [...variableCells.keys()];
  const supportsByTarget = new Map<string, Coordinate[]>();
  const alwaysMines: Coordinate[] = [];
  const alwaysSafe: Coordinate[] = [];

  variableComponents(variableKeys, constraints).forEach((componentKeys) => {
    if (componentKeys.length === 0 || componentKeys.length > MAX_SOLVER_COMPONENT_SIZE) {
      return;
    }
    const result = enumerateComponentSolutions(componentKeys, constraints);
    if (result.totalSolutions === 0) {
      return;
    }
    componentKeys.forEach((key, index) => {
      const cell = variableCells.get(key);
      if (!cell) {
        return;
      }
      const coordinate = { row: cell.row, col: cell.col };
      supportsByTarget.set(key, result.supports);
      if (result.mineCounts[index] === result.totalSolutions) {
        alwaysMines.push(coordinate);
      } else if (result.mineCounts[index] === 0) {
        alwaysSafe.push(coordinate);
      }
    });
  });

  return {
    alwaysMines: uniqueCoordinates(alwaysMines),
    alwaysSafe: uniqueCoordinates(alwaysSafe),
    supportsByTarget,
  };
}

function chordUnlockScore(board: Board, targets: Coordinate[]) {
  const targetKeys = new Set(targets.map(coordinateKey));
  return board.flat().reduce((score, cell) => {
    if (!cell.isRevealed || cell.neighborMines === 0) {
      return score;
    }
    const neighbors = getNeighbors(board, cell.row, cell.col);
    const flagsAfter = neighbors.filter(
      (neighbor) => neighbor.isFlagged || targetKeys.has(keyOf(neighbor.row, neighbor.col)),
    ).length;
    if (flagsAfter !== cell.neighborMines) {
      return score;
    }
    const hiddenAfter = neighbors.filter(
      (neighbor) =>
        !neighbor.isRevealed &&
        !neighbor.isFlagged &&
        !targetKeys.has(keyOf(neighbor.row, neighbor.col)),
    ).length;
    return score + hiddenAfter;
  }, 0);
}

function findConstraintSolverHint(board: Board): Hint | null {
  const solved = solveLocalConstraints(board);
  const progressFlags = solved.alwaysMines
    .map((target) => ({
      target,
      score: chordUnlockScore(board, [target]),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.target.row - b.target.row || a.target.col - b.target.col);

  if (progressFlags.length > 0) {
    const target = progressFlags[0].target;
    return makeHint({
      category: 'flag-for-info',
      targets: [target],
      supports: solved.supportsByTarget.get(coordinateKey(target)) ?? [],
      action: 'flag',
      goal: 'efficiency',
      title: 'Forced Flag',
      message:
        'The highlighted numbers leave one valid arrangement: the marked covered cell is always a mine. Flag it to unlock the next chord.',
      tileMessage: 'Flag the highlighted covered cell. The blue numbers prove it is a mine and it should unlock safe opens.',
      confidence: 100,
    });
  }

  if (solved.alwaysSafe.length > 0) {
    const target = solved.alwaysSafe
      .map((coordinate) => ({
        coordinate,
        information: getNeighbors(board, coordinate.row, coordinate.col).filter((cell) => cell.isRevealed).length,
      }))
      .sort((a, b) => b.information - a.information || a.coordinate.row - b.coordinate.row || a.coordinate.col - b.coordinate.col)[0]
      .coordinate;
    return makeHint({
      category: 'safe',
      targets: [target],
      supports: solved.supportsByTarget.get(coordinateKey(target)) ?? [],
      action: 'open',
      goal: 'reasoning',
      title: 'Forced Safe',
      message: 'The highlighted numbers prove this covered cell cannot contain a mine. Open it before guessing.',
      tileMessage: 'Open the highlighted covered cell. Every valid mine arrangement keeps it safe.',
      confidence: 100,
    });
  }

  return null;
}

function findMineCountHint(board: Board, setup: Setup): Hint | null {
  const hiddenCells = board.flat().filter((cell) => !cell.isRevealed && !cell.isFlagged);
  if (hiddenCells.length === 0) {
    return null;
  }
  const targets = hiddenCells.map((cell) => ({ row: cell.row, col: cell.col }));
  const remainingMines = setup.mines - countFlags(board);
  if (remainingMines <= 0) {
    return makeHint({
      category: 'safe',
      targets,
      action: 'open',
      goal: 'completion',
      title: 'Mine Count',
      message: 'All mines are already accounted for by flags. Every remaining covered cell is safe.',
      tileMessage: `Open ${targets.slice(0, 4).map(coordinateLabel).join(', ')}${targets.length > 4 ? ', and the rest' : ''}. The mine counter proves they are safe.`,
      confidence: 100,
    });
  }
  if (remainingMines === hiddenCells.length) {
    return makeHint({
      category: 'flag-for-info',
      targets,
      action: 'flag',
      goal: 'completion',
      title: 'Mine Count',
      message: 'The number of covered cells equals the remaining mine count. Every covered cell must be a mine.',
      tileMessage: `Flag ${targets.slice(0, 4).map(coordinateLabel).join(', ')}${targets.length > 4 ? ', and the rest' : ''}. The mine count proves all remaining covered cells are mines.`,
      confidence: 100,
    });
  }
  return null;
}

function unrevealedSideCells(board: Board, coordinates: Coordinate[]) {
  const cells = coordinates.map(({ row, col }) => board[row]?.[col]);
  if (cells.some((cell) => !cell || cell.isRevealed || cell.isFlagged)) {
    return null;
  }
  return cells as Cell[];
}

function hiddenSubsetMatches(cells: Cell[], expected: Cell[]) {
  const expectedKeys = new Set(expected.map((cell) => keyOf(cell.row, cell.col)));
  return cells.every((cell) => expectedKeys.has(keyOf(cell.row, cell.col)));
}

function findOneTwoOnePattern(board: Board): Hint | null {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col <= board[0].length - 3; col += 1) {
      const clues = [board[row][col], board[row][col + 1], board[row][col + 2]];
      if (!clues.every((cell) => cell.isRevealed) || clues.map((cell) => cell.neighborMines).join('-') !== '1-2-1') {
        continue;
      }
      for (const rowOffset of [-1, 1]) {
        const side = unrevealedSideCells(board, [
          { row: row + rowOffset, col },
          { row: row + rowOffset, col: col + 1 },
          { row: row + rowOffset, col: col + 2 },
        ]);
        if (!side || !clues.every((cell) => flagCountAround(board, cell) === 0)) {
          continue;
        }
        if (!clues.every((cell) => hiddenSubsetMatches(hiddenNeighbors(board, cell), side))) {
          continue;
        }
        const target = { row: side[1].row, col: side[1].col };
        return makeHint({
          category: 'pattern',
          targets: [target],
          supports: clues.map((cell) => ({ row: cell.row, col: cell.col })),
          action: 'open',
          goal: 'reasoning',
          title: '1-2-1 Pattern',
          message: 'This is a clean 1-2-1 edge. The two outside covered cells account for the 1s, so the middle covered cell is safe.',
          tileMessage: `Open ${coordinateLabel(target)}. In this 1-2-1, the middle covered cell is the safe one.`,
          confidence: 100,
        });
      }
    }
  }

  for (let row = 0; row <= board.length - 3; row += 1) {
    for (let col = 0; col < board[0].length; col += 1) {
      const clues = [board[row][col], board[row + 1][col], board[row + 2][col]];
      if (!clues.every((cell) => cell.isRevealed) || clues.map((cell) => cell.neighborMines).join('-') !== '1-2-1') {
        continue;
      }
      for (const colOffset of [-1, 1]) {
        const side = unrevealedSideCells(board, [
          { row, col: col + colOffset },
          { row: row + 1, col: col + colOffset },
          { row: row + 2, col: col + colOffset },
        ]);
        if (!side || !clues.every((cell) => flagCountAround(board, cell) === 0)) {
          continue;
        }
        if (!clues.every((cell) => hiddenSubsetMatches(hiddenNeighbors(board, cell), side))) {
          continue;
        }
        const target = { row: side[1].row, col: side[1].col };
        return makeHint({
          category: 'pattern',
          targets: [target],
          supports: clues.map((cell) => ({ row: cell.row, col: cell.col })),
          action: 'open',
          goal: 'reasoning',
          title: '1-2-1 Pattern',
          message: 'This vertical 1-2-1 has the same logic: the outside covered cells satisfy the 1s, so the middle covered cell is safe.',
          tileMessage: `Open ${coordinateLabel(target)}. The center covered cell in this vertical 1-2-1 is safe.`,
          confidence: 100,
        });
      }
    }
  }

  return null;
}

function findOneOneEdgePattern(board: Board): Hint | null {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col <= board[0].length - 2; col += 1) {
      const clues = [board[row][col], board[row][col + 1]];
      if (!clues.every((cell) => cell.isRevealed && cell.neighborMines === 1)) {
        continue;
      }
      for (const rowOffset of [-1, 1]) {
        const side = unrevealedSideCells(board, [
          { row: row + rowOffset, col },
          { row: row + rowOffset, col: col + 1 },
        ]);
        if (!side || !clues.every((cell) => flagCountAround(board, cell) === 0)) {
          continue;
        }
        if (!clues.every((cell) => hiddenSubsetMatches(hiddenNeighbors(board, cell), side))) {
          continue;
        }
        const targets = side.map((cell) => ({ row: cell.row, col: cell.col }));
        return makeHint({
          category: 'pattern',
          targets,
          supports: clues.map((cell) => ({ row: cell.row, col: cell.col })),
          action: 'none',
          goal: 'reasoning',
          title: '1-1 Edge',
          message:
            'These paired 1s say exactly one of the adjacent covered cells is a mine. Do not flag either one yet; wait for a clue that touches only one side, or choose an information guess elsewhere.',
          tileMessage: `Study ${targets.map(coordinateLabel).join(' and ')}. The pair contains one mine, but the board has not proved which one.`,
          confidence: 100,
        });
      }
    }
  }

  for (let row = 0; row <= board.length - 2; row += 1) {
    for (let col = 0; col < board[0].length; col += 1) {
      const clues = [board[row][col], board[row + 1][col]];
      if (!clues.every((cell) => cell.isRevealed && cell.neighborMines === 1)) {
        continue;
      }
      for (const colOffset of [-1, 1]) {
        const side = unrevealedSideCells(board, [
          { row, col: col + colOffset },
          { row: row + 1, col: col + colOffset },
        ]);
        if (!side || !clues.every((cell) => flagCountAround(board, cell) === 0)) {
          continue;
        }
        if (!clues.every((cell) => hiddenSubsetMatches(hiddenNeighbors(board, cell), side))) {
          continue;
        }
        const targets = side.map((cell) => ({ row: cell.row, col: cell.col }));
        return makeHint({
          category: 'pattern',
          targets,
          supports: clues.map((cell) => ({ row: cell.row, col: cell.col })),
          action: 'none',
          goal: 'reasoning',
          title: '1-1 Edge',
          message:
            'This vertical 1-1 edge forms a pair: one of the adjacent covered cells is a mine, but neither side is proven yet.',
          tileMessage: `Study ${targets.map(coordinateLabel).join(' and ')}. This pair has one mine total, so avoid blind flagging.`,
          confidence: 100,
        });
      }
    }
  }

  return null;
}

function estimateCellRisk(board: Board, setup: Setup, cell: Cell) {
  const hiddenCells = board.flat().filter((item) => !item.isRevealed && !item.isFlagged);
  const globalRisk = hiddenCells.length === 0 ? 0 : Math.max(0, setup.mines - countFlags(board)) / hiddenCells.length;
  const revealedNeighbors = getNeighbors(board, cell.row, cell.col).filter((neighbor) => neighbor.isRevealed);
  const localClues = revealedNeighbors
    .filter((neighbor) => neighbor.neighborMines > 0)
    .map((neighbor) => {
      const hidden = hiddenNeighbors(board, neighbor);
      const remaining = Math.max(0, neighbor.neighborMines - flagCountAround(board, neighbor));
      return {
        cell: neighbor,
        hiddenCount: hidden.length,
        remaining,
        risk: hidden.length === 0 ? 0 : remaining / hidden.length,
      };
    });
  const localRisks = localClues.map((clue) => clue.risk);
  const bestCoverage = localClues
    .filter((clue) => clue.hiddenCount >= 4 && clue.remaining > 0)
    .sort((a, b) => a.risk - b.risk || b.hiddenCount - a.hiddenCount)[0];
  return {
    risk: clamp(localRisks.length ? Math.max(...localRisks) : globalRisk, 0, 1),
    backgroundRisk: globalRisk,
    bestCoverage,
    information: revealedNeighbors.length,
    isEdge: cell.row === 0 || cell.col === 0 || cell.row === setup.rows - 1 || cell.col === setup.cols - 1,
    isCorner:
      (cell.row === 0 || cell.row === setup.rows - 1) &&
      (cell.col === 0 || cell.col === setup.cols - 1),
    isFrontier: revealedNeighbors.length > 0,
  };
}

function chooseAdaptiveGoal(stats: StoredStats, setup: Setup, progress: number, elapsed: number, clicks: number, chords: number): HintGoal {
  const winRate = stats.total.played > 0 ? stats.total.wins / stats.total.played : 0;
  const averageHints = stats.total.played > 0 ? stats.total.totalHints / stats.total.played : 0;
  if (stats.total.played >= 3 && winRate < 0.4) {
    return 'completion';
  }
  if (progress > 0.7) {
    return 'completion';
  }
  if (averageHints > 2 && progress < 0.6) {
    return 'reasoning';
  }
  if (elapsed > safeCells(setup) * 1.2 && progress < 0.65) {
    return 'speed';
  }
  if (clicks > 8 && chords < Math.max(1, Math.floor(clicks / 12))) {
    return 'efficiency';
  }
  return 'reasoning';
}

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildGuessHint(
  board: Board,
  setup: Setup,
  stats: StoredStats,
  progress: number,
  elapsed: number,
  clicks: number,
  chords: number,
): Hint {
  const hiddenCells = board.flat().filter((cell) => !cell.isRevealed && !cell.isFlagged);
  if (hiddenCells.length === 0) {
    return makeHint({
      category: 'idle',
      action: 'none',
      goal: 'reasoning',
      title: 'No Hidden Cells',
      message: 'No hidden cells remain.',
      confidence: 100,
    });
  }

  const goal = chooseAdaptiveGoal(stats, setup, progress, elapsed, clicks, chords);
  const candidates = hiddenCells.map((cell) => ({
    cell,
    ...estimateCellRisk(board, setup, cell),
  }));
  const minRisk = Math.min(...candidates.map((candidate) => candidate.risk));
  const maxInfo = Math.max(...candidates.map((candidate) => candidate.information));
  const pool =
    goal === 'completion'
      ? candidates.filter((candidate) => candidate.risk <= minRisk + 0.02)
      : goal === 'efficiency'
        ? candidates.filter((candidate) => candidate.information === maxInfo && candidate.risk <= minRisk + 0.15)
        : goal === 'speed'
          ? candidates.filter((candidate) => (candidate.isEdge || candidate.isCorner || !candidate.isFrontier) && candidate.risk <= minRisk + 0.18)
          : candidates.filter((candidate) => candidate.risk <= minRisk + 0.08);
  const fallbackPool = candidates.filter((candidate) => candidate.risk <= minRisk + 0.08);
  const selected = pickRandom(pool.length > 0 ? pool : fallbackPool.length > 0 ? fallbackPool : candidates);
  const target = { row: selected.cell.row, col: selected.cell.col };
  const risk = Math.round(selected.risk * 100);
  const backgroundRisk = Math.round(selected.backgroundRisk * 100);
  const coverageRisk = selected.bestCoverage ? Math.round(selected.bestCoverage.risk * 100) : null;
  const title =
    selected.bestCoverage && selected.bestCoverage.risk <= selected.backgroundRisk
      ? 'Square Coverage Ratio'
      : !selected.isFrontier
        ? 'Background Rate Guess'
        : goal === 'efficiency'
          ? 'More-Helpful Guess'
          : 'Guess Strategy';
  const goalMessages: Record<HintGoal, string> = {
    speed: 'No forced move is available. For speed, take a controlled guess instead of spending too long searching for a guaranteed pattern.',
    efficiency: 'No forced move is available. For efficiency, prefer a guess whose safe result is likely to create progress, not just survive.',
    completion: 'No forced move is available. For completion, protect the run by comparing the frontier risk against the background rate.',
    reasoning: 'No forced move is available. Check for effective-number reductions, then choose a low-risk information guess.',
  };
  const strategyNote =
    selected.bestCoverage && coverageRisk !== null
      ? ` This uses square coverage ratio: an effective ${selected.bestCoverage.remaining} is spread across ${selected.bestCoverage.hiddenCount} cells near ${coordinateLabel(selected.bestCoverage.cell)}.`
      : !selected.isFrontier
        ? ` This is a background-rate guess at about ${backgroundRisk}% because it is not touching current clues.`
        : selected.information >= 2
          ? ' This is a more-helpful-result guess: if it is safe, it touches multiple clues and should reveal progress.'
          : '';

  return makeHint({
    category: 'guess',
    targets: [target],
    supports: selected.bestCoverage
      ? [{ row: selected.bestCoverage.cell.row, col: selected.bestCoverage.cell.col }]
      : [],
    action: 'open',
    goal,
    title,
    message: `${goalMessages[goal]} Estimated risk is ${risk}%.${strategyNote}`,
    tileMessage: `Open ${coordinateLabel(target)} for a ${goal} guess. Estimated risk is ${risk}%, background rate is about ${backgroundRisk}%, and ${selected.information} revealed clue(s) touch it.`,
    confidence: Math.max(5, 100 - risk),
    risk,
  });
}

function analyzeBoard(
  board: Board,
  setup: Setup,
  status: GameStatus,
  stats: StoredStats,
  elapsed: number,
  clicks: number,
  chords: number,
): Hint {
  if (status === 'ready') {
    const target = {
      row: Math.floor(setup.rows / 2),
      col: Math.floor(setup.cols / 2),
    };
    return makeHint({
      category: 'guess',
      targets: [target],
      action: 'open',
      goal: 'speed',
      title: 'Opening Move',
      message: 'Start near the center to expose more neighbors and build a useful frontier quickly.',
      tileMessage: `Open ${coordinateLabel(target)}. Center starts usually reveal more information than corners.`,
      confidence: 55,
      risk: 0,
    });
  }

  if (status === 'won') {
    return makeHint({
      category: 'postgame',
      action: 'none',
      goal: 'efficiency',
      title: 'Clean Board',
      message: 'Clean board. Your next score gains most from faster chords and fewer low-value flags.',
      confidence: 100,
    });
  }

  if (status === 'lost') {
    return makeHint({
      category: 'postgame',
      action: 'none',
      goal: 'reasoning',
      title: 'Review the Miss',
      message: 'Review the last numbered tile you trusted. Most losses come from a flag count that did not actually satisfy the clue.',
      confidence: 100,
    });
  }

  const satisfiedClues = findSatisfiedClues(board);
  const singleSafe = satisfiedClues.find((item) => item.hidden.length === 1);
  if (singleSafe) {
    const target = { row: singleSafe.hidden[0].row, col: singleSafe.hidden[0].col };
    return makeHint({
      category: 'safe',
      targets: [target],
      supports: [{ row: singleSafe.cell.row, col: singleSafe.cell.col }],
      action: 'open',
      goal: 'completion',
      title: 'Satisfied Clue',
      message: `The ${singleSafe.cell.neighborMines} at ${coordinateLabel(singleSafe.cell)} already has all its flags. Any remaining covered neighbor is safe.`,
      tileMessage: `Open ${coordinateLabel(target)}. The clue beside it is already satisfied by flags.`,
      confidence: 100,
    });
  }

  const mineCount = findMineCountHint(board, setup);
  if (mineCount?.action === 'open') {
    return mineCount;
  }

  const subsetPattern = findSubsetPattern(board);
  if (subsetPattern?.action === 'open') {
    return subsetPattern;
  }

  const pattern = findOneTwoOnePattern(board);
  if (pattern?.action === 'open') {
    return pattern;
  }

  const constraintHint = findConstraintSolverHint(board);
  if (constraintHint?.action === 'open') {
    return constraintHint;
  }

  const chord = satisfiedClues.find((item) => item.hidden.length > 1);
  if (chord) {
    const target = { row: chord.cell.row, col: chord.cell.col };
    return makeHint({
      category: 'chord',
      targets: [target],
      supports: chord.hidden.map((cell) => ({ row: cell.row, col: cell.col })),
      action: 'chord',
      goal: 'speed',
      title: 'Chord Opportunity',
      message: `The ${chord.cell.neighborMines} at ${coordinateLabel(chord.cell)} is satisfied. Chording it opens ${chord.hidden.length} safe cells at once.`,
      tileMessage: `Chord ${coordinateLabel(target)}. It should open ${chord.hidden.length} safe neighbors.`,
      confidence: 100,
    });
  }

  if (mineCount) {
    return mineCount;
  }

  if (constraintHint?.action === 'flag') {
    return constraintHint;
  }

  const usefulFlag = findUsefulFlagClue(board);
  if (usefulFlag) {
    return makeHint({
      category: 'flag-for-info',
      targets: usefulFlag.targets,
      supports: [{ row: usefulFlag.cell.row, col: usefulFlag.cell.col }],
      action: 'flag',
      goal: usefulFlag.targets.length > 1 ? 'reasoning' : 'efficiency',
      title: 'Useful Flag',
      message: `The ${usefulFlag.cell.neighborMines} at ${coordinateLabel(usefulFlag.cell)} has only mine slots left. Flagging this is useful because it unlocks more information, not just because it marks a bomb.`,
      tileMessage: `Flag ${usefulFlag.targets.map(coordinateLabel).join(', ')}. Then look for newly satisfied clues to chord or open.`,
      confidence: 100,
    });
  }

  if (subsetPattern) {
    return subsetPattern;
  }

  if (pattern) {
    return pattern;
  }

  const edgePattern = findOneOneEdgePattern(board);
  if (edgePattern) {
    return edgePattern;
  }

  return buildGuessHint(board, setup, stats, countRevealedSafe(board) / safeCells(setup), elapsed, clicks, chords);
}

function scoreMatch(match: Omit<MatchSummary, 'id' | 'score'>, setup: Setup) {
  const revealRatio = countRevealedSafeFromEfficiency(match.efficiency, match.clicks, match.chords, match.hints, setup);
  const completion = match.won ? 1 : revealRatio;
  const speedBudget = safeCells(setup) * 2.4;
  const speedScore = Math.max(0, 260 * (1 - match.time / Math.max(1, speedBudget)));
  const efficiencyScore = Math.min(280, match.efficiency * 28);
  const chordScore = Math.min(110, match.chords * 8);
  const hintPenalty = match.hints * 35;
  const base = match.won ? 520 : 120 * completion;
  return Math.max(0, Math.round(base + speedScore + efficiencyScore + chordScore - hintPenalty));
}

function countRevealedSafeFromEfficiency(
  efficiency: number,
  clicks: number,
  chords: number,
  hints: number,
  setup: Setup,
) {
  const actionWeight = Math.max(1, clicks + chords + hints);
  return clamp((efficiency * actionWeight) / safeCells(setup), 0, 1);
}

export {
  MIN_ROWS,
  MAX_ROWS,
  MIN_COLS,
  MAX_COLS,
  MIN_MINES,
  MAX_MINE_RATIO,
  PRESETS,
  IDLE_HINT,
  clamp,
  maxMines,
  safeCells,
  makeEmptyBoard,
  cloneBoard,
  keyOf,
  getNeighbors,
  createBoard,
  revealMutable,
  revealAllMines,
  chordMutable,
  completeWinningBoard,
  countFlags,
  countRevealedSafe,
  countHidden,
  didWin,
  coordinateKey,
  coordinateLabel,
  uniqueCoordinates,
  hiddenNeighbors,
  flagCountAround,
  makeHint,
  revealTileLayer,
  hasCoordinate,
  coordinateListLabel,
  makeInvalidChordHint,
  makeLossReviewHint,
  reviewMove,
  wouldFlagsEnableChord,
  findSatisfiedClues,
  findUsefulFlagClue,
  clueSummaries,
  findSubsetPattern,
  findMineCountHint,
  findOneTwoOnePattern,
  findOneOneEdgePattern,
  estimateCellRisk,
  chooseAdaptiveGoal,
  buildGuessHint,
  analyzeBoard,
  scoreMatch,
  countRevealedSafeFromEfficiency,
};

