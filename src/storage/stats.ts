import type { LevelKey, LevelStats, MatchSummary, StoredStats } from '../game/types';

const STATS_KEY = 'sweeperlab.stats.v1';

const EMPTY_LEVEL_STATS: LevelStats = {
  played: 0,
  wins: 0,
  losses: 0,
  bestTime: null,
  bestScore: 0,
  totalScore: 0,
  totalTime: 0,
  totalClicks: 0,
  totalHints: 0,
};

function createStats(): StoredStats {
  return {
    total: { ...EMPTY_LEVEL_STATS },
    levels: {
      beginner: { ...EMPTY_LEVEL_STATS },
      intermediate: { ...EMPTY_LEVEL_STATS },
      expert: { ...EMPTY_LEVEL_STATS },
      custom: { ...EMPTY_LEVEL_STATS },
    },
    recent: [],
  };
}

function updateLevelStats(current: LevelStats, match: MatchSummary): LevelStats {
  const nextPlayed = current.played + 1;
  return {
    played: nextPlayed,
    wins: current.wins + (match.won ? 1 : 0),
    losses: current.losses + (match.won ? 0 : 1),
    bestTime:
      match.won && (current.bestTime === null || match.time < current.bestTime) ? match.time : current.bestTime,
    bestScore: Math.max(current.bestScore, match.score),
    totalScore: current.totalScore + match.score,
    totalTime: current.totalTime + match.time,
    totalClicks: current.totalClicks + match.clicks,
    totalHints: current.totalHints + match.hints,
  };
}

function mergeStats(value: unknown): StoredStats {
  const fallback = createStats();
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  const parsed = value as Partial<StoredStats>;
  return {
    total: { ...fallback.total, ...parsed.total },
    levels: {
      beginner: { ...fallback.levels.beginner, ...parsed.levels?.beginner },
      intermediate: { ...fallback.levels.intermediate, ...parsed.levels?.intermediate },
      expert: { ...fallback.levels.expert, ...parsed.levels?.expert },
      custom: { ...fallback.levels.custom, ...parsed.levels?.custom },
    },
    recent: Array.isArray(parsed.recent) ? parsed.recent.slice(0, 8) : [],
  };
}

export { STATS_KEY, EMPTY_LEVEL_STATS, createStats, updateLevelStats, mergeStats };
