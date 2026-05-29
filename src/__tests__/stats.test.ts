import { createStats, mergeStats, updateLevelStats } from '../storage/stats';

describe('stats storage helpers', () => {
  test('createStats initializes every tracked level', () => {
    const stats = createStats();

    expect(stats.total.played).toBe(0);
    expect(stats.levels.beginner.bestTime).toBeNull();
    expect(stats.levels.intermediate.bestScore).toBe(0);
    expect(stats.levels.expert.wins).toBe(0);
    expect(stats.levels.custom.losses).toBe(0);
  });

  test('updateLevelStats records wins, score, time, clicks, and hints', () => {
    const current = createStats().levels.beginner;
    const next = updateLevelStats(current, {
      id: 'match-1',
      level: 'beginner',
      levelLabel: 'Beginner',
      won: true,
      time: 42,
      clicks: 11,
      chords: 2,
      hints: 1,
      efficiency: 3.2,
      score: 900,
    });

    expect(next.played).toBe(1);
    expect(next.wins).toBe(1);
    expect(next.bestTime).toBe(42);
    expect(next.bestScore).toBe(900);
    expect(next.totalClicks).toBe(11);
    expect(next.totalHints).toBe(1);
  });

  test('mergeStats fills missing stored fields with defaults', () => {
    const merged = mergeStats({
      total: { played: 2, wins: 1 },
      levels: {
        beginner: { played: 1, bestScore: 500 },
      },
      recent: [{ id: 'recent' }],
    });

    expect(merged.total.played).toBe(2);
    expect(merged.total.losses).toBe(0);
    expect(merged.levels.beginner.bestScore).toBe(500);
    expect(merged.levels.expert.played).toBe(0);
    expect(merged.recent).toHaveLength(1);
  });
});
