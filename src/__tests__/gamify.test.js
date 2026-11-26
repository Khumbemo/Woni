/**
 * XP, levels, badges, the daily challenge and the study calendar.
 */
import { describe, it, expect } from 'vitest';
import {
  XP, levelFor, aggregateDays, badgeStatus, bestStreak, pickChallenge, calendarCells, dayKey, keyToTime,
} from '../gamify.js';
import { motivationMixin } from '../views/motivation.js';

describe('levels', () => {
  it('needs 50 more XP for each level than the last', () => {
    expect(levelFor(0)).toMatchObject({ level: 1, title: 'Novice', into: 0, needed: 50, toNext: 50 });
    expect(levelFor(49).level).toBe(1);
    expect(levelFor(50)).toMatchObject({ level: 2, title: 'Learner', into: 0, needed: 100 });
    expect(levelFor(149).level).toBe(2);
    expect(levelFor(150)).toMatchObject({ level: 3, into: 0, needed: 150 });
    expect(levelFor(300).level).toBe(4);
  });

  it('copes with bad input and very high XP', () => {
    expect(levelFor(undefined).level).toBe(1);
    expect(levelFor(-20).level).toBe(1);
    const high = levelFor(1e6);
    expect(high.level).toBe(200);
    expect(high.title).toBe('Luminary');
  });
});

describe('activity', () => {
  it('sums records from several devices by day', () => {
    const days = aggregateDays([
      { date: '2026-11-20', xp: 30, answered: 3, correct: 3, cards: 0, seconds: 0 },
      { date: '2026-11-20', xp: 25, cards: 5, goalMet: true },
      { date: '2026-11-21', xp: 10, challenge: true },
      null, { xp: 5 },
    ]);
    expect(days.get('2026-11-20')).toMatchObject({ xp: 55, answered: 3, correct: 3, cards: 5, goalMet: true, challenge: false });
    expect(days.get('2026-11-21')).toMatchObject({ xp: 10, challenge: true });
    expect(days.size).toBe(2);
  });

  it('dayKey uses the local date and round-trips', () => {
    const t = new Date(2026, 0, 5, 23, 59).getTime();
    expect(dayKey(t)).toBe('2026-01-05');
    expect(keyToTime('2026-01-05')).toBe(new Date(2026, 0, 5).getTime());
  });

  it('bestStreak counts the longest run of consecutive days, across month ends and DST', () => {
    expect(bestStreak([])).toBe(0);
    expect(bestStreak(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-03'])).toBe(3);
    expect(bestStreak(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-28'])).toBe(3);
    expect(bestStreak(['2026-10-24', '2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02'])).toBe(3);
  });
});

describe('badges', () => {
  const none = { answered: 0, correct: 0, cards: 0, streak: 0, bestStreak: 0, goalDays: 0, challenges: 0, perfectTests: 0, focusSessions: 0 };

  it('starts with everything locked', () => {
    expect(badgeStatus(none).every(b => !b.unlocked)).toBe(true);
  });

  it('unlocks badges at their thresholds', () => {
    const unlocked = s => badgeStatus({ ...none, ...s }).filter(b => b.unlocked).map(b => b.id);
    expect(unlocked({ answered: 1 })).toEqual(['first-steps']);
    expect(unlocked({ bestStreak: 7 })).toEqual(['on-fire', 'week-warrior']);
    expect(unlocked({ correct: 99 })).toEqual([]);
    expect(unlocked({ correct: 100 })).toEqual(['centurion']);
    expect(unlocked({ cards: 100, goalDays: 7, challenges: 5, focusSessions: 10, perfectTests: 1 }))
      .toEqual(['perfect', 'card-shark', 'goal-getter', 'challenger', 'deep-focus']);
  });

  it('every badge has a name, icon and hint, and ids are unique', () => {
    const list = badgeStatus(none);
    expect(new Set(list.map(b => b.id)).size).toBe(list.length);
    for (const b of list) expect(b.name && b.icon && b.hint).toBeTruthy();
  });
});

describe('daily challenge', () => {
  const q = (topic, n, extra = {}) => ({ text: `${topic} ${n}`, topic, ...extra });
  const seq = () => { let i = 0; return () => ((i++ * 0.37) % 1); };

  it('mixes topics, weakest first', () => {
    const questions = [q('Genetics', 1), q('Genetics', 2), q('Genetics', 3), q('Ecology', 1), q('Ecology', 2), q('Cell', 1), q('Cell', 2)];
    const topics = [{ name: 'Genetics', mastery: 80 }, { name: 'Ecology', mastery: 10 }, { name: 'Cell', mastery: 40 }];
    const picked = pickChallenge(questions, topics, 5, seq());
    expect(picked.map(x => x.topic)).toEqual(['Ecology', 'Cell', 'Genetics', 'Ecology', 'Cell']);
  });

  it('leaves out reported questions and never repeats one', () => {
    const questions = [q('A', 1), q('A', 2, { flagged: true }), q('B', 1)];
    const picked = pickChallenge(questions, [], 5, seq());
    expect(picked.map(x => x.text).sort()).toEqual(['A 1', 'B 1']);
  });

  it('handles an empty bank and questions without a topic', () => {
    expect(pickChallenge([], [], 5)).toEqual([]);
    expect(pickChallenge([{ text: 'x' }], [], 5)).toHaveLength(1);
  });
});

describe('study calendar', () => {
  it('lays out 12 Monday-first weeks ending this week, with intensity levels', () => {
    const now = new Date(2026, 10, 25, 15).getTime(); // Wednesday 25 Nov 2026
    const days = aggregateDays([
      { date: '2026-11-25', xp: 60 },
      { date: '2026-11-24', xp: 20 },
      { date: '2026-11-23', xp: 1 },
    ]);
    const cells = calendarCells(days, 50, 12, now);
    expect(cells).toHaveLength(84);
    expect(new Date(keyToTime(cells[0].date)).getDay()).toBe(1); // Monday
    const by = Object.fromEntries(cells.map(c => [c.date, c]));
    expect(by['2026-11-25']).toMatchObject({ level: 4, future: false });
    expect(by['2026-11-24'].level).toBe(2);
    expect(by['2026-11-23'].level).toBe(1);
    expect(by['2026-11-22'].level).toBe(0);
    expect(by['2026-11-26'].future).toBe(true);
    expect(cells.at(-1).date).toBe('2026-11-29'); // Sunday of this week
  });
});

describe('activity log', () => {
  /** The motivation mixin over an in-memory store, with a fixed clock. */
  function fakeApp(now = new Date(2026, 10, 25, 10).getTime()) {
    const rows = new Map();
    const celebrations = [];
    const local = new Map();
    globalThis.localStorage = {
      getItem: k => (local.has(k) ? local.get(k) : null),
      setItem: (k, v) => local.set(k, String(v)),
      removeItem: k => local.delete(k),
    };
    return {
      ...motivationMixin,
      _activityQueue: Promise.resolve(),
      now: () => now,
      state: { db: {}, currentView: 'practice' },
      dbGet: async (_s, id) => structuredClone(rows.get(id)),
      dbPut: async (_s, r) => {
        await new Promise(res => setTimeout(res, Math.random() * 3)); // writes take a little while
        rows.set(r.id, structuredClone(r));
      },
      dbGetAll: async s => (s === 'progress' ? [...rows.values()].map(r => structuredClone(r)) : []),
      showToast: () => {},
      celebrate: m => celebrations.push(m),
      updateMotivation: () => {},
      rows, celebrations,
    };
  }

  it('loses no XP when many answers are logged at once', async () => {
    const app = fakeApp();
    await Promise.all(Array.from({ length: 20 }, () => app.logActivity({ xp: XP.correct, answered: 1, correct: 1 })));
    const [rec] = app.rows.values();
    expect(rec).toMatchObject({ xp: 200, answered: 20, correct: 20 });
    expect(rec.id).toMatch(/^day:2026-11-25:[a-z0-9]+$/);
  });

  it('celebrates the daily goal once, and the first badge', async () => {
    const app = fakeApp();
    for (let i = 0; i < 6; i++) await app.logActivity({ xp: 10, answered: 1, correct: 1 });
    expect(app.celebrations.filter(c => c.startsWith('Daily goal reached'))).toHaveLength(1);
    expect(app.celebrations).toContain('Badge unlocked: 🌱 First Steps!');
    expect([...app.rows.values()][0].goalMet).toBe(true);
  });

  it('adds up XP from other devices for the daily goal and streak', async () => {
    const app = fakeApp();
    app.rows.set('day:2026-11-25:otherdev', { id: 'day:2026-11-25:otherdev', date: '2026-11-25', xp: 45 });
    app.rows.set('day:2026-11-24:otherdev', { id: 'day:2026-11-24:otherdev', date: '2026-11-24', xp: 10 });
    await app.logActivity({ xp: 10 });
    expect(app.celebrations.some(c => c.startsWith('Daily goal reached: 55 XP'))).toBe(true);
    const stats = await app.getStudyStats();
    expect(stats).toMatchObject({ totalXp: 65, streak: 2, bestStreak: 2 });
  });

  it('daily goal choices are limited to the offered values', () => {
    const app = fakeApp();
    expect(app.getDailyGoal()).toBe(50);
    app.setDailyGoal('100');
    expect(app.getDailyGoal()).toBe(100);
    app.setDailyGoal('7');
    expect(app.getDailyGoal()).toBe(100);
    localStorage.setItem('woni_daily_goal', 'junk');
    expect(app.getDailyGoal()).toBe(50);
  });
});
