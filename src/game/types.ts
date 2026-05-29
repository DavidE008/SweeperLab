export type LevelKey = 'beginner' | 'intermediate' | 'expert' | 'custom';
export type GameStatus = 'ready' | 'playing' | 'won' | 'lost';
export type ScreenKey = 'game' | 'setup' | 'coach' | 'progress';
export type HintCategory = 'pattern' | 'chord' | 'safe' | 'flag-for-info' | 'guess' | 'postgame' | 'idle';
export type HintLayer = 'concept' | 'tile';
export type HintAction = 'open' | 'flag' | 'chord' | 'none';
export type HintGoal = 'speed' | 'efficiency' | 'completion' | 'reasoning';
export type MoveAction = 'open' | 'flag' | 'chord';
export type GridScaleKey = 'compact' | 'standard' | 'large';

export type Setup = {
  key: LevelKey;
  label: string;
  rows: number;
  cols: number;
  mines: number;
};

export type Cell = {
  row: number;
  col: number;
  isMine: boolean;
  isRevealed: boolean;
  isFlagged: boolean;
  isWrongFlag?: boolean;
  isExploded?: boolean;
  neighborMines: number;
};

export type Board = Cell[][];

export type Coordinate = {
  row: number;
  col: number;
};

export type Hint = {
  category: HintCategory;
  layer: HintLayer;
  targets: Coordinate[];
  supports: Coordinate[];
  action: HintAction;
  goal: HintGoal;
  title: string;
  message: string;
  tileMessage: string;
  confidence: number;
  risk?: number;
};

export type MatchSummary = {
  id: string;
  level: LevelKey;
  levelLabel: string;
  won: boolean;
  time: number;
  clicks: number;
  chords: number;
  hints: number;
  efficiency: number;
  score: number;
};

export type LevelStats = {
  played: number;
  wins: number;
  losses: number;
  bestTime: number | null;
  bestScore: number;
  totalScore: number;
  totalTime: number;
  totalClicks: number;
  totalHints: number;
};

export type StoredStats = {
  total: LevelStats;
  levels: Record<LevelKey, LevelStats>;
  recent: MatchSummary[];
};

export type CompletionSummary = MatchSummary & {
  bestScore: number;
  bestTime: number | null;
  isBestScore: boolean;
  isBestTime: boolean;
};

export type InvalidChordAttempt = Coordinate & {
  needed: number;
  flags: number;
};

export type LossReviewInput = {
  beforeHint: Hint | null;
  action: MoveAction;
  target: Coordinate;
  exploded?: Coordinate[];
  wrongFlags?: Coordinate[];
  missingMines?: Coordinate[];
  chordValue?: number;
  chordFlags?: number;
};

export type BoardEdgeFeedback = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};
