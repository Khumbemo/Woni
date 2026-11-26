/**
 * Woni — Planner: your own study tasks, the exam countdown and study plan,
 * and today's quests and tasks on the dashboard.
 */
import { dayKey } from '../gamify.js';
import { TASK_XP, PLAN_MAX_DAYS, groupTasks, buildStudyPlan, daysBetween } from '../planner.js';

const MAX_TITLE = 200;

export const plannerMixin = {
  _today() {
    return dayKey(this.now ? this.now() : Date.now());
  },

  _examId() {
    return this.state.activeExam?.id || this.state.userExams[0]?.id || null;
  },

  /** Tasks for the active exam (and tasks not tied to an exam). */
  async _tasks() {
    if (!this.state.db) return [];
    const examId = this._examId();
    return (await this.dbGetAll('tasks')).filter(t => !t.exam || !examId || t.exam === examId);
  },

  // --- Exam date -------------------------------------------------------------

  async getExamDate(examId = this._examId()) {
    if (!examId || !this.state.db) return null;
    const rec = await this.dbGet('progress', `exam:${examId}`);
    return rec?.date || null;
  },

  async saveExamDate() {
    const examId = this._examId();
    const value = document.getElementById('exam-date-input')?.value || '';
    if (!examId) { this.showToast('Choose your exam first.', 'info'); return; }
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { this.showToast('Enter a valid date.', 'error'); return; }
    if (value && daysBetween(this._today(), value) < 0) { this.showToast('The exam date is in the past.', 'error'); return; }
    if (value) await this.dbPut('progress', { id: `exam:${examId}`, exam: examId, date: value });
    else await this.dbDelete('progress', `exam:${examId}`);
    this.showToast(value ? 'Exam date saved.' : 'Exam date cleared.', 'success');
    await this.renderPlanner();
    this.renderTodayPlan();
  },

  /** Replace the generated plan's upcoming, unfinished tasks with a new plan. */
  async buildPlan() {
    const examId = this._examId();
    const examDate = await this.getExamDate(examId);
    if (!examId || !examDate) { this.showToast('Set your exam date first.', 'info'); return; }
    const topics = await this.dbGetFromIndex('topics', 'exam', examId);
    if (topics.length === 0) { this.showToast('Analyze a paper first: the plan is built from its topics.', 'info'); return; }
    const today = this._today();
    const plan = buildStudyPlan(topics, today, examDate);
    if (plan.length === 0) { this.showToast('The exam is today or has passed, so there is nothing to plan.', 'info'); return; }
    const old = (await this.dbGetAll('tasks')).filter(t => t.source === 'plan' && t.exam === examId && !t.done && (t.due || '') >= today);
    if (old.length && !(await this.confirmAction(`Replace the ${old.length} upcoming tasks of your current plan with a new plan?`))) return;
    for (const t of old) await this.dbDelete('tasks', t.id);
    const now = Date.now();
    for (const [i, p] of plan.entries()) {
      await this.dbAdd('tasks', { ...p, exam: examId, source: 'plan', done: false, createdAt: now + i });
    }
    const covered = daysBetween(today, examDate) > PLAN_MAX_DAYS ? ` It covers the next ${PLAN_MAX_DAYS} days; build it again later for the rest.` : '';
    this.showToast(`Study plan ready: ${plan.length} daily tasks until ${examDate}.${covered}`, 'success');
    await this.renderPlanner();
    this.renderTodayPlan();
  },

  // --- Tasks -------------------------------------------------------------------

  async addTask() {
    const titleEl = document.getElementById('task-title-input');
    const dueEl = document.getElementById('task-due-input');
    const title = (titleEl?.value || '').trim().slice(0, MAX_TITLE);
    if (!title) { this.showToast('Write what you want to do.', 'error'); titleEl?.focus(); return; }
    const due = dueEl?.value || null;
    // Clear the boxes before saving, so the next task can be typed straight away without being wiped.
    if (titleEl) titleEl.value = '';
    if (dueEl) dueEl.value = '';
    titleEl?.focus();
    await this.dbAdd('tasks', { title, due, exam: this._examId(), source: 'user', kind: 'note', done: false, createdAt: Date.now() });
    await this.renderPlanner();
    this.renderTodayPlan();
  },

  async toggleTask(id) {
    const task = await this.dbGet('tasks', parseInt(id, 10));
    if (!task) return;
    task.done = !task.done;
    task.doneAt = task.done ? Date.now() : null;
    const firstTime = task.done && !task.rewarded;
    if (firstTime) task.rewarded = true; // XP once per task, however often it's ticked
    await this.dbPut('tasks', task);
    if (firstTime) {
      this.showToast(`Task done: +${TASK_XP} XP`, 'success');
      await this.logActivity({ xp: TASK_XP, tasks: 1 });
    }
    await this.renderPlanner();
    this.renderTodayPlan();
  },

  async deleteTask(id) {
    const task = await this.dbGet('tasks', parseInt(id, 10));
    if (!task) return;
    if (!(await this.confirmAction(`Delete the task "${task.title}"?`))) return;
    await this.dbDelete('tasks', task.id);
    await this.renderPlanner();
    this.renderTodayPlan();
  },

  /** Start what a plan task asks for. */
  async startTask(id) {
    const task = await this.dbGet('tasks', parseInt(id, 10));
    if (!task) return;
    const examId = task.exam || this._examId();
    this.hidePlanner(false);
    if (task.kind === 'topic' && task.topic) {
      const started = await this.startTopicTest(examId, [task.topic], 10, { instant: true });
      if (!started) this.showToast(`No saved questions for ${task.topic} yet.`, 'info');
    } else if (task.kind === 'mock') {
      this.showView('practice');
      this.showMockTestSetup();
    } else {
      await this.startDailyChallenge();
    }
  },

  // --- Planner screen ----------------------------------------------------------

  async showPlanner() {
    this.showSubView('planner-overlay');
    await this.renderPlanner();
    document.getElementById('task-title-input')?.focus();
  },

  hidePlanner(refresh = true) {
    this.hideSubView('planner-overlay');
    if (refresh !== false && this.state.currentView === 'dashboard') this.updateDashboard();
  },

  _taskRow(t, today) {
    const dueLabel = !t.due ? '' : t.due === today ? 'Today' : t.due < today
      ? `Overdue · ${t.due}` : t.due;
    const canStart = !t.done && (t.kind === 'topic' || t.kind === 'mock' || t.kind === 'review');
    return `
      <li class="task-row${t.done ? ' done' : ''}${!t.done && t.due && t.due < today ? ' overdue' : ''}">
        <label class="task-check">
          <input type="checkbox" data-action="toggleTask" data-param="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done: ${this.escapeHtml(t.title)}">
          <span class="task-title">${this.escapeHtml(t.title)}</span>
        </label>
        <span class="task-meta">${t.source === 'plan' ? '<span class="task-tag">Plan</span>' : ''}${this.escapeHtml(dueLabel)}</span>
        <span class="task-actions">
          ${canStart ? `<button class="btn small accent" data-action="startTask" data-param="${t.id}">Start</button>` : ''}
          <button class="btn small" data-action="deleteTask" data-param="${t.id}" aria-label="Delete task: ${this.escapeHtml(t.title)}">✕</button>
        </span>
      </li>`;
  },

  async renderPlanner() {
    const list = document.getElementById('planner-list');
    if (!list) return;
    const today = this._today();
    const examDate = await this.getExamDate();
    const dateInput = document.getElementById('exam-date-input');
    if (dateInput) {
      dateInput.value = examDate || '';
      dateInput.min = today;
    }
    const countdown = document.getElementById('planner-countdown');
    if (countdown) countdown.textContent = this._countdownText(examDate, today);

    const g = groupTasks(await this._tasks(), today);
    const section = (title, tasks, cls = '') => tasks.length
      ? `<h4 class="task-group ${cls}">${title} <span>${tasks.length}</span></h4><ul class="task-list">${tasks.map(t => this._taskRow(t, today)).join('')}</ul>`
      : '';
    const upcoming = g.upcoming.slice(0, 30);
    list.innerHTML = [
      section('Overdue', g.overdue, 'overdue'),
      section('Today', g.today),
      section('Upcoming', upcoming) + (g.upcoming.length > upcoming.length ? `<p class="muted task-more">and ${g.upcoming.length - upcoming.length} more later</p>` : ''),
      section('No date', g.someday),
      section('Done', g.done.slice(0, 10)),
    ].join('') || '<p class="muted task-empty">No tasks yet. Add one above, or set your exam date and build a study plan.</p>';
  },

  _countdownText(examDate, today) {
    const name = this.state.activeExam?.name || 'your exam';
    if (!examDate) return `Set the date of ${name} to see a countdown and get a study plan.`;
    const d = daysBetween(today, examDate);
    if (d < 0) return `${name} was on ${examDate}.`;
    if (d === 0) return `${name} is today. Good luck!`;
    return `${d} day${d === 1 ? '' : 's'} to ${name} (${examDate})`;
  },

  // --- Dashboard ---------------------------------------------------------------

  async renderTodayPlan() {
    const card = document.getElementById('plan-card');
    if (!card || !this.state.db) return;
    const today = this._today();
    const [examDate, quests, tasks] = await Promise.all([this.getExamDate(), this.getTodayQuests(), this._tasks()]);

    const countdown = document.getElementById('plan-countdown');
    if (countdown) {
      const d = examDate ? daysBetween(today, examDate) : null;
      countdown.innerHTML = d !== null && d >= 0
        ? `<strong>${d}</strong> <span>day${d === 1 ? '' : 's'} to ${this.escapeHtml(this.state.activeExam?.name || 'your exam')}</span>`
        : '<span>Set your exam date</span>';
    }

    const questList = document.getElementById('quest-list');
    if (questList) {
      questList.innerHTML = quests.map(q => `
        <li class="quest${q.done ? ' done' : ''}">
          <span class="quest-icon" aria-hidden="true">${q.done ? '✅' : '🎯'}</span>
          <span class="quest-body">
            <span class="quest-label">${this.escapeHtml(q.label)}</span>
            <span class="quest-bar" role="progressbar" aria-label="${this.escapeHtml(q.label)}" aria-valuemin="0" aria-valuemax="${q.target}" aria-valuenow="${q.value}"><span style="width:${Math.round((q.value / q.target) * 100)}%"></span></span>
          </span>
          <span class="quest-count">${q.done ? '+20 XP' : `${q.value}/${q.target}`}</span>
        </li>`).join('');
    }

    const g = groupTasks(tasks, today);
    const due = [...g.overdue, ...g.today].slice(0, 5);
    const taskList = document.getElementById('today-tasks');
    if (taskList) {
      taskList.innerHTML = due.length
        ? due.map(t => this._taskRow(t, today)).join('')
        : `<li class="muted task-empty">${g.upcoming.length || g.someday.length ? 'Nothing due today.' : 'No tasks yet.'}</li>`;
    }
  },
};
