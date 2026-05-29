import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  IDLE_HINT,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_MINES,
  MIN_ROWS,
  PRESETS,
  analyzeBoard,
  clamp,
  cloneBoard,
  completeWinningBoard,
  countFlags,
  countHidden,
  countRevealedSafe,
  createBoard,
  didWin,
  getNeighbors,
  keyOf,
  makeEmptyBoard,
  makeInvalidChordHint,
  makeLossReviewHint,
  maxMines,
  revealAllMines,
  revealMutable,
  revealTileLayer,
  reviewMove,
  safeCells,
  scoreMatch,
  uniqueCoordinates,
} from './src/game/engine';
import type {
  Board,
  BoardEdgeFeedback,
  Cell,
  CompletionSummary,
  Coordinate,
  GameStatus,
  GridScaleKey,
  Hint,
  HintGoal,
  InvalidChordAttempt,
  LevelKey,
  MatchSummary,
  ScreenKey,
  Setup,
  StoredStats,
} from './src/game/types';
import { STATS_KEY, createStats, mergeStats, updateLevelStats } from './src/storage/stats';
import { brand } from './src/theme/brand';

const levelOrder: LevelKey[] = ['beginner', 'intermediate', 'expert', 'custom'];
const navItems: { key: ScreenKey; label: string }[] = [
  { key: 'game', label: 'Game' },
  { key: 'coach', label: 'Coach' },
  { key: 'progress', label: 'Stats' },
];
const clueColors = [
  '#1F2937',
  '#2563EB',
  '#16A34A',
  '#DC2626',
  '#7C3AED',
  '#C2410C',
  brand.primary,
  '#BE123C',
  '#111827',
];
const BOARD_FRAME_WIDTH = 4;
const BOARD_EDGE_EPSILON = 0.5;
const BOARD_EDGE_PULL = 54;
const GAME_HUD_ESTIMATE = 58;
const GRID_SCALE_OPTIONS: { key: GridScaleKey; label: string; minCellSize: number }[] = [
  { key: 'compact', label: 'Compact', minCellSize: 28 },
  { key: 'standard', label: 'Standard', minCellSize: 36 },
  { key: 'large', label: 'Large', minCellSize: 48 },
];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatCounter(value: number) {
  const sign = value < 0 ? '-' : '';
  const digits = Math.min(999, Math.abs(value)).toString().padStart(sign ? 2 : 3, '0');
  return `${sign}${digits}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatGoal(goal: HintGoal) {
  return goal === 'speed'
    ? 'Speed'
    : goal === 'efficiency'
      ? 'Efficiency'
      : goal === 'completion'
        ? 'Completion'
        : 'Reasoning';
}
export default function App() {
  const windowSize = useWindowDimensions();
  const [setup, setSetup] = useState<Setup>(PRESETS.beginner);
  const [customRows, setCustomRows] = useState(12);
  const [customCols, setCustomCols] = useState(14);
  const [customMines, setCustomMines] = useState(24);
  const [board, setBoard] = useState<Board>(() => makeEmptyBoard(PRESETS.beginner.rows, PRESETS.beginner.cols));
  const [status, setStatus] = useState<GameStatus>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [chords, setChords] = useState(0);
  const [hints, setHints] = useState(0);
  const [flagMode, setFlagMode] = useState(false);
  const [screen, setScreen] = useState<ScreenKey>('game');
  const [isSetupOpen, setSetupOpen] = useState(true);
  const [gridScale, setGridScale] = useState<GridScaleKey>('standard');
  const [stats, setStats] = useState<StoredStats>(() => createStats());
  const [lastMatch, setLastMatch] = useState<MatchSummary | null>(null);
  const [completion, setCompletion] = useState<CompletionSummary | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const [activeHint, setActiveHint] = useState<Hint | null>(null);
  const [lastInvalidChordAttempt, setLastInvalidChordAttempt] = useState<InvalidChordAttempt | null>(null);
  const [lastMoveReview, setLastMoveReview] = useState('');
  const [boardViewport, setBoardViewport] = useState({ width: 0, height: 0 });
  const [edgeFeedback, setEdgeFeedback] = useState<BoardEdgeFeedback>({
    top: false,
    right: false,
    bottom: false,
    left: false,
  });
  const boardPanAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const boardPanRef = useRef({ x: 0, y: 0 });
  const boardPanStartRef = useRef({ x: 0, y: 0 });
  const boardMetricsRef = useRef({ viewportWidth: 0, viewportHeight: 0, boardWidth: 0, boardHeight: 0 });
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        boardPanStartRef.current = boardPanRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const nextPan = {
          x: boardPanStartRef.current.x + gesture.dx,
          y: boardPanStartRef.current.y + gesture.dy,
        };
        setBoardPanImmediate(rubberBandBoardPan(nextPan), nextPan);
      },
      onPanResponderRelease: settleBoardPan,
      onPanResponderTerminate: settleBoardPan,
    }),
  ).current;

  const flags = useMemo(() => countFlags(board), [board]);
  const minesLeft = setup.mines - flags;
  const revealedSafe = useMemo(() => countRevealedSafe(board), [board]);
  const progress = revealedSafe / safeCells(setup);
  const currentHint = activeHint ?? IDLE_HINT;
  const isFinished = status === 'won' || status === 'lost';
  const canOpenResultMenu = isFinished && completion !== null;
  const customMaxMines = maxMines(customRows, customCols);
  const selectedGridScale =
    GRID_SCALE_OPTIONS.find((option) => option.key === gridScale) ?? GRID_SCALE_OPTIONS[1];
  const baseCellSize = selectedGridScale.minCellSize;
  const estimatedViewportWidth = boardViewport.width > 0 ? boardViewport.width : windowSize.width;
  const estimatedViewportHeight =
    boardViewport.height > 0 ? boardViewport.height : Math.max(0, windowSize.height - GAME_HUD_ESTIMATE);
  const fitCellSize =
    estimatedViewportWidth > 0 && estimatedViewportHeight > 0
      ? Math.ceil(Math.max(estimatedViewportWidth / setup.cols, estimatedViewportHeight / setup.rows))
      : baseCellSize;
  const cellSize = Math.max(baseCellSize, fitCellSize);
  const cellOuterSize = cellSize;
  const boardGridWidth = setup.cols * cellOuterSize;
  const boardGridHeight = setup.rows * cellOuterSize;
  const boardPixelWidth = boardGridWidth + BOARD_FRAME_WIDTH * 2;
  const boardPixelHeight = boardGridHeight + BOARD_FRAME_WIDTH * 2;

  useEffect(() => {
    AsyncStorage.getItem(STATS_KEY)
      .then((rawStats) => {
        if (rawStats) {
          setStats(mergeStats(JSON.parse(rawStats)));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (status !== 'playing') {
      return undefined;
    }
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    setCustomMines((value) => clamp(value, MIN_MINES, customMaxMines));
  }, [customMaxMines]);

  useEffect(() => {
    boardMetricsRef.current = {
      viewportWidth: boardViewport.width,
      viewportHeight: boardViewport.height,
      boardWidth: boardPixelWidth,
      boardHeight: boardPixelHeight,
    };
    settleBoardPan();
  }, [boardPixelHeight, boardPixelWidth, boardViewport.height, boardViewport.width]);

  useEffect(() => {
    if (status === 'playing') {
      setSetupOpen(false);
    }
  }, [status]);

  useEffect(() => {
    const highlightedCount =
      currentHint.layer === 'tile'
        ? currentHint.targets.length + currentHint.supports.length
        : currentHint.supports.length > 0
          ? currentHint.supports.length
          : currentHint.targets.length;
    if (highlightedCount === 0) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [currentHint.layer, currentHint.supports.length, currentHint.targets.length, pulseAnim]);

  function setBoardPanImmediate(nextPan: { x: number; y: number }, feedbackPan = nextPan) {
    boardPanRef.current = nextPan;
    boardPanAnim.stopAnimation();
    boardPanAnim.setValue(nextPan);
    updateEdgeFeedback(feedbackPan);
  }

  function boardPanBounds() {
    const { viewportWidth, viewportHeight, boardWidth, boardHeight } = boardMetricsRef.current;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return null;
    }
    const x =
      boardWidth <= viewportWidth
        ? { min: (viewportWidth - boardWidth) / 2, max: (viewportWidth - boardWidth) / 2 }
        : { min: viewportWidth - boardWidth, max: 0 };
    const y =
      boardHeight <= viewportHeight
        ? { min: (viewportHeight - boardHeight) / 2, max: (viewportHeight - boardHeight) / 2 }
        : { min: viewportHeight - boardHeight, max: 0 };
    return { x, y };
  }

  function clampBoardPan(nextPan: { x: number; y: number }) {
    const bounds = boardPanBounds();
    if (!bounds) {
      return nextPan;
    }
    return {
      x: clamp(nextPan.x, bounds.x.min, bounds.x.max),
      y: clamp(nextPan.y, bounds.y.min, bounds.y.max),
    };
  }

  function rubberBandValue(value: number, min: number, max: number) {
    if (value < min) {
      const overflow = min - value;
      return min - BOARD_EDGE_PULL * (1 - 1 / (overflow / BOARD_EDGE_PULL + 1));
    }
    if (value > max) {
      const overflow = value - max;
      return max + BOARD_EDGE_PULL * (1 - 1 / (overflow / BOARD_EDGE_PULL + 1));
    }
    return value;
  }

  function rubberBandBoardPan(nextPan: { x: number; y: number }) {
    const bounds = boardPanBounds();
    if (!bounds) {
      return nextPan;
    }
    return {
      x: rubberBandValue(nextPan.x, bounds.x.min, bounds.x.max),
      y: rubberBandValue(nextPan.y, bounds.y.min, bounds.y.max),
    };
  }

  function hintFocusCoordinates(hint: Hint) {
    if (hint.layer === 'tile') {
      return hint.targets.length > 0 ? hint.targets : hint.supports;
    }
    return hint.supports.length > 0 ? hint.supports : hint.targets;
  }

  function focusBoardOnCoordinates(coordinates: Coordinate[]) {
    const bounds = boardPanBounds();
    const focusCoordinates = uniqueCoordinates(coordinates);
    if (!bounds || focusCoordinates.length === 0) {
      return;
    }

    const { viewportWidth, viewportHeight } = boardMetricsRef.current;
    const rows = focusCoordinates.map((coordinate) => coordinate.row);
    const cols = focusCoordinates.map((coordinate) => coordinate.col);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    const centerX = BOARD_FRAME_WIDTH + ((minCol + maxCol + 1) * cellOuterSize) / 2;
    const centerY = BOARD_FRAME_WIDTH + ((minRow + maxRow + 1) * cellOuterSize) / 2;

    setBoardPanImmediate(
      clampBoardPan({
        x: viewportWidth / 2 - centerX,
        y: viewportHeight / 2 - centerY,
      }),
    );
  }

  function focusBoardOnHint(hint: Hint) {
    focusBoardOnCoordinates(hintFocusCoordinates(hint));
  }

  function getEdgeFeedback(nextPan: { x: number; y: number }): BoardEdgeFeedback {
    const bounds = boardPanBounds();
    if (!bounds) {
      return { top: false, right: false, bottom: false, left: false };
    }

    return {
      left: nextPan.x > bounds.x.max + BOARD_EDGE_EPSILON,
      right: nextPan.x < bounds.x.min - BOARD_EDGE_EPSILON,
      top: nextPan.y > bounds.y.max + BOARD_EDGE_EPSILON,
      bottom: nextPan.y < bounds.y.min - BOARD_EDGE_EPSILON,
    };
  }

  function updateEdgeFeedback(nextPan: { x: number; y: number }) {
    const nextFeedback = getEdgeFeedback(nextPan);
    setEdgeFeedback((current) =>
      current.top === nextFeedback.top &&
      current.right === nextFeedback.right &&
      current.bottom === nextFeedback.bottom &&
      current.left === nextFeedback.left
        ? current
        : nextFeedback,
    );
  }

  function settleBoardPan() {
    const targetPan = clampBoardPan(boardPanRef.current);
    boardPanRef.current = targetPan;
    updateEdgeFeedback(targetPan);
    Animated.spring(boardPanAnim, {
      toValue: targetPan,
      useNativeDriver: true,
      speed: 26,
      bounciness: 0,
    }).start();
  }

  function handleBoardLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setBoardViewport({ width, height });
  }

  function resetGame(nextSetup = setup) {
    setSetup(nextSetup);
    setBoard(makeEmptyBoard(nextSetup.rows, nextSetup.cols));
    setStatus('ready');
    setElapsed(0);
    setClicks(0);
    setChords(0);
    setHints(0);
    setFlagMode(false);
    setActiveHint(null);
    setLastInvalidChordAttempt(null);
    setLastMoveReview('');
    setCompletion(null);
    setShowCompletion(false);
    setBoardPanImmediate(clampBoardPan({ x: 0, y: 0 }));
  }

  function saveMatch(match: MatchSummary) {
    setLastMatch(match);
    setStats((current) => {
      const merged = mergeStats(current);
      const next: StoredStats = {
        total: updateLevelStats(merged.total, match),
        levels: {
          ...merged.levels,
          [match.level]: updateLevelStats(merged.levels[match.level], match),
        },
        recent: [match, ...merged.recent].slice(0, 8),
      };
      AsyncStorage.setItem(STATS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }

  function finishGame(nextBoard: Board, nextStatus: GameStatus, nextClicks: number, nextChords: number, nextHints: number) {
    const actionWeight = Math.max(1, nextClicks + nextChords + nextHints);
    const nextEfficiency = countRevealedSafe(nextBoard) / actionWeight;
    const previousLevelStats = stats.levels[setup.key];
    const matchBase = {
      level: setup.key,
      levelLabel: setup.label,
      won: nextStatus === 'won',
      time: elapsed,
      clicks: nextClicks,
      chords: nextChords,
      hints: nextHints,
      efficiency: nextEfficiency,
    };
    const score = scoreMatch(matchBase, setup);
    const match: MatchSummary = {
      id: `${Date.now()}`,
      ...matchBase,
      score,
    };
    const isBestScore = score > previousLevelStats.bestScore;
    const isBestTime =
      match.won && (previousLevelStats.bestTime === null || match.time < previousLevelStats.bestTime);
    setCompletion({
      ...match,
      bestScore: Math.max(previousLevelStats.bestScore, score),
      bestTime: isBestTime ? match.time : previousLevelStats.bestTime,
      isBestScore,
      isBestTime,
    });
    setSetupOpen(false);
    setShowCompletion(true);
    saveMatch(match);
  }

  function setBoardAndMaybeFinish(
    nextBoard: Board,
    nextStatus: GameStatus,
    nextClicks: number,
    nextChords: number,
    nextHints: number,
    finalHint?: Hint,
  ) {
    if (nextStatus === 'won') {
      completeWinningBoard(nextBoard);
    }
    setBoard(nextBoard);
    setStatus(nextStatus);
    setClicks(nextClicks);
    setChords(nextChords);
    setHints(nextHints);
    setActiveHint(finalHint ?? null);
    if (nextStatus === 'won' || nextStatus === 'lost') {
      finishGame(nextBoard, nextStatus, nextClicks, nextChords, nextHints);
    }
  }

  function revealCell(row: number, col: number, fromHint = false) {
    if (status === 'won' || status === 'lost') {
      return;
    }

    const beforeHint = fromHint ? null : analyzeBoard(board, setup, status, stats, elapsed, clicks, chords);
    const baseBoard = status === 'ready' ? createBoard(setup, row, col, board) : cloneBoard(board);
    const result = revealMutable(baseBoard, row, col);
    if (result.changed === 0 && !result.hitMine) {
      return;
    }

    setLastInvalidChordAttempt(null);
    setSetupOpen(false);

    const nextClicks = clicks + (fromHint ? 0 : 1);
    if (result.hitMine) {
      const lossHint = makeLossReviewHint({
        beforeHint,
        action: 'open',
        target: { row, col },
        exploded: [{ row, col }],
      });
      setLastMoveReview('');
      revealAllMines(baseBoard);
      setBoardAndMaybeFinish(baseBoard, 'lost', nextClicks, chords, hints, lossHint);
      return;
    }

    if (beforeHint) {
      setLastMoveReview(reviewMove(beforeHint, 'open', { row, col }));
    }
    const nextStatus = didWin(baseBoard, setup) ? 'won' : 'playing';
    setBoardAndMaybeFinish(baseBoard, nextStatus, nextClicks, chords, hints);
  }

  function toggleFlag(row: number, col: number) {
    if (status === 'won' || status === 'lost') {
      return;
    }
    const beforeHint = analyzeBoard(board, setup, status, stats, elapsed, clicks, chords);
    const nextBoard = cloneBoard(board);
    const cell = nextBoard[row][col];
    if (cell.isRevealed) {
      return;
    }
    const isAddingFlag = !cell.isFlagged;
    cell.isFlagged = !cell.isFlagged;
    setBoard(nextBoard);
    setActiveHint(null);
    setLastInvalidChordAttempt(null);
    if (isAddingFlag) {
      setLastMoveReview(reviewMove(beforeHint, 'flag', { row, col }));
    }
  }

  function chordCell(row: number, col: number) {
    if (status !== 'playing') {
      return;
    }
    const beforeHint = analyzeBoard(board, setup, status, stats, elapsed, clicks, chords);
    const nextBoard = cloneBoard(board);
    const cell = nextBoard[row][col];
    if (!cell.isRevealed || cell.neighborMines === 0) {
      return;
    }
    const neighbors = getNeighbors(nextBoard, row, col);
    const flagCount = neighbors.filter((neighbor) => neighbor.isFlagged).length;
    if (flagCount < cell.neighborMines) {
      setLastInvalidChordAttempt({ row, col, needed: cell.neighborMines, flags: flagCount });
      return;
    }
    if (flagCount > cell.neighborMines) {
      setLastInvalidChordAttempt(null);
      const lossHint = makeLossReviewHint({
        beforeHint,
        action: 'chord',
        target: { row, col },
        chordValue: cell.neighborMines,
        chordFlags: flagCount,
      });
      setLastMoveReview('');
      revealAllMines(nextBoard);
      setBoardAndMaybeFinish(nextBoard, 'lost', clicks, chords + 1, hints, lossHint);
      return;
    }

    setLastInvalidChordAttempt(null);

    let hitMine = false;
    neighbors
      .filter((neighbor) => !neighbor.isFlagged && !neighbor.isRevealed)
      .forEach((neighbor) => {
        const result = revealMutable(nextBoard, neighbor.row, neighbor.col);
        hitMine = hitMine || result.hitMine;
      });

    const nextChords = chords + 1;
    if (hitMine) {
      const exploded = neighbors
        .filter((neighbor) => neighbor.isExploded)
        .map((neighbor) => ({ row: neighbor.row, col: neighbor.col }));
      const wrongFlags = neighbors
        .filter((neighbor) => neighbor.isFlagged && !neighbor.isMine)
        .map((neighbor) => ({ row: neighbor.row, col: neighbor.col }));
      const missingMines = neighbors
        .filter((neighbor) => neighbor.isMine && !neighbor.isFlagged)
        .map((neighbor) => ({ row: neighbor.row, col: neighbor.col }));
      const lossHint = makeLossReviewHint({
        beforeHint,
        action: 'chord',
        target: { row, col },
        exploded,
        wrongFlags,
        missingMines,
        chordValue: cell.neighborMines,
        chordFlags: flagCount,
      });
      setLastMoveReview('');
      revealAllMines(nextBoard);
      setBoardAndMaybeFinish(nextBoard, 'lost', clicks, nextChords, hints, lossHint);
      return;
    }

    setLastMoveReview(reviewMove(beforeHint, 'chord', { row, col }));
    const nextStatus = didWin(nextBoard, setup) ? 'won' : 'playing';
    setBoardAndMaybeFinish(nextBoard, nextStatus, clicks, nextChords, hints);
  }

  function handleCellPress(cell: Cell) {
    if (flagMode && !cell.isRevealed) {
      toggleFlag(cell.row, cell.col);
      return;
    }
    if (cell.isRevealed) {
      chordCell(cell.row, cell.col);
      return;
    }
    revealCell(cell.row, cell.col);
  }

  function openCoach() {
    if (!activeHint && lastInvalidChordAttempt) {
      setActiveHint(makeInvalidChordHint(lastInvalidChordAttempt));
      setLastInvalidChordAttempt(null);
    }
    setScreen('coach');
  }

  function requestHint() {
    if (activeHint?.layer === 'concept' && activeHint.targets.length > 0) {
      const tileHint = revealTileLayer(activeHint);
      setActiveHint(tileHint);
      focusBoardOnHint(tileHint);
      setScreen('game');
      return;
    }
    if (activeHint?.layer === 'tile') {
      focusBoardOnHint(activeHint);
      setScreen('game');
      return;
    }
    if (lastInvalidChordAttempt) {
      const hint = makeInvalidChordHint(lastInvalidChordAttempt);
      setActiveHint(hint);
      focusBoardOnHint(hint);
      setLastInvalidChordAttempt(null);
      setScreen('game');
      return;
    }
    const hint = analyzeBoard(board, setup, status, stats, elapsed, clicks, chords);
    setActiveHint(hint);
    focusBoardOnHint(hint);
    setHints((value) =>
      value + (hint.category === 'idle' || hint.category === 'postgame' || (hint.action === 'none' && hint.targets.length === 0) ? 0 : 1),
    );
    setScreen('game');
  }

  function choosePreset(key: Exclude<LevelKey, 'custom'>) {
    resetGame(PRESETS[key]);
    setSetupOpen(false);
    setScreen('game');
  }

  function applyCustom() {
    const nextSetup: Setup = {
      key: 'custom',
      label: 'Custom',
      rows: customRows,
      cols: customCols,
      mines: clamp(customMines, MIN_MINES, customMaxMines),
    };
    resetGame(nextSetup);
    setSetupOpen(false);
    setScreen('game');
  }

  function clearStats() {
    Alert.alert('Reset progress?', 'This clears local match history on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          const emptyStats = createStats();
          setStats(emptyStats);
          setLastMatch(null);
          AsyncStorage.setItem(STATS_KEY, JSON.stringify(emptyStats)).catch(() => undefined);
        },
      },
    ]);
  }

  function openSetupFromCompletion() {
    setShowCompletion(false);
    setScreen('game');
    setSetupOpen(true);
  }

  function openStatsFromCompletion() {
    setShowCompletion(false);
    setScreen('progress');
  }

  function openResultMenu() {
    if (!completion) {
      return;
    }
    setSetupOpen(false);
    setScreen('game');
    setShowCompletion(true);
  }

  function openCoachFromCompletion() {
    setShowCompletion(false);
    setScreen('coach');
  }

  function reviewCompletedBoard() {
    setShowCompletion(false);
    setScreen('game');
  }

  function renderCell(cell: Cell) {
    const canShowHint =
      status !== 'won' && (status !== 'lost' || currentHint.category === 'postgame');
    const isTargeted =
      currentHint.layer === 'tile' &&
      currentHint.targets.some((target) => target.row === cell.row && target.col === cell.col) &&
      canShowHint;
    const supportCoordinates =
      currentHint.supports.length > 0 || currentHint.layer === 'tile'
        ? currentHint.supports
        : currentHint.targets;
    const isSupported =
      supportCoordinates.some((target) => target.row === cell.row && target.col === cell.col) &&
      canShowHint;
    const isPulsing = isTargeted || isSupported;
    const content = cell.isRevealed
      ? cell.isMine
        ? '*'
        : cell.neighborMines > 0
          ? `${cell.neighborMines}`
          : ''
      : cell.isFlagged
        ? 'F'
        : '';

    return (
      <Pressable
        key={keyOf(cell.row, cell.col)}
        onLongPress={() => toggleFlag(cell.row, cell.col)}
        onPress={() => handleCellPress(cell)}
        style={[
          styles.cell,
          {
            width: cellSize,
            height: cellSize,
            borderRadius: Math.max(5, Math.floor(cellSize / 6)),
          },
          cell.isRevealed ? styles.cellOpen : styles.cellClosed,
          cell.isExploded && styles.cellExploded,
          cell.isWrongFlag && styles.cellWrong,
          isTargeted && styles.cellHint,
          isSupported && styles.cellSupportHint,
        ]}
      >
        {isPulsing && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.cellPulse,
              isSupported && styles.cellSupportPulse,
              {
                opacity: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.15, 0.65],
                }),
                transform: [
                  {
                    scale: pulseAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1.08],
                    }),
                  },
                ],
              },
            ]}
          />
        )}
        <Text
          style={[
            styles.cellText,
            { fontSize: Math.max(12, Math.floor(cellSize * 0.45)) },
            cell.isFlagged && styles.flagText,
            cell.isWrongFlag && styles.wrongFlagText,
            cell.isMine && styles.mineText,
            cell.isRevealed && !cell.isMine && { color: clueColors[cell.neighborMines] },
          ]}
        >
          {content}
        </Text>
      </Pressable>
    );
  }

  const statusText =
    status === 'ready' ? 'Ready' : status === 'playing' ? 'Sweeping' : status === 'won' ? 'Cleared' : 'Mine hit';
  const pageTitle = screen === 'coach' ? 'Coach' : screen === 'progress' ? 'Stats' : 'SweeperLab';
  const pageSubtitle =
    screen === 'setup'
      ? `${setup.label} - ${setup.rows} x ${setup.cols} - ${setup.mines} mines`
      : screen === 'coach'
        ? currentHint.category === 'idle'
          ? 'No coaching active'
          : `${formatGoal(currentHint.goal)} - ${currentHint.layer === 'tile' ? 'Tile' : 'Concept'}`
        : `${stats.total.wins} wins in ${stats.total.played} games`;

  return (
    <SafeAreaView style={[styles.safe, screen === 'game' && styles.safeGame]}>
      <StatusBar style={screen === 'game' ? 'light' : 'dark'} />
      <View style={[styles.app, screen === 'game' && styles.appGame]}>
        {screen === 'game' ? (
          <View style={styles.gameScreen}>
            <View style={styles.gameHud}>
              <CompactCounter value={formatCounter(minesLeft)} tone={minesLeft < 0 ? 'danger' : 'default'} />
              <View style={styles.hudButtons}>
                <Pressable
                  style={[styles.hudButton, (isSetupOpen || canOpenResultMenu) && styles.hudButtonActive]}
                  onPress={canOpenResultMenu ? openResultMenu : () => setSetupOpen((value) => !value)}
                >
                  <Text style={[styles.hudButtonText, (isSetupOpen || canOpenResultMenu) && styles.hudButtonTextActive]}>
                    {canOpenResultMenu ? 'END' : 'SET'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.hudButton, flagMode && styles.hudButtonActive]}
                  onPress={() => setFlagMode((value) => !value)}
                >
                  <Text style={[styles.hudButtonText, flagMode && styles.hudButtonTextActive]}>F</Text>
                </Pressable>
                <Pressable style={styles.hudButton} onPress={requestHint}>
                  <Text style={styles.hudButtonText}>?</Text>
                </Pressable>
                <Pressable style={styles.hudButton} onPress={() => resetGame()}>
                  <Text style={styles.hudButtonText}>NEW</Text>
                </Pressable>
              </View>
              <CompactCounter value={formatCounter(elapsed)} />
            </View>

            {isSetupOpen && (
              <View style={styles.setupOverlay}>
                <View style={styles.setupOverlayHeader}>
                  <View>
                    <Text style={styles.setupOverlayTitle}>{setup.label}</Text>
                    <Text style={styles.setupOverlayMeta}>
                      {statusText} - {setup.rows} x {setup.cols} - {setup.mines} mines - {formatPercent(progress)} open
                    </Text>
                  </View>
                  <Pressable style={styles.setupCloseButton} onPress={() => setSetupOpen(false)}>
                    <Text style={styles.setupCloseText}>Close</Text>
                  </Pressable>
                </View>

                <View style={styles.levelRowCompact}>
                  {(Object.keys(PRESETS) as Exclude<LevelKey, 'custom'>[]).map((key) => {
                    const preset = PRESETS[key];
                    const isActive = setup.key === key;
                    return (
                      <Pressable
                        key={key}
                        style={[styles.levelButtonCompact, isActive && styles.levelButtonActive]}
                        onPress={() => choosePreset(key)}
                      >
                        <Text style={[styles.levelLabel, isActive && styles.levelLabelActive]}>{preset.label}</Text>
                        <Text style={[styles.levelMeta, isActive && styles.levelMetaActive]}>
                          {preset.rows} x {preset.cols}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.setupStepperGrid}>
                  <View style={styles.setupStepperSlot}>
                    <Stepper label="Rows" value={customRows} min={MIN_ROWS} max={MAX_ROWS} onChange={setCustomRows} />
                  </View>
                  <View style={styles.setupStepperSlot}>
                    <Stepper label="Cols" value={customCols} min={MIN_COLS} max={MAX_COLS} onChange={setCustomCols} />
                  </View>
                  <View style={styles.setupStepperSlot}>
                    <Stepper
                      label="Mines"
                      value={customMines}
                      min={MIN_MINES}
                      max={customMaxMines}
                      onChange={setCustomMines}
                    />
                  </View>
                </View>

                <View style={styles.setupActionRow}>
                  <Pressable style={styles.customApplyCompact} onPress={applyCustom}>
                    <Text style={styles.customApplyText}>Apply Custom</Text>
                  </Pressable>
                  <Pressable style={styles.setupSecondaryButton} onPress={openCoach}>
                    <Text style={styles.setupSecondaryText}>Coach</Text>
                  </Pressable>
                  <Pressable style={styles.setupSecondaryButton} onPress={() => setScreen('progress')}>
                    <Text style={styles.setupSecondaryText}>Stats</Text>
                  </Pressable>
                </View>

                <Text style={styles.setupSectionLabel}>Grid Size</Text>
                <View style={styles.gridScaleRow}>
                  {GRID_SCALE_OPTIONS.map((option) => {
                    const isActive = option.key === gridScale;
                    return (
                      <Pressable
                        key={option.key}
                        style={[styles.gridScaleButton, isActive && styles.gridScaleButtonActive]}
                        onPress={() => setGridScale(option.key)}
                      >
                        <Text style={[styles.gridScaleText, isActive && styles.gridScaleTextActive]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.boardShell} onLayout={handleBoardLayout} {...panResponder.panHandlers}>
              <Animated.View
                style={[
                  styles.board,
                  {
                    width: boardPixelWidth,
                    height: boardPixelHeight,
                    transform: [
                      { translateX: boardPanAnim.x },
                      { translateY: boardPanAnim.y },
                    ],
                  },
                ]}
              >
                <View style={styles.boardFrame}>
                  {board.map((row, rowIndex) => (
                    <View key={`row-${rowIndex}`} style={styles.boardRow}>
                      {row.map(renderCell)}
                    </View>
                  ))}
                </View>
              </Animated.View>
              <View pointerEvents="none" style={styles.boardEdgeOverlay}>
                {edgeFeedback.top && <View style={[styles.boardEdgeIndicator, styles.boardEdgeTop]} />}
                {edgeFeedback.right && <View style={[styles.boardEdgeIndicator, styles.boardEdgeRight]} />}
                {edgeFeedback.bottom && <View style={[styles.boardEdgeIndicator, styles.boardEdgeBottom]} />}
                {edgeFeedback.left && <View style={[styles.boardEdgeIndicator, styles.boardEdgeLeft]} />}
              </View>
            </View>

            {showCompletion && completion && (
              <View style={styles.completionOverlay}>
                <View style={styles.completionPanel}>
                  <Text style={styles.completionKicker}>{completion.levelLabel}</Text>
                  <Text style={styles.completionTitle}>{completion.won ? 'Cleared' : 'Mine Hit'}</Text>
                  <Text style={styles.completionSubtitle}>
                    {completion.won ? 'Board solved.' : 'Run ended.'}
                  </Text>

                  <View style={styles.completionStats}>
                    <ResultStat label="Time" value={formatTime(completion.time)} />
                    <ResultStat label="Score" value={`${completion.score}`} />
                    <ResultStat label="Efficiency" value={completion.efficiency.toFixed(1)} />
                    <ResultStat label="Chords" value={`${completion.chords}`} />
                  </View>

                  <View style={styles.recordRow}>
                    <View style={styles.recordCard}>
                      <Text style={styles.recordLabel}>Best Score</Text>
                      <Text style={styles.recordValue}>{completion.bestScore}</Text>
                      {completion.isBestScore && <Text style={styles.recordBadge}>New record</Text>}
                    </View>
                    <View style={styles.recordCard}>
                      <Text style={styles.recordLabel}>Best Time</Text>
                      <Text style={styles.recordValue}>
                        {completion.bestTime === null ? '-' : formatTime(completion.bestTime)}
                      </Text>
                      {completion.isBestTime && <Text style={styles.recordBadge}>New record</Text>}
                    </View>
                  </View>

                  <View style={styles.completionMetaRow}>
                    <Text style={styles.completionMeta}>{completion.clicks} clicks</Text>
                    <Text style={styles.completionMeta}>{completion.hints} hints</Text>
                    <Text style={styles.completionMeta}>{formatPercent(progress)} open</Text>
                  </View>

                  <View style={styles.completionActions}>
                    <Pressable style={styles.completionPrimary} onPress={() => resetGame()}>
                      <Text style={styles.completionPrimaryText}>Retry</Text>
                    </Pressable>
                    <Pressable style={styles.completionButton} onPress={openSetupFromCompletion}>
                      <Text style={styles.completionButtonText}>Setup</Text>
                    </Pressable>
                    <Pressable style={styles.completionButton} onPress={openStatsFromCompletion}>
                      <Text style={styles.completionButtonText}>Stats</Text>
                    </Pressable>
                    <Pressable
                      style={styles.completionButton}
                      onPress={completion.won ? reviewCompletedBoard : openCoachFromCompletion}
                    >
                      <Text style={styles.completionButtonText}>{completion.won ? 'Review' : 'Coach'}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.pageScreen}>
            <View style={styles.pageHeader}>
              <View>
                <Text style={styles.kicker}>SweeperLab</Text>
                <Text style={styles.title}>{pageTitle}</Text>
                <Text style={styles.pageSubtitle}>{pageSubtitle}</Text>
              </View>
              <Pressable style={styles.newButton} onPress={() => setScreen('game')}>
                <Text style={styles.newButtonText}>Play</Text>
              </Pressable>
            </View>

            {screen === 'setup' && (
              <ScrollView style={styles.content} contentContainerStyle={styles.setupContent}>
                <View style={styles.setupSummary}>
                  <Text style={styles.sectionTitle}>Current Board</Text>
                  <Text style={styles.setupSummaryText}>
                    {setup.rows} rows, {setup.cols} columns, {setup.mines} mines
                  </Text>
                  <Pressable style={styles.primaryAction} onPress={() => resetGame()}>
                    <Text style={styles.primaryActionText}>Restart Current Board</Text>
                  </Pressable>
                </View>

                <Text style={styles.sectionTitle}>Difficulty</Text>
                <View style={styles.levelRow}>
                  {(Object.keys(PRESETS) as Exclude<LevelKey, 'custom'>[]).map((key) => {
                    const preset = PRESETS[key];
                    const isActive = setup.key === key;
                    return (
                      <Pressable
                        key={key}
                        style={[styles.levelButton, isActive && styles.levelButtonActive]}
                        onPress={() => choosePreset(key)}
                      >
                        <Text style={[styles.levelLabel, isActive && styles.levelLabelActive]}>{preset.label}</Text>
                        <Text style={[styles.levelMeta, isActive && styles.levelMetaActive]}>
                          {preset.rows} x {preset.cols}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.sectionTitle}>Custom Board</Text>
                <View style={styles.customPanel}>
                  <Stepper
                    label="Rows"
                    value={customRows}
                    min={MIN_ROWS}
                    max={MAX_ROWS}
                    onChange={setCustomRows}
                  />
                  <Stepper
                    label="Cols"
                    value={customCols}
                    min={MIN_COLS}
                    max={MAX_COLS}
                    onChange={setCustomCols}
                  />
                  <Stepper
                    label="Mines"
                    value={customMines}
                    min={MIN_MINES}
                    max={customMaxMines}
                    onChange={setCustomMines}
                  />
                  <Pressable style={styles.customApply} onPress={applyCustom}>
                    <Text style={styles.customApplyText}>Apply Custom Board</Text>
                  </Pressable>
                </View>

                <Text style={styles.sectionTitle}>Grid Size</Text>
                <View style={styles.gridScaleRowLight}>
                  {GRID_SCALE_OPTIONS.map((option) => {
                    const isActive = option.key === gridScale;
                    return (
                      <Pressable
                        key={option.key}
                        style={[styles.gridScaleButtonLight, isActive && styles.gridScaleButtonActive]}
                        onPress={() => setGridScale(option.key)}
                      >
                        <Text style={[styles.gridScaleTextLight, isActive && styles.gridScaleTextActive]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {screen === 'coach' && (
              <ScrollView style={styles.content} contentContainerStyle={styles.coachContent}>
                <View style={styles.coachHero}>
                  <Text style={styles.coachTitle}>{currentHint.title}</Text>
                  <View style={styles.coachMetaRow}>
                    <Text style={styles.coachPill}>{formatGoal(currentHint.goal)}</Text>
                    <Text style={styles.coachMetaText}>
                      {currentHint.risk === undefined ? `${currentHint.confidence}% confidence` : `${currentHint.risk}% risk`}
                    </Text>
                    <Text style={styles.coachMetaText}>
                      {currentHint.layer === 'tile' ? 'Tile shown' : 'Concept first'}
                    </Text>
                  </View>
                  <Text style={styles.coachMessage}>{currentHint.message}</Text>
                  {lastMoveReview.length > 0 && (
                    <View style={styles.moveReview}>
                      <Text style={styles.moveReviewLabel}>Last move</Text>
                      <Text style={styles.moveReviewText}>{lastMoveReview}</Text>
                    </View>
                  )}
                  <View style={styles.confidenceTrack}>
                    <View style={[styles.confidenceFill, { width: `${currentHint.confidence}%` }]} />
                  </View>
                  <Text style={styles.confidenceText}>{currentHint.confidence}% confidence</Text>
                  <View style={styles.coachActions}>
                    <Pressable style={styles.coachButton} onPress={canOpenResultMenu ? openResultMenu : requestHint}>
                      <Text style={styles.coachButtonText}>
                        {canOpenResultMenu
                          ? 'Result'
                          : currentHint.layer === 'concept' && currentHint.targets.length > 0
                            ? 'Show Tiles'
                            : 'Scan'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.coachButton,
                        currentHint.category === 'idle' && styles.coachButtonDisabled,
                      ]}
                      onPress={() => setScreen('game')}
                    >
                      <Text style={styles.coachButtonText}>Board</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.coachGrid}>
                  <CoachStat label="Clicks" value={`${clicks}`} />
                  <CoachStat label="Chords" value={`${chords}`} />
                  <CoachStat label="Hints" value={`${hints}`} />
                  <CoachStat label="Hidden" value={`${countHidden(board)}`} />
                </View>

                {lastMatch && (
                  <View style={styles.lastMatch}>
                    <Text style={styles.sectionTitle}>Last Match</Text>
                    <Text style={styles.lastMatchText}>
                      {lastMatch.won ? 'Win' : 'Loss'} on {lastMatch.levelLabel} in {formatTime(lastMatch.time)}.
                    </Text>
                    <Text style={styles.lastMatchText}>
                      Score {lastMatch.score} with {lastMatch.clicks} clicks, {lastMatch.chords} chords, and{' '}
                      {lastMatch.hints} hints.
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}

            {screen === 'progress' && (
              <ScrollView style={styles.content} contentContainerStyle={styles.progressContent}>
                <View style={styles.progressHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Career</Text>
                    <Text style={styles.progressBig}>
                      {stats.total.wins}/{stats.total.played}
                    </Text>
                  </View>
                  <Pressable style={styles.resetStatsButton} onPress={clearStats}>
                    <Text style={styles.resetStatsText}>Reset</Text>
                  </Pressable>
                </View>

                <View style={styles.statGrid}>
                  <CoachStat label="Best Score" value={`${stats.total.bestScore}`} />
                  <CoachStat
                    label="Win Rate"
                    value={stats.total.played ? formatPercent(stats.total.wins / stats.total.played) : '0%'}
                  />
                  <CoachStat
                    label="Avg Score"
                    value={stats.total.played ? `${Math.round(stats.total.totalScore / stats.total.played)}` : '0'}
                  />
                  <CoachStat label="Hints Used" value={`${stats.total.totalHints}`} />
                </View>

                {levelOrder.map((key) => {
                  const item = stats.levels[key];
                  return (
                    <View key={key} style={styles.levelStatRow}>
                      <View>
                        <Text style={styles.levelStatTitle}>
                          {key === 'beginner'
                            ? 'Beginner'
                            : key === 'intermediate'
                              ? 'Intermediate'
                              : key === 'expert'
                                ? 'Expert'
                                : 'Custom'}
                        </Text>
                        <Text style={styles.levelStatMeta}>
                          {item.wins} wins, {item.losses} losses
                        </Text>
                      </View>
                      <View style={styles.levelStatScore}>
                        <Text style={styles.levelStatScoreText}>{item.bestScore}</Text>
                        <Text style={styles.levelStatMeta}>best</Text>
                      </View>
                    </View>
                  );
                })}

                {stats.recent.length > 0 && (
                  <View style={styles.recentBlock}>
                    <Text style={styles.sectionTitle}>Recent</Text>
                    {stats.recent.map((match) => (
                      <View key={match.id} style={styles.recentRow}>
                        <Text style={styles.recentText}>
                          {match.won ? 'Win' : 'Loss'} {match.levelLabel}
                        </Text>
                        <Text style={styles.recentScore}>{match.score}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        )}

        {screen !== 'game' && (
          <View style={styles.screenNav}>
            {navItems.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => (item.key === 'coach' ? openCoach() : setScreen(item.key))}
                style={[styles.screenNavButton, screen === item.key && styles.screenNavButtonActive]}
              >
                <Text style={[styles.screenNavText, screen === item.key && styles.screenNavTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone === 'danger' && styles.metricDanger]}>{value}</Text>
    </View>
  );
}

function CompactCounter({ value, tone = 'default' }: { value: string; tone?: 'default' | 'danger' }) {
  return (
    <View style={[styles.compactCounter, tone === 'danger' && styles.compactCounterDanger]}>
      <Text style={styles.compactCounterText}>{value}</Text>
    </View>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultStat}>
      <Text style={styles.resultStatValue}>{value}</Text>
      <Text style={styles.resultStatLabel}>{label}</Text>
    </View>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable style={styles.stepperButton} onPress={() => onChange(clamp(value - 1, min, max))}>
          <Text style={styles.stepperButtonText}>-</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable style={styles.stepperButton} onPress={() => onChange(clamp(value + 1, min, max))}>
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CoachStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.coachStat}>
      <Text style={styles.coachStatValue}>{value}</Text>
      <Text style={styles.coachStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: brand.surface,
  },
  safeGame: {
    backgroundColor: brand.deep,
  },
  app: {
    flex: 1,
  },
  appGame: {
    backgroundColor: brand.deep,
  },
  pageScreen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  gameScreen: {
    backgroundColor: brand.deep,
    flex: 1,
    position: 'relative',
  },
  gameHud: {
    alignItems: 'center',
    backgroundColor: brand.deep,
    borderBottomColor: brand.deepMuted,
    borderBottomWidth: 1,
    columnGap: 8,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 7,
    zIndex: 4,
  },
  compactCounter: {
    alignItems: 'center',
    backgroundColor: brand.deep,
    borderColor: brand.primary,
    borderRadius: 4,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    minWidth: 74,
    paddingHorizontal: 5,
  },
  compactCounterDanger: {
    borderColor: brand.dangerDark,
  },
  compactCounterText: {
    color: brand.counterRed,
    fontFamily: 'monospace',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 32,
  },
  hudButtons: {
    columnGap: 6,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minWidth: 0,
  },
  hudButton: {
    alignItems: 'center',
    backgroundColor: brand.primary,
    borderColor: brand.tile,
    borderRadius: 4,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    minWidth: 38,
    paddingHorizontal: 7,
  },
  hudButtonActive: {
    backgroundColor: brand.primary,
    borderColor: brand.tile,
  },
  hudButtonText: {
    color: brand.offWhite,
    fontSize: 13,
    fontWeight: '900',
  },
  hudButtonTextActive: {
    color: brand.white,
  },
  setupOverlay: {
    backgroundColor: brand.paper,
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 6,
    left: 8,
    maxHeight: 360,
    padding: 10,
    position: 'absolute',
    right: 8,
    top: 66,
    zIndex: 5,
  },
  setupOverlayHeader: {
    alignItems: 'center',
    columnGap: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  setupOverlayTitle: {
    color: brand.text,
    fontSize: 16,
    fontWeight: '900',
  },
  setupOverlayMeta: {
    color: brand.mutedText,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  setupCloseButton: {
    alignItems: 'center',
    backgroundColor: brand.text,
    borderRadius: 6,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  setupCloseText: {
    color: brand.white,
    fontSize: 12,
    fontWeight: '900',
  },
  levelRowCompact: {
    columnGap: 6,
    flexDirection: 'row',
    marginBottom: 8,
  },
  levelButtonCompact: {
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  setupStepperGrid: {
    columnGap: 8,
    flexDirection: 'row',
    marginBottom: 9,
  },
  setupStepperSlot: {
    flex: 1,
    minWidth: 0,
  },
  setupActionRow: {
    columnGap: 8,
    flexDirection: 'row',
    marginBottom: 9,
  },
  customApplyCompact: {
    alignItems: 'center',
    backgroundColor: brand.primary,
    borderRadius: 7,
    flex: 1.35,
    height: 38,
    justifyContent: 'center',
  },
  setupSecondaryButton: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    height: 38,
    justifyContent: 'center',
  },
  setupSecondaryText: {
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
  },
  setupSectionLabel: {
    color: brand.mutedText,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  gridScaleRow: {
    columnGap: 6,
    flexDirection: 'row',
  },
  gridScaleButton: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.line,
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  gridScaleButtonActive: {
    backgroundColor: brand.primary,
    borderColor: brand.primary,
  },
  gridScaleText: {
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  gridScaleTextActive: {
    color: brand.white,
  },
  zoomPanelCompact: {
    alignItems: 'center',
    columnGap: 8,
    flexDirection: 'row',
  },
  zoomButtonCompact: {
    alignItems: 'center',
    backgroundColor: brand.text,
    borderRadius: 7,
    height: 34,
    justifyContent: 'center',
    width: 38,
  },
  zoomValueCompact: {
    color: brand.text,
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  gameTopBar: {
    alignItems: 'center',
    columnGap: 10,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  gameTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  gameKicker: {
    color: brand.tile,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  gameTitle: {
    color: brand.white,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0,
  },
  statusBadge: {
    alignItems: 'center',
    backgroundColor: brand.deepMuted,
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  statusBadgeText: {
    color: brand.paper,
    fontSize: 12,
    fontWeight: '900',
  },
  pageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  kicker: {
    color: brand.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: brand.text,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 0,
  },
  pageSubtitle: {
    color: brand.subtleText,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 3,
  },
  newButton: {
    alignItems: 'center',
    backgroundColor: brand.text,
    borderRadius: 8,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  newButtonText: {
    color: brand.white,
    fontSize: 15,
    fontWeight: '800',
  },
  newButtonDark: {
    alignItems: 'center',
    backgroundColor: brand.primary,
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  newButtonDarkText: {
    color: brand.white,
    fontSize: 13,
    fontWeight: '900',
  },
  metrics: {
    columnGap: 8,
    flexDirection: 'row',
    marginBottom: 12,
  },
  gameMetrics: {
    columnGap: 8,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  metric: {
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 62,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  metricLabel: {
    color: brand.subtleText,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: brand.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 5,
  },
  metricDanger: {
    color: brand.danger,
  },
  tabs: {
    backgroundColor: brand.line,
    borderRadius: 8,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    height: 38,
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: brand.white,
  },
  tabText: {
    color: brand.subtleText,
    fontSize: 14,
    fontWeight: '800',
  },
  tabTextActive: {
    color: brand.text,
  },
  content: {
    flex: 1,
  },
  setupContent: {
    paddingBottom: 20,
  },
  setupSummary: {
    backgroundColor: brand.text,
    borderRadius: 8,
    marginBottom: 16,
    padding: 16,
  },
  setupSummaryText: {
    color: brand.white,
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 24,
    marginBottom: 14,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: brand.primary,
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
  },
  primaryActionText: {
    color: brand.white,
    fontSize: 15,
    fontWeight: '900',
  },
  levelRow: {
    columnGap: 8,
    flexDirection: 'row',
    marginBottom: 10,
  },
  levelButton: {
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  levelButtonActive: {
    backgroundColor: brand.primary,
    borderColor: brand.primary,
  },
  levelLabel: {
    color: brand.text,
    fontSize: 13,
    fontWeight: '900',
  },
  levelLabelActive: {
    color: brand.white,
  },
  levelMeta: {
    color: brand.subtleText,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  levelMetaActive: {
    color: brand.paper,
  },
  customPanel: {
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    padding: 12,
    rowGap: 12,
  },
  stepper: {
    width: '100%',
  },
  stepperLabel: {
    color: brand.subtleText,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  stepperControls: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  stepperButton: {
    alignItems: 'center',
    backgroundColor: brand.surface,
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  stepperButtonText: {
    color: brand.text,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
  },
  stepperValue: {
    color: brand.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  customApply: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: brand.primary,
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  customApplyText: {
    color: brand.white,
    fontSize: 13,
    fontWeight: '900',
  },
  gridScaleRowLight: {
    columnGap: 8,
    flexDirection: 'row',
    marginBottom: 16,
  },
  gridScaleButtonLight: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  gridScaleTextLight: {
    color: brand.text,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  controls: {
    alignItems: 'center',
    columnGap: 8,
    flexDirection: 'row',
    marginBottom: 10,
  },
  gameControls: {
    alignItems: 'center',
    backgroundColor: brand.deep,
    columnGap: 8,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  controlButtonActive: {
    backgroundColor: brand.danger,
    borderColor: brand.danger,
  },
  controlText: {
    color: brand.text,
    fontSize: 14,
    fontWeight: '900',
  },
  controlTextActive: {
    color: brand.white,
  },
  controlButtonDark: {
    alignItems: 'center',
    backgroundColor: brand.deepMuted,
    borderColor: brand.primary,
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    minWidth: 50,
    paddingHorizontal: 12,
  },
  controlTextDark: {
    color: brand.white,
    fontSize: 14,
    fontWeight: '900',
  },
  zoomButton: {
    alignItems: 'center',
    backgroundColor: brand.text,
    borderRadius: 8,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  zoomText: {
    color: brand.white,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  zoomValue: {
    color: brand.subtleText,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  zoomValueDark: {
    color: brand.paper,
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  zoomPanel: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    columnGap: 10,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 10,
  },
  boardShell: {
    backgroundColor: brand.boardBoundary,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  boardEdgeOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  boardEdgeIndicator: {
    backgroundColor: brand.tile,
    opacity: 0.95,
    position: 'absolute',
  },
  boardEdgeTop: {
    height: 4,
    left: 0,
    right: 0,
    top: 0,
  },
  boardEdgeRight: {
    bottom: 0,
    right: 0,
    top: 0,
    width: 4,
  },
  boardEdgeBottom: {
    bottom: 0,
    height: 4,
    left: 0,
    right: 0,
  },
  boardEdgeLeft: {
    bottom: 0,
    left: 0,
    top: 0,
    width: 4,
  },
  boardScroll: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    minWidth: '100%',
  },
  boardVerticalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
  },
  board: {
    position: 'absolute',
  },
  boardFrame: {
    backgroundColor: brand.deep,
    borderColor: brand.line,
    borderRadius: 6,
    borderWidth: BOARD_FRAME_WIDTH,
    overflow: 'hidden',
  },
  boardRow: {
    flexDirection: 'row',
  },
  cell: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
    margin: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  cellClosed: {
    backgroundColor: brand.primary,
    borderColor: brand.tile,
  },
  cellOpen: {
    backgroundColor: brand.surface,
    borderColor: brand.line,
  },
  cellExploded: {
    backgroundColor: brand.danger,
    borderColor: brand.danger,
  },
  cellWrong: {
    backgroundColor: brand.white,
    borderColor: brand.line,
    borderWidth: 1,
  },
  cellHint: {
    borderColor: brand.primary,
    borderWidth: 3,
  },
  cellSupportHint: {
    borderColor: brand.tile,
    borderWidth: 3,
  },
  cellPulse: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: brand.primary,
    borderColor: brand.tile,
    borderRadius: 4,
    borderWidth: 2,
  },
  cellSupportPulse: {
    backgroundColor: brand.tile,
    borderColor: brand.paper,
  },
  cellText: {
    color: brand.white,
    fontWeight: '900',
    textAlign: 'center',
  },
  flagText: {
    color: brand.offWhite,
  },
  wrongFlagText: {
    color: brand.text,
  },
  mineText: {
    color: brand.white,
  },
  completionOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: brand.overlay,
    justifyContent: 'center',
    padding: 14,
    zIndex: 30,
  },
  completionPanel: {
    backgroundColor: brand.paper,
    borderColor: brand.line,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 430,
    padding: 16,
    width: '100%',
  },
  completionKicker: {
    color: brand.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  completionTitle: {
    color: brand.text,
    fontSize: 32,
    fontWeight: '900',
  },
  completionSubtitle: {
    color: brand.mutedText,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  completionStats: {
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    rowGap: 8,
  },
  resultStat: {
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 68,
    padding: 10,
  },
  resultStatValue: {
    color: brand.text,
    fontSize: 22,
    fontWeight: '900',
  },
  resultStatLabel: {
    color: brand.subtleText,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  recordRow: {
    columnGap: 8,
    flexDirection: 'row',
    marginTop: 8,
  },
  recordCard: {
    backgroundColor: brand.text,
    borderColor: brand.primary,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 82,
    padding: 10,
  },
  recordLabel: {
    color: brand.tile,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  recordValue: {
    color: brand.white,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  recordBadge: {
    color: brand.primary,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  completionMetaRow: {
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    rowGap: 6,
  },
  completionMeta: {
    backgroundColor: brand.line,
    borderRadius: 6,
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  completionActions: {
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    rowGap: 8,
  },
  completionPrimary: {
    alignItems: 'center',
    backgroundColor: brand.primary,
    borderRadius: 8,
    flexBasis: '48%',
    flexGrow: 1,
    height: 44,
    justifyContent: 'center',
  },
  completionPrimaryText: {
    color: brand.white,
    fontSize: 15,
    fontWeight: '900',
  },
  completionButton: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '23%',
    flexGrow: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  completionButtonText: {
    color: brand.text,
    fontSize: 13,
    fontWeight: '900',
  },
  coachContent: {
    paddingBottom: 18,
  },
  coachHero: {
    backgroundColor: brand.text,
    borderRadius: 8,
    padding: 18,
  },
  coachTitle: {
    color: brand.paper,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 10,
  },
  coachMetaRow: {
    alignItems: 'center',
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  coachPill: {
    backgroundColor: brand.tile,
    borderRadius: 8,
    color: brand.text,
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  coachMetaText: {
    color: brand.paper,
    fontSize: 12,
    fontWeight: '900',
  },
  coachMessage: {
    color: brand.white,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
  },
  moveReview: {
    backgroundColor: brand.deepMuted,
    borderColor: brand.primary,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 14,
    padding: 12,
  },
  moveReviewLabel: {
    color: brand.primary,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  moveReviewText: {
    color: brand.paper,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  confidenceTrack: {
    backgroundColor: brand.line,
    borderRadius: 8,
    height: 10,
    marginTop: 18,
    overflow: 'hidden',
  },
  confidenceFill: {
    backgroundColor: brand.primary,
    height: 10,
  },
  confidenceText: {
    color: brand.paper,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
    textTransform: 'uppercase',
  },
  coachActions: {
    columnGap: 10,
    flexDirection: 'row',
    marginTop: 16,
  },
  coachButton: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderRadius: 8,
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  coachButtonDisabled: {
    opacity: 0.45,
  },
  coachButtonText: {
    color: brand.text,
    fontSize: 15,
    fontWeight: '900',
  },
  coachGrid: {
    columnGap: 8,
    flexDirection: 'row',
    marginTop: 12,
  },
  coachStat: {
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 76,
    padding: 10,
  },
  coachStatValue: {
    color: brand.text,
    fontSize: 23,
    fontWeight: '900',
  },
  coachStatLabel: {
    color: brand.subtleText,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
    textTransform: 'uppercase',
  },
  lastMatch: {
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  sectionTitle: {
    color: brand.text,
    fontSize: 17,
    fontWeight: '900',
    marginBottom: 8,
  },
  lastMatchText: {
    color: brand.mutedText,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  progressContent: {
    paddingBottom: 20,
  },
  progressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  progressBig: {
    color: brand.text,
    fontSize: 34,
    fontWeight: '900',
  },
  resetStatsButton: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  resetStatsText: {
    color: brand.danger,
    fontSize: 14,
    fontWeight: '900',
  },
  statGrid: {
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  levelStatRow: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    padding: 14,
  },
  levelStatTitle: {
    color: brand.text,
    fontSize: 16,
    fontWeight: '900',
  },
  levelStatMeta: {
    color: brand.subtleText,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  levelStatScore: {
    alignItems: 'flex-end',
  },
  levelStatScoreText: {
    color: brand.primary,
    fontSize: 20,
    fontWeight: '900',
  },
  recentBlock: {
    marginTop: 16,
  },
  recentRow: {
    alignItems: 'center',
    backgroundColor: brand.white,
    borderColor: brand.tile,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    padding: 12,
  },
  recentText: {
    color: brand.text,
    fontSize: 14,
    fontWeight: '800',
  },
  recentScore: {
    color: brand.primary,
    fontSize: 15,
    fontWeight: '900',
  },
  screenNav: {
    backgroundColor: brand.surface,
    borderTopColor: brand.tile,
    borderTopWidth: 1,
    columnGap: 6,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  screenNavDark: {
    backgroundColor: brand.deep,
    borderTopColor: brand.primary,
  },
  screenNavButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 42,
    justifyContent: 'center',
  },
  screenNavButtonActive: {
    backgroundColor: brand.primary,
  },
  screenNavText: {
    color: brand.subtleText,
    fontSize: 13,
    fontWeight: '900',
  },
  screenNavTextActive: {
    color: brand.white,
  },
});
