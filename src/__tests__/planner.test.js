/**
 * Daily quests, planner grouping, the exam study plan and the mixed question formats.
 */
import { describe, it, expect } from 'vitest';
import {
  QUEST_POOL, QUEST_XP, questsForDay, questProgress, seededRandom, groupTasks, buildStudyPlan, daysBetween, PLAN_MAX_DAYS,
} from '../planner.js';
import {
  makeTrueFalse, makeTyped, makeMatch, makeMulti, checkTyped, buildMixedSession, correctText, normalise,
} from '../formats.js';
import { motivationMixin } from '../views/motivation.js';

describe('daily quests', () => {
  const all = { questions: true, cards: true, tasks: true };

  it('picks the same 3 quests for a date on every device, and different ones on other days', () => {
    const a = questsForDay('2026-11-26', all).map(q => q.id);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(questsForDay('2026-11-26', all).map(q => q.id)).toEqual(a);
    const week = new Set(Array.from({ length: 7 }, (_, i) => questsForDay(`2026-12-0${i + 1}`, all).map(q => q.id).join()));
    expect(week.size).toBeGreaterThan(3);
  });

  it('only offers quests the student has content for', () => {
    for (let d = 1; d <= 28; d++) {
      const ids = questsForDay(`2026-02-${String(d).padStart(2, '0')}`, { questions: true }).map(q => q.id);
      expect(ids).not.toContain('cards');
      expect(ids).not.toContain('task');
    }
    expect(questsForDay('2026-11-26', {}).map(q => q.id)).toEqual(['focus']);
  });

  it('measures progress from the day totals, booleans included', () => {
    const quests = QUEST_POOL.filter(q => ['answer', 'challenge', 'combo'].includes(q.id));
    const p = questProgress(quests, { answered: 20, challenge: true, bestCombo: 3 });
    expect(p.map(q => [q.id, q.value, q.done])).toEqual([['answer', 15, true], ['challenge', 1, true], ['combo', 3, false]]);
  });

  it('seededRandom is deterministic and in [0, 1)', () => {
    const a = seededRandom('x'), b = seededRandom('x');
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true);
  });
});

describe('quest rewards', () => {
  function fakeApp(date = new Date(2026, 10, 26, 10).getTime()) {
    const rows = new Map();
    const local = new Map();
    globalThis.localStorage = { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)), removeItem: k => local.delete(k) };
    const toasts = [];
    return {
      ...motivationMixin,
      _activityQueue: Promise.resolve(),
      now: () => date,
      state: { db: {}, currentView: 'practice' },
      dbGet: async (_s, id) => structuredClone(rows.get(id)),
      dbPut: async (_s, r) => { rows.set(r.id, structuredClone(r)); },
      dbGetAll: async () => [...rows.values()].map(r => structuredClone(r)),
      dbCount: async () => 0, // no questions, cards or tasks: only the focus quest is offered
      showToast: () => {},
      celebrate: m => toasts.push(m),
      updateMotivation: () => {},
      rows, toasts,
    };
  }

  it('pays a finished quest once, counts it towards the goal, and records it', async () => {
    const app = fakeApp();
    expect((await app.getTodayQuests()).map(q => q.id)).toEqual(['focus']);
    await app.logActivity({ xp: 25, focus: 1 });
    await app.logActivity({ xp: 25, focus: 1 });
    const [rec] = app.rows.values();
    expect(rec.xp).toBe(50 + QUEST_XP);
    expect(rec.questsDone).toEqual(['focus']);
    expect(app.toasts.filter(t => t.startsWith('Quest complete'))).toEqual([`Quest complete: Finish a 25-minute focus session (+${QUEST_XP} XP)`]);
    expect(app.toasts.some(t => t.startsWith('Daily goal reached: 70 XP'))).toBe(true); // 25 + 20 bonus, then +25
    expect((await app.getTodayQuests())[0]).toMatchObject({ done: true, value: 1 });
  });

  it('does not pay again for a quest another device already completed', async () => {
    const app = fakeApp();
    app.rows.set('day:2026-11-26:other', { id: 'day:2026-11-26:other', date: '2026-11-26', xp: 45, focus: 1, questsDone: ['focus'] });
    await app.logActivity({ xp: 25, focus: 1 });
    const mine = [...app.rows.values()].find(r => r.id !== 'day:2026-11-26:other');
    expect(mine.xp).toBe(25);
    expect(mine.questsDone).toBeUndefined();
  });

  it('keeps the best combo of the day', async () => {
    const app = fakeApp();
    await app.logActivity({ xp: 10, bestCombo: 4 });
    await app.logActivity({ xp: 10, bestCombo: 2 });
    expect([...app.rows.values()][0].bestCombo).toBe(4);
  });
});

describe('planner tasks', () => {
  it('groups tasks into overdue, today, upcoming, no date and done', () => {
    const tasks = [
      { id: 1, title: 'a', due: '2026-11-20' },
      { id: 2, title: 'b', due: '2026-11-26' },
      { id: 3, title: 'c', due: '2026-12-01' },
      { id: 4, title: 'd', due: '2026-11-28' },
      { id: 5, title: 'e', due: null, createdAt: 2 },
      { id: 6, title: 'f', createdAt: 1 },
      { id: 7, title: 'g', due: '2026-11-20', done: true, doneAt: 5 },
      { id: 8, title: 'h', done: true, doneAt: 9 },
      null,
    ];
    const g = groupTasks(tasks, '2026-11-26');
    expect(g.overdue.map(t => t.id)).toEqual([1]);
    expect(g.today.map(t => t.id)).toEqual([2]);
    expect(g.upcoming.map(t => t.id)).toEqual([4, 3]);
    expect(g.someday.map(t => t.id)).toEqual([6, 5]);
    expect(g.done.map(t => t.id)).toEqual([8, 7]);
  });

  it('daysBetween counts calendar days, also across DST changes', () => {
    expect(daysBetween('2026-11-26', '2026-11-26')).toBe(0);
    expect(daysBetween('2026-11-26', '2027-01-01')).toBe(36);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2026-11-01', '2026-10-25')).toBe(-7);
  });
});

describe('study plan', () => {
  const topics = [
    { name: 'Genetics', frequency: 80, mastery: 20 },   // important, weak
    { name: 'Ecology', frequency: 40, mastery: 30 },
    { name: 'Cell Biology', frequency: 60, mastery: 90 }, // nearly mastered
  ];

  it('plans every day up to the exam, with weekly mocks and revision at the end', () => {
    const plan = buildStudyPlan(topics, '2026-11-26', '2026-12-17'); // 21 days
    expect(plan).toHaveLength(21);
    expect(plan[0].due).toBe('2026-11-26');
    expect(plan.at(-1).due).toBe('2026-12-16');
    expect(plan.filter(p => p.kind === 'mock').map(p => p.due)).toEqual(['2026-12-02', '2026-12-09']);
    expect(plan.at(-2)).toMatchObject({ kind: 'review', title: 'Revise weakest topics: Genetics, Ecology, Cell Biology' });
    expect(plan.at(-1).title).toMatch(/rest well/);
  });

  it('gives weak, important topics more days, spread out rather than in a block', () => {
    const plan = buildStudyPlan(topics, '2026-11-26', '2027-01-20');
    const days = plan.filter(p => p.kind === 'topic').map(p => p.topic);
    const count = t => days.filter(d => d === t).length;
    expect(count('Genetics')).toBeGreaterThan(count('Ecology'));
    expect(count('Ecology')).toBeGreaterThan(count('Cell Biology'));
    expect(count('Cell Biology')).toBeGreaterThan(0);
    let longest = 0, run = 0;
    days.forEach((t, i) => { run = t === days[i - 1] ? run + 1 : 1; longest = Math.max(longest, run); });
    expect(longest).toBeLessThanOrEqual(2);
  });

  it('caps a far-off exam at the plan length, without revision days', () => {
    const plan = buildStudyPlan(topics, '2026-11-26', '2027-11-26');
    expect(plan).toHaveLength(PLAN_MAX_DAYS);
    expect(plan.some(p => p.kind === 'review')).toBe(false);
  });

  it('returns nothing for a past or same-day exam or no topics', () => {
    expect(buildStudyPlan(topics, '2026-11-26', '2026-11-26')).toEqual([]);
    expect(buildStudyPlan(topics, '2026-11-26', '2026-11-01')).toEqual([]);
    expect(buildStudyPlan([], '2026-11-26', '2026-12-26')).toEqual([]);
    expect(buildStudyPlan([{ frequency: 5 }], '2026-11-26', '2026-12-26')).toEqual([]);
  });
});

describe('question formats', () => {
  const q = (text, answer, options = ['Primase', 'DNA ligase', 'Helicase', 'Topoisomerase I'], extra = {}) =>
    ({ text, options, answer, topic: 'Molecular Biology', exam: 'csir_net', ...extra });
  const rnd = seed => seededRandom(seed);

  it('correctText handles letters, option text and bad answers', () => {
    expect(correctText(q('x', 'C'))).toBe('Helicase');
    expect(correctText(q('x', 'Helicase'))).toBe('Helicase');
    expect(correctText(q('x', 'Z'))).toBeNull();
  });

  it('true/false proposes the right answer about half the time, otherwise a wrong option', () => {
    const r = rnd('tf');
    const items = Array.from({ length: 200 }, () => makeTrueFalse(q('Unwinds DNA?', 'C'), r));
    const trues = items.filter(i => i.truth);
    expect(trues.length).toBeGreaterThan(70);
    expect(trues.length).toBeLessThan(130);
    for (const i of items) expect(i.truth).toBe(i.proposed === 'Helicase');
    expect(makeTrueFalse(q('x', 'C', ['Helicase']), r)).toBeNull(); // no wrong option to propose
    expect(makeTrueFalse(q('x', 'C', undefined, { flagged: true }), r)).toBeNull();
  });

  it('type-the-answer only for short, specific answers', () => {
    expect(makeTyped(q('x', 'C'))).toMatchObject({ kind: 'typed', answer: 'Helicase' });
    expect(makeTyped(q('x', 'A', ['All of the above', 'b']))).toBeNull();
    expect(makeTyped(q('x', 'A', ['Both A and B', 'c']))).toBeNull();
    expect(makeTyped(q('x', 'A', ['x'.repeat(41), 'b']))).toBeNull();
  });

  it('checkTyped is forgiving about form but strict about meaning', () => {
    expect(checkTyped('helicase', 'Helicase')).toBe(true);
    expect(checkTyped('  The Helicase. ', 'Helicase')).toBe(true);
    expect(checkTyped('helicse', 'Helicase')).toBe(true);           // 1 typo in 8 letters
    expect(checkTyped('hlicse', 'Helicase')).toBe(false);           // 2 typos
    expect(checkTyped('lipase', 'Ligase')).toBe(false);             // short: exact only
    expect(checkTyped('IgA', 'IgG')).toBe(false);
    expect(checkTyped('2 ATP', '4 ATP')).toBe(false);
    expect(checkTyped('phosphofructokinas', 'Phosphofructokinase 1')).toBe(false); // digits differ
    expect(checkTyped('phosphofructokinas 1', 'Phosphofructokinase 1')).toBe(true);
    expect(checkTyped('primase', 'Primose', ['Primase'])).toBe(false); // it's a wrong option
    expect(checkTyped('', 'Helicase')).toBe(false);
    expect(checkTyped('Café', 'cafe')).toBe(true);
    expect(normalise('Na+/K+ ATPase')).toBe('na k atpase');
  });

  it('match needs 3+ questions with distinct short answers', () => {
    const qs = [q('Q1', 'A'), q('Q2', 'B'), q('Q3', 'C'), q('Q4', 'D'), q('Q5', 'C')];
    const m = makeMatch(qs, rnd('m'));
    expect(m.pairs.map(p => p.answer)).toEqual(['Primase', 'DNA ligase', 'Helicase', 'Topoisomerase I']);
    expect([...m.choices].sort()).toEqual([...m.pairs.map(p => p.answer)].sort());
    expect(makeMatch([q('Q1', 'C'), q('Q2', 'C'), q('Q3', 'C')], rnd('m'))).toBeNull();
  });

  it('select-all-true always has at least one true and one false statement', () => {
    const qs = [q('Q1', 'A'), q('Q2', 'B'), q('Q3', 'C'), q('Q4', 'D')];
    for (let i = 0; i < 50; i++) {
      const m = makeMulti(qs, rnd(`multi${i}`));
      const t = m.statements.filter(s => s.truth).length;
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(4);
      for (const s of m.statements) expect(s.truth).toBe(s.answer === correctText(s.q));
    }
    expect(makeMulti(qs.slice(0, 3), rnd('x'))).toBeNull();
  });

  it('a mixed session uses every format and never repeats a question', () => {
    const qs = Array.from({ length: 40 }, (_, i) => q(`Question ${i}?`, 'ABCD'[i % 4], [`opt${i}a`, `opt${i}b`, `opt${i}c`, `opt${i}d`]));
    const items = buildMixedSession(qs, 10, rnd('session'));
    expect(items).toHaveLength(10);
    expect(new Set(items.map(i => i.kind))).toEqual(new Set(['tf', 'typed', 'match', 'multi']));
    const used = items.flatMap(i => i.q ? [i.q] : i.pairs ? i.pairs.map(p => p.q) : i.statements.map(s => s.q));
    expect(new Set(used).size).toBe(used.length);
  });

  it('falls back to true/false with few questions, and skips unusable ones', () => {
    const items = buildMixedSession([q('Only one?', 'C'), q('Broken', 'Z'), q('Reported', 'A', undefined, { flagged: true })], 10, rnd('s'));
    expect(items).toHaveLength(1);
    expect(['tf', 'typed']).toContain(items[0].kind);
    expect(buildMixedSession([], 10)).toEqual([]);
  });
});
