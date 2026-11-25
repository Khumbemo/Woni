/**
 * Woni — XP, levels, badges, daily challenge and study calendar (pure functions).
 *
 * Study activity is logged per device per day in the `progress` store as
 * { id: 'day:YYYY-MM-DD:<device>', date, xp, answered, correct, cards, seconds,
 *   goalMet, challenge }, so two devices never overwrite each other's counts
 * when they sync. Totals are summed across devices when read.
 */

export const XP = {
  correct: 10,        // a right answer
  attempt: 2,         // a wrong answer still counts as practice
  card: 5,            // a flashcard reviewed
  focus: 25,          // a completed 25-minute focus session
  challenge: 50,      // bonus for finishing the daily challenge
};

export const DEFAULT_DAILY_GOAL = 50;
export const GOAL_CHOICES = [30, 50, 100, 200];
export const CHALLENGE_SIZE = 5;

const TITLES = ['Novice', 'Learner', 'Apprentice', 'Scholar', 'Researcher', 'Specialist', 'Expert', 'Master', 'Sage', 'Luminary'];

/** Local calendar date of a timestamp as 'YYYY-MM-DD'. */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midnight (local) of a 'YYYY-MM-DD' key. */
export function keyToTime(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Level from total XP. Each level needs 50 XP more than the last
 * (50, 100, 150, ...), so level n starts at 25·n·(n−1) XP.
 */
export function levelFor(totalXp) {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  let level = 1;
  while (25 * (level + 1) * level <= xp) level++;
  const start = 25 * level * (level - 1);
  const next = 25 * (level + 1) * level;
  return {
    level,
    title: TITLES[Math.min(level - 1, TITLES.length - 1)],
    xp,
    into: xp - start,
    needed: next - start,
    toNext: next - xp,
  };
}

const ACTIVITY_FIELDS = ['xp', 'answered', 'correct', 'cards', 'seconds'];

/** Sum activity records by date: Map('YYYY-MM-DD' -> totals, goalMet, challenge). */
export function aggregateDays(records) {
  const days = new Map();
  for (const r of records || []) {
    if (!r || typeof r.date !== 'string') continue;
    const d = days.get(r.date) || { date: r.date, xp: 0, answered: 0, correct: 0, cards: 0, seconds: 0, goalMet: false, challenge: false };
    for (const f of ACTIVITY_FIELDS) d[f] += Number(r[f]) || 0;
    d.goalMet ||= !!r.goalMet;
    d.challenge ||= !!r.challenge;
    days.set(r.date, d);
  }
  return days;
}

/**
 * Badges. `stats`: { answered, correct, cards, streak, bestStreak, goalDays,
 * challenges, perfectTests, focusSessions }.
 */
export const BADGES = [
  { id: 'first-steps', name: 'First Steps', icon: '🌱', hint: 'Answer your first question', test: s => s.answered >= 1 },
  { id: 'on-fire', name: 'On Fire', icon: '🔥', hint: 'Study 3 days in a row', test: s => s.bestStreak >= 3 },
  { id: 'week-warrior', name: 'Week Warrior', icon: '🗓️', hint: 'Study 7 days in a row', test: s => s.bestStreak >= 7 },
  { id: 'unstoppable', name: 'Unstoppable', icon: '🚀', hint: 'Study 30 days in a row', test: s => s.bestStreak >= 30 },
  { id: 'perfect', name: 'Perfect Score', icon: '🎯', hint: 'Score 100% on a test of 5+ questions', test: s => s.perfectTests >= 1 },
  { id: 'centurion', name: 'Centurion', icon: '💯', hint: 'Answer 100 questions correctly', test: s => s.correct >= 100 },
  { id: 'question-master', name: 'Question Master', icon: '🏆', hint: 'Answer 1,000 questions correctly', test: s => s.correct >= 1000 },
  { id: 'card-shark', name: 'Card Shark', icon: '🃏', hint: 'Review 100 flashcards', test: s => s.cards >= 100 },
  { id: 'goal-getter', name: 'Goal Getter', icon: '⭐', hint: 'Reach your daily goal on 7 days', test: s => s.goalDays >= 7 },
  { id: 'challenger', name: 'Challenger', icon: '⚡', hint: 'Finish 5 daily challenges', test: s => s.challenges >= 5 },
  { id: 'deep-focus', name: 'Deep Focus', icon: '🧘', hint: 'Complete 10 focus sessions', test: s => s.focusSessions >= 10 },
];

export function badgeStatus(stats) {
  return BADGES.map(({ test, ...b }) => ({ ...b, unlocked: !!test(stats) }));
}

/** Longest run of consecutive days in a set of 'YYYY-MM-DD' keys. */
export function bestStreak(dateKeys) {
  const times = [...new Set(dateKeys)].map(keyToTime).sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const t of times) {
    // Compare calendar dates, not milliseconds: days around DST changes are 23 or 25 hours.
    run = prev !== null && dayKey(prev + 36 * 3600 * 1000) === dayKey(t) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

/**
 * The daily challenge: `n` questions, weakest topics first, taking one
 * question per topic in turn so topics are mixed (interleaved), not blocked.
 * `random` is injectable for tests.
 */
export function pickChallenge(questions, topics, n = CHALLENGE_SIZE, random = Math.random) {
  const mastery = new Map((topics || []).map(t => [t.name, Number(t.mastery) || 0]));
  const byTopic = new Map();
  for (const q of questions || []) {
    if (!q || q.flagged) continue;
    const key = q.topic || 'General';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(q);
  }
  // Shuffle within each topic, then order topics weakest first (ties at random).
  const groups = [...byTopic.entries()].map(([topic, qs]) => {
    const copy = [...qs];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return { topic, qs: copy, m: mastery.get(topic) ?? 0, tie: random() };
  }).sort((a, b) => a.m - b.m || a.tie - b.tie);
  const picked = [];
  while (picked.length < n && groups.some(g => g.qs.length)) {
    for (const g of groups) {
      if (picked.length >= n) break;
      if (g.qs.length) picked.push(g.qs.shift());
    }
  }
  return picked;
}

/**
 * Study calendar for the last `weeks` weeks, Monday-first columns:
 * [{ date, xp, level 0-4, future }] in column order (week by week).
 * Level 0 = no study, 4 = reached at least the daily goal.
 */
export function calendarCells(days, goal = DEFAULT_DAILY_GOAL, weeks = 12, now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7; // days since Monday
  const start = new Date(today);
  start.setDate(today.getDate() - mondayOffset - (weeks - 1) * 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d.getTime());
    const xp = days.get(key)?.xp || 0;
    const level = xp <= 0 ? 0 : xp >= goal ? 4 : Math.min(3, 1 + Math.floor((xp / goal) * 3));
    cells.push({ date: key, xp, level, future: d.getTime() > today.getTime() });
  }
  return cells;
}
