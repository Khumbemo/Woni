/**
 * Woni — Motivation: XP, levels, daily goal, streaks, badges, the daily
 * challenge, celebrations and the study calendar.
 */
import { computeStreak } from '../utils.js';
import {
  XP, DEFAULT_DAILY_GOAL, GOAL_CHOICES, dayKey, keyToTime, levelFor, aggregateDays,
  badgeStatus, bestStreak, pickChallenge, calendarCells,
} from '../gamify.js';
import { QUEST_XP, questsForDay, questProgress } from '../planner.js';

const DEVICE_KEY = 'woni_device_id';
const GOAL_KEY = 'woni_daily_goal';
const SEEN_BADGES_KEY = 'woni_badges_seen';
const FOCUS_SECONDS = 25 * 60;
const COUNT_FIELDS = ['xp', 'answered', 'correct', 'cards', 'seconds', 'focus', 'tasks', 'mixed'];

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export const motivationMixin = {
  /** A random id for this device, so each device keeps its own daily record. */
  deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  },

  getDailyGoal() {
    const g = Number(localStorage.getItem(GOAL_KEY));
    return GOAL_CHOICES.includes(g) ? g : DEFAULT_DAILY_GOAL;
  },

  setDailyGoal(value) {
    const g = Number(value);
    if (!GOAL_CHOICES.includes(g)) return;
    localStorage.setItem(GOAL_KEY, String(g));
    this.updateMotivation();
  },

  /** All activity records (every device). */
  async _activityRecords() {
    if (!this.state.db) return [];
    return (await this.dbGetAll('progress')).filter(r => typeof r.id === 'string' && r.id.startsWith('day:'));
  },

  /**
   * Add study activity for today, e.g. { xp: 10, answered: 1, correct: 1 }.
   * Celebrates reaching the daily goal and new badges. Returns today's total XP.
   */
  logActivity(delta = {}) {
    // One at a time: each call reads, adds to and writes today's record, so
    // overlapping calls (quick answers, rapid card ratings) would lose XP.
    const run = this._activityQueue.then(() => this._logActivityNow(delta));
    this._activityQueue = run.catch(() => {});
    return run;
  },

  _activityQueue: Promise.resolve(),

  async _logActivityNow(delta) {
    if (!this.state.db) return 0;
    const date = dayKey(this.now ? this.now() : Date.now());
    const id = `day:${date}:${this.deviceId()}`;
    const all = await this._activityRecords();
    const before = aggregateDays(all).get(date) || { xp: 0, questsDone: [] };
    const rec = structuredClone(all.find(r => r.id === id)) || { id, date, xp: 0, answered: 0, correct: 0, cards: 0, seconds: 0, focus: 0 };
    for (const f of COUNT_FIELDS) {
      if (delta[f]) rec[f] = (Number(rec[f]) || 0) + (Number(delta[f]) || 0);
    }
    if (delta.challenge) rec.challenge = true;
    if (delta.bestCombo > (rec.bestCombo || 0)) rec.bestCombo = delta.bestCombo;

    // Quests finished by this activity earn their bonus once (on any device).
    const after = aggregateDays([...all.filter(r => r.id !== id), rec]).get(date);
    const finished = questProgress(await this._questsFor(date), after)
      .filter(q => q.done && !after.questsDone.includes(q.id));
    if (finished.length) {
      rec.questsDone = [...(rec.questsDone || []), ...finished.map(q => q.id)];
      rec.xp = (Number(rec.xp) || 0) + QUEST_XP * finished.length;
    }
    const afterXp = after.xp + QUEST_XP * finished.length;
    const goal = this.getDailyGoal();
    const reachedGoal = before.xp < goal && afterXp >= goal;
    if (afterXp >= goal) rec.goalMet = true;
    await this.dbPut('progress', rec);

    for (const q of finished) this.celebrate(`Quest complete: ${q.label} (+${QUEST_XP} XP)`);
    if (reachedGoal) this.celebrate(`Daily goal reached: ${afterXp} XP today! 🎉`);
    await this.checkNewBadges();
    if (this.state.currentView === 'dashboard') this.updateMotivation();
    return afterXp;
  },

  /** Which quest types the student has content for. */
  async _questAvailability() {
    const count = async store => {
      try { return await this.dbCount(store); } catch { return 0; }
    };
    const [questions, cards, tasks] = await Promise.all([count('questions'), count('flashcards'), count('tasks')]);
    return { questions: questions > 0, cards: cards > 0, tasks: tasks > 0 };
  },

  /** Today's quests with progress, for the dashboard. */
  async getTodayQuests() {
    const date = dayKey(this.now ? this.now() : Date.now());
    const day = aggregateDays(await this._activityRecords()).get(date) || {};
    return questProgress(await this._questsFor(date), day);
  },

  /** The day's quests (one place, so it can be replaced, e.g. in tests). */
  async _questsFor(date) {
    return questsForDay(date, await this._questAvailability());
  },

  /** Everything the dashboard, badges and calendar need. */
  async getStudyStats() {
    const records = await this._activityRecords();
    const days = aggregateDays(records);
    const tests = this.state.db ? await this.dbGetAll('mock_tests') : [];
    const today = dayKey(this.now ? this.now() : Date.now());
    // Days with any study: logged activity, plus mock tests from before activity was logged.
    const studyDays = [...[...days.values()].filter(d => d.xp > 0).map(d => d.date), ...tests.map(t => dayKey(t.date))];
    const sum = f => [...days.values()].reduce((s, d) => s + d[f], 0);
    return {
      days,
      today: days.get(today) || { xp: 0 },
      totalXp: sum('xp'),
      answered: sum('answered'),
      correct: sum('correct'),
      cards: sum('cards'),
      seconds: sum('seconds'),
      focusSessions: records.reduce((s, r) => s + (Number(r.focus) || 0), 0),
      streak: computeStreak(studyDays.map(keyToTime), this.now ? this.now() : Date.now()),
      bestStreak: bestStreak(studyDays),
      goalDays: [...days.values()].filter(d => d.goalMet).length,
      challenges: [...days.values()].filter(d => d.challenge).length,
      challengeDoneToday: !!days.get(today)?.challenge,
      perfectTests: tests.filter(t => t.score === 100 && (t.qCount || 0) >= 5).length,
    };
  },

  /** Toast (and confetti) for badges unlocked since they were last shown. */
  async checkNewBadges() {
    const stats = await this.getStudyStats();
    const seen = new Set(readJSON(SEEN_BADGES_KEY, []));
    const fresh = badgeStatus(stats).filter(b => b.unlocked && !seen.has(b.id));
    if (fresh.length === 0) return [];
    for (const b of fresh) seen.add(b.id);
    localStorage.setItem(SEEN_BADGES_KEY, JSON.stringify([...seen]));
    this.celebrate(fresh.length === 1
      ? `Badge unlocked: ${fresh[0].icon} ${fresh[0].name}!`
      : `${fresh.length} badges unlocked: ${fresh.map(b => `${b.icon} ${b.name}`).join(', ')}!`);
    return fresh;
  },

  /** A short burst of confetti plus a toast. Motion is skipped for people who ask for less. */
  celebrate(message) {
    this.showToast(message, 'success');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof document === 'undefined') return;
    document.querySelector('.confetti')?.remove();
    const box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    const colors = ['#f97316', '#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('span');
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 0.4}s`;
      p.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      p.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
      p.style.setProperty('--spin', `${Math.round((Math.random() - 0.5) * 1440)}deg`);
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3500);
  },

  /** Dashboard: level, XP bar, daily goal ring, challenge button. */
  async updateMotivation() {
    const card = document.getElementById('today-card');
    if (!card || !this.state.db) return;
    const stats = await this.getStudyStats();
    const goal = this.getDailyGoal();
    const todayXp = stats.today.xp || 0;
    const lvl = levelFor(stats.totalXp);
    const pct = Math.min(1, todayXp / goal);
    const r = 34, circ = 2 * Math.PI * r;

    const ring = document.getElementById('goal-ring');
    if (ring) {
      ring.setAttribute('aria-label', `Daily goal: ${todayXp} of ${goal} XP`);
      ring.innerHTML = `
        <svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
          <circle cx="40" cy="40" r="${r}" class="ring-track"/>
          <circle cx="40" cy="40" r="${r}" class="ring-fill${pct >= 1 ? ' done' : ''}"
            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - pct)).toFixed(1)}"/>
        </svg>
        <div class="ring-text"><strong>${pct >= 1 ? '✓' : todayXp}</strong><span>${pct >= 1 ? 'goal met' : `/ ${goal} XP`}</span></div>`;
    }
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('level-name', `Level ${lvl.level} · ${lvl.title}`);
    set('level-detail', `${stats.totalXp} XP total · ${lvl.toNext} XP to level ${lvl.level + 1}`);
    const bar = document.getElementById('level-fill');
    if (bar) bar.style.width = `${Math.round((lvl.into / lvl.needed) * 100)}%`;
    const xpBar = document.getElementById('level-bar');
    if (xpBar) {
      xpBar.setAttribute('aria-valuenow', String(lvl.into));
      xpBar.setAttribute('aria-valuemax', String(lvl.needed));
    }

    const btn = document.getElementById('challenge-btn');
    const note = document.getElementById('challenge-note');
    if (btn) btn.textContent = stats.challengeDoneToday ? 'Play again' : 'Daily Challenge';
    if (note) {
      note.textContent = stats.challengeDoneToday
        ? 'Today’s challenge done ✓ New one tomorrow.'
        : `5 mixed questions, weakest topics first · +${XP.challenge} XP bonus`;
    }
  },

  /** 5 interleaved questions from the weakest topics. The bonus counts once a day. */
  async startDailyChallenge() {
    const examId = this.state.activeExam?.id;
    if (!examId) { this.showToast('Choose your exam first.', 'info'); return; }
    const [questions, topics] = await Promise.all([
      this.dbGetFromIndex('questions', 'exam', examId),
      this.dbGetFromIndex('topics', 'exam', examId),
    ]);
    const picked = pickChallenge(questions, topics);
    if (picked.length === 0) {
      this.showToast('No questions yet. Analyze a paper in Upload to unlock the daily challenge.', 'info');
      return;
    }
    const stats = await this.getStudyStats();
    this.openSession('Daily Challenge', 'test', picked, { instant: true, challenge: !stats.challengeDoneToday });
  },

  /** Stats tab: badges grid and study calendar. */
  async renderMotivationStats() {
    const stats = await this.getStudyStats();
    const badges = document.getElementById('badges-grid');
    if (badges) {
      const list = badgeStatus(stats);
      const count = document.getElementById('badges-count');
      if (count) count.textContent = `${list.filter(b => b.unlocked).length} of ${list.length}`;
      badges.innerHTML = list.map(b => `
        <div class="badge-tile ${b.unlocked ? 'unlocked' : 'locked'}" title="${this.escapeHtml(b.hint)}">
          <span class="badge-icon" aria-hidden="true">${b.unlocked ? b.icon : '🔒'}</span>
          <span class="badge-name">${this.escapeHtml(b.name)}</span>
          <span class="badge-hint">${b.unlocked ? 'Unlocked' : this.escapeHtml(b.hint)}</span>
        </div>`).join('');
    }
    const cal = document.getElementById('study-calendar');
    if (cal) {
      const goal = this.getDailyGoal();
      const cells = calendarCells(stats.days, goal, 12, this.now ? this.now() : Date.now());
      cal.innerHTML = cells.map(c => c.future
        ? '<span class="cal-cell future" aria-hidden="true"></span>'
        : `<span class="cal-cell l${c.level}" role="img" aria-label="${c.date}: ${c.xp} XP" title="${c.date}: ${c.xp} XP"></span>`).join('');
      const summary = document.getElementById('calendar-summary');
      if (summary) summary.textContent = `Current streak ${stats.streak} day${stats.streak === 1 ? '' : 's'} · best ${stats.bestStreak} · daily goal reached on ${stats.goalDays} day${stats.goalDays === 1 ? '' : 's'}`;
    }
  },

  /** A completed 25-minute focus (reading) session from the Focus Timer. */
  async onFocusComplete() {
    await this.logActivity({ xp: XP.focus, seconds: FOCUS_SECONDS, focus: 1 });
    this.showToast(`Focus session complete: +${XP.focus} XP. Take a 5-minute break.`, 'success');
  },
};
