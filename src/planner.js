/**
 * Woni — daily quests, planner tasks and the exam study plan (pure functions).
 */
import { dayKey, keyToTime } from './gamify.js';

export const QUEST_XP = 20;
export const TASK_XP = 5;
export const QUESTS_PER_DAY = 3;
export const PLAN_MAX_DAYS = 56; // the plan covers up to 8 weeks; rebuild it later for more

/**
 * Quest pool. `metric` is a field of the day's activity totals; `needs` names
 * content the quest requires ('questions', 'cards' or 'tasks').
 */
export const QUEST_POOL = [
  { id: 'answer', metric: 'answered', target: 15, label: 'Answer 15 questions', needs: 'questions' },
  { id: 'correct', metric: 'correct', target: 10, label: 'Get 10 answers right', needs: 'questions' },
  { id: 'cards', metric: 'cards', target: 10, label: 'Review 10 flashcards', needs: 'cards' },
  { id: 'focus', metric: 'focus', target: 1, label: 'Finish a 25-minute focus session' },
  { id: 'challenge', metric: 'challenge', target: 1, label: 'Complete the daily challenge', needs: 'questions' },
  { id: 'combo', metric: 'bestCombo', target: 5, label: 'Get 5 right in a row in practice mode', needs: 'questions' },
  { id: 'task', metric: 'tasks', target: 1, label: 'Tick off a planner task', needs: 'tasks' },
  { id: 'mixed', metric: 'mixed', target: 5, label: 'Answer 5 mixed-format questions', needs: 'questions' },
];

/** Small deterministic PRNG (mulberry32) seeded from a string, so every device picks the same quests. */
export function seededRandom(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's quests: QUESTS_PER_DAY from the pool, limited to what the student has content for. */
export function questsForDay(date, available = {}) {
  const pool = QUEST_POOL.filter(q => !q.needs || available[q.needs]);
  const rand = seededRandom(`quests:${date}`);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, QUESTS_PER_DAY);
}

/** Progress on each quest from the day's totals (see aggregateDays). */
export function questProgress(quests, day = {}) {
  return quests.map(q => {
    const raw = day[q.metric];
    const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw) || 0;
    return { ...q, value: Math.min(value, q.target), done: value >= q.target };
  });
}

/** Whole days from `fromKey` to `toKey` ('YYYY-MM-DD'); negative if past. Safe across DST. */
export function daysBetween(fromKey, toKey) {
  return Math.round((keyToTime(toKey) - keyToTime(fromKey)) / 86400000);
}

function addDays(key, n) {
  const d = new Date(keyToTime(key));
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

/**
 * Planner tasks grouped for display. `today` is a 'YYYY-MM-DD' key.
 * Done tasks are listed newest first; others by due date, undated last.
 */
export function groupTasks(tasks, today) {
  const g = { overdue: [], today: [], upcoming: [], someday: [], done: [] };
  for (const t of tasks || []) {
    if (!t) continue;
    if (t.done) g.done.push(t);
    else if (!t.due) g.someday.push(t);
    else if (t.due < today) g.overdue.push(t);
    else if (t.due === today) g.today.push(t);
    else g.upcoming.push(t);
  }
  const byDue = (a, b) => (a.due || '').localeCompare(b.due || '') || (a.createdAt || 0) - (b.createdAt || 0);
  g.overdue.sort(byDue); g.today.sort(byDue); g.upcoming.sort(byDue);
  g.someday.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  g.done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return g;
}

/**
 * A day-by-day plan from today until the day before the exam (at most
 * PLAN_MAX_DAYS days). Topics get study days in proportion to
 * importance × how much is left to learn, spread out rather than in blocks
 * (smooth weighted round-robin). Every 7th day is a mock test, and the last
 * two days before the exam are revision.
 * Returns [{ due, title, kind: 'topic'|'mock'|'review', topic? }].
 */
export function buildStudyPlan(topics, today, examDate, maxDays = PLAN_MAX_DAYS) {
  const total = daysBetween(today, examDate);
  if (!(total > 0) || !Array.isArray(topics) || topics.length === 0) return [];
  const days = Math.min(total, maxDays);
  const weighted = topics
    .filter(t => t && t.name)
    .map(t => ({
      name: t.name,
      w: Math.max(5, Number(t.frequency) || 50) * (1 - Math.min(100, Math.max(0, Number(t.mastery) || 0)) / 100) + 1,
      current: 0,
    }));
  if (weighted.length === 0) return [];
  const sumW = weighted.reduce((s, t) => s + t.w, 0);
  const weakest = [...weighted].sort((a, b) => b.w - a.w).slice(0, 3).map(t => t.name);
  const finalStretch = total <= maxDays; // revision days only make sense right before the exam

  const plan = [];
  for (let i = 0; i < days; i++) {
    const due = addDays(today, i);
    const daysLeft = total - i;
    if (finalStretch && daysLeft <= 2) {
      plan.push(daysLeft === 1
        ? { due, kind: 'review', title: 'Light revision of your weakest topics, then rest well' }
        : { due, kind: 'review', title: `Revise weakest topics: ${weakest.join(', ')}` });
    } else if (i % 7 === 6) {
      plan.push({ due, kind: 'mock', title: 'Full mock test (exam mode), then review your mistakes' });
    } else {
      for (const t of weighted) t.current += t.w;
      const pick = weighted.reduce((best, t) => (t.current > best.current ? t : best));
      pick.current -= sumW;
      plan.push({ due, kind: 'topic', topic: pick.name, title: `Study ${pick.name}: practise 10 questions, then review its flashcards` });
    }
  }
  return plan;
}
