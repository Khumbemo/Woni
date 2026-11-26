/**
 * Woni — Practice View Module
 * Mock tests, flashcards, topic mastery, focus timer, and SM-2 algorithm.
 */
import { h, render } from 'preact';
import FocusTimer from '../components/FocusTimer.jsx';
import { shuffle, answerToLetter, sm2, toPdfText, updateMastery } from '../utils.js';
import { XP } from '../gamify.js';
import { buildMixedSession, checkTyped, wrongOptions, correctText } from '../formats.js';

const INSTANT_KEY = 'woni_instant_feedback';
const MAX_SESSION_SECONDS = 2 * 60 * 60;

export const practiceMixin = {
  async updatePracticeView() {
    this.updateToolCounts?.();
    const select = document.getElementById('mock-exam-select');
    if (select) {
      select.innerHTML = this.state.userExams.map(ex =>
        `<option value="${this.escapeHtml(ex.id)}">${this.escapeHtml(ex.name)}</option>`
      ).join('');
      select.onchange = (e) => this.updateMockTopics(e.target.value);
      this.updateMockTopics(select.value);
    }
  },

  async updateMockTopics(examId) {
    const topics = await this.dbGetFromIndex('topics', 'exam', examId);
    const container = document.getElementById('mock-topic-checks');
    if (!container) return;
    if (topics.length === 0) {
      container.innerHTML = '<p class="muted">No topics analyzed yet for this exam.</p>';
      return;
    }
    container.innerHTML = topics.map(t => `
      <label class="topic-check">
        <input type="checkbox" value="${this.escapeHtml(t.name)}" checked>
        <span>${this.escapeHtml(t.name)}</span>
      </label>
    `).join('');
  },

  showMockTestSetup() {
    const instant = document.getElementById('mock-instant');
    if (instant) instant.checked = localStorage.getItem(INSTANT_KEY) === 'true';
    this.showSubView('mock-test-setup');
  },

  async startMockTest() {
    const examId = document.getElementById('mock-exam-select')?.value;
    const rawCount = parseInt(document.getElementById('mock-q-count')?.value, 10);
    const qCount = Math.min(100, Math.max(1, Number.isFinite(rawCount) ? rawCount : 10));
    const selectedTopics = Array.from(document.querySelectorAll('#mock-topic-checks input:checked')).map(i => i.value);
    const instant = !!document.getElementById('mock-instant')?.checked;
    localStorage.setItem(INSTANT_KEY, String(instant));
    const started = await this.startTopicTest(examId, selectedTopics, qCount, { instant });
    if (started) this.hideSubView('mock-test-setup');
  },

  /** Start a mock test from the bank, optionally limited to some topics. Returns false if there were no questions. */
  async startTopicTest(examId, topics = [], qCount = 10, opts = {}) {
    let allQuestions = await this.dbGetFromIndex('questions', 'exam', examId);
    if (topics.length > 0) {
      allQuestions = allQuestions.filter(q => topics.includes(q.topic));
    }
    // Questions reported as wrong stay out of tests until they are fixed.
    const reported = allQuestions.filter(q => q.flagged).length;
    allQuestions = allQuestions.filter(q => !q.flagged);
    if (allQuestions.length === 0) {
      this.showToast(reported ? 'All matching questions are reported as wrong. Fix them in Question Bank.' : 'No questions found for the selected criteria.', 'info');
      return false;
    }
    if (reported) this.showToast(`${reported} reported question${reported > 1 ? 's' : ''} left out.`, 'info');
    this.openSession(opts.instant ? 'Practice' : 'Mock Test', 'test', shuffle(allQuestions).slice(0, qCount), opts);
    return true;
  },

  async startFlashcards() {
    const examId = this.state.activeExam?.id;
    // Cards saved before flashcards recorded their exam (no `exam`) show for every exam.
    const cards = (await this.dbGetAll('flashcards')).filter(c => !c.flagged && (!examId || !c.exam || c.exam === examId));
    const due = cards.filter(c => c.nextReview <= Date.now()).sort((a, b) => a.nextReview - b.nextReview);

    if (due.length === 0) {
      this.showToast(cards.length === 0 ? 'No flashcards available.' : 'All caught up!', 'info');
      return;
    }
    this.openSession('Flashcards', 'flashcard', due);
  },

  showTopicGrid() {
    this.showView('progress');
  },

  /**
   * opts.instant: show right/wrong and the explanation after each answer
   * (practice mode) instead of only at the end (exam mode).
   * opts.challenge: award the daily challenge bonus at the end.
   */
  openSession(title, type, data, opts = {}) {
    this.state.session = {
      title, type, data, index: 0, startTime: Date.now(), answers: [], score: 0, busy: false,
      instant: !!opts.instant, challenge: !!opts.challenge, combo: 0, bestCombo: 0, xp: 0,
    };
    const titleEl = document.getElementById('session-title');
    if (titleEl) titleEl.textContent = title;
    this.showSubView('active-session-overlay');
    // Pause particles during session to save battery
    if (this.pauseParticles) this.pauseParticles();
    this.renderSessionContent();
    this.startSessionTimer();
  },

  renderSessionContent() {
    const s = this.state.session;
    const content = document.getElementById('session-content');
    const footer = document.getElementById('session-footer');
    if (!content || !footer) return;
    const item = s.data[s.index];
    this.stopSpeaking?.();

    if (!item) {
      this.renderSessionResults();
      return;
    }

    if (s.type === 'test') {
      content.innerHTML = `
        <div class="q-header">Question ${s.index + 1} of ${s.data.length}${s.instant ? ' · Practice mode' : ''}${s.combo >= 2 ? ` <span class="combo-chip">🔥 ${s.combo} in a row</span>` : ''}</div>
        ${this.listenButtonHtml ? `<div class="q-tools">${this.listenButtonHtml()}</div>` : ''}
        <div class="q-text">${this.escapeHtml(item.text)}</div>
        <p class="kbd-hint">Keyboard: A–D to answer · Enter for next · Esc to exit</p>
        <div class="options-grid">
          ${(item.options || []).map((opt, i) => `
            <button class="option-btn" data-action="selectOption" data-param="${i}">
              <span class="opt-letter">${String.fromCharCode(65 + i)}</span>
              <span class="opt-text">${this.escapeHtml(opt)}</span>
            </button>
          `).join('')}
        </div>
        <div id="instant-feedback" class="instant-feedback hidden" aria-live="polite"></div>
      `;
      footer.innerHTML = `<button class="btn" data-action="exitSession">Exit</button><div style="flex:1"></div><button class="btn accent" data-action="nextQuestion" id="next-q-btn" disabled>Next →</button>`;
    } else if (s.type === 'mixed') {
      this.renderMixedItem(item, content, footer);
    } else {
      content.innerHTML = `
        <div class="card-count">Card ${s.index + 1} of ${s.data.length}</div>
        <div class="flashcard-box" id="flashcard-box" data-action="flipCard">
          <div class="card-front">${this.escapeHtml(item.front)}</div>
          <div class="card-back">${this.escapeHtml(item.back)}</div>
        </div>
        <p class="muted" style="text-align:center;margin-top:16px">Tap card to flip</p>
        <p class="kbd-hint" style="text-align:center">Keyboard: Space to show answer · 1 Again · 2 Hard · 3 Good · 4 Easy</p>
        <p class="card-tools">${this.listenButtonHtml?.() || ''}<button class="btn small" id="report-card-btn" data-action="reportFlashcard">Report wrong card</button></p>
        ${this.starNoteHtml?.('c', item) || ''}
      `;
      footer.innerHTML = `
        <div class="sm2-btns hidden" id="sm2-btns">
          <!-- SM-2 quality: 0 = forgot (reset), 3 = recalled with difficulty, 4 = after hesitation, 5 = perfect -->
          <button class="btn danger" data-action="rateCard" data-param="0">Again</button>
          <button class="btn" style="color:var(--gold)" data-action="rateCard" data-param="3">Hard</button>
          <button class="btn" style="color:var(--green)" data-action="rateCard" data-param="4">Good</button>
          <button class="btn accent" data-action="rateCard" data-param="5">Easy</button>
        </div>
        <button class="btn accent large" id="show-answer-btn" data-action="showFlashAnswer">Show Answer</button>
      `;
    }
  },

  /** Keyboard shortcuts while a test or flashcard session is open (laptops/desktops). */
  handleSessionKey(e) {
    const overlay = document.getElementById('active-session-overlay');
    const s = this.state.session;
    if (!s || !overlay || overlay.classList.contains('hidden')) return;
    if (e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { e.preventDefault(); this.exitSession(s.data[s.index] ? undefined : 'force'); return; }
    if (!s.data[s.index]) return; // results screen
    if (s.type === 'test') {
      const letterIdx = 'abcdefgh'.indexOf(key);
      const numIdx = '12345678'.indexOf(key);
      const idx = letterIdx >= 0 ? letterIdx : numIdx;
      if (idx >= 0 && idx < (s.data[s.index].options || []).length) { e.preventDefault(); this.selectOption(idx); }
      else if (key === 'enter' || key === 'arrowright') { e.preventDefault(); this.nextQuestion(); }
    } else if (s.type === 'mixed') {
      const item = s.data[s.index];
      if (item.kind === 'tf' && (key === 't' || key === 'f')) { e.preventDefault(); this.answerTF(key === 't' ? 'true' : 'false'); }
      else if (key === 'enter' || key === 'arrowright') { e.preventDefault(); this.nextQuestion(); }
    } else {
      const answerShown = !document.getElementById('sm2-btns')?.classList.contains('hidden');
      if ((key === ' ' || key === 'enter') && !answerShown) { e.preventDefault(); this.showFlashAnswer(); }
      else if (answerShown && ['1', '2', '3', '4'].includes(key)) {
        e.preventDefault();
        this.rateCard({ 1: 0, 2: 3, 3: 4, 4: 5 }[key]);
      }
    }
  },

  flipCard() {
    const box = document.getElementById('flashcard-box');
    if (box) box.classList.toggle('flipped');
  },

  showFlashAnswer() {
    const box = document.getElementById('flashcard-box');
    const sm2 = document.getElementById('sm2-btns');
    const showBtn = document.getElementById('show-answer-btn');
    if (box) box.classList.add('flipped');
    if (sm2) sm2.classList.remove('hidden');
    if (showBtn) showBtn.classList.add('hidden');
  },

  selectOption(i) {
    i = parseInt(i);
    const s = this.state.session;
    if (!s || !s.data[s.index]) return;
    // Practice mode: the first answer is final, as the right one has been shown.
    if (s.instant && s.answers[s.index] !== undefined) return;
    const btns = document.querySelectorAll('.option-btn');
    btns.forEach(b => b.classList.remove('selected'));
    if (btns[i]) btns[i].classList.add('selected');
    s.answers[s.index] = String.fromCharCode(65 + i);
    const nextBtn = document.getElementById('next-q-btn');
    if (nextBtn) nextBtn.disabled = false;
    if (s.instant) this.showInstantFeedback();
  },

  /** Practice mode: mark the answer, explain it, count the combo and award XP straight away. */
  showInstantFeedback() {
    const s = this.state.session;
    const q = s.data[s.index];
    const given = s.answers[s.index];
    const correct = answerToLetter(q);
    const right = given === correct;
    s.combo = right ? s.combo + 1 : 0;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    const xp = right ? XP.correct : XP.attempt;
    s.xp += xp;

    document.querySelectorAll('.option-btn').forEach((b, idx) => {
      const letter = String.fromCharCode(65 + idx);
      b.disabled = true;
      if (letter === correct) b.classList.add('correct');
      else if (letter === given) b.classList.add('wrong');
    });
    const box = document.getElementById('instant-feedback');
    if (box) {
      const correctText = correct ? `${correct}) ${(q.options || [])[correct.charCodeAt(0) - 65] ?? ''}` : '?';
      box.className = `instant-feedback ${right ? 'right' : 'wrong'}`;
      box.innerHTML = `
        <div class="if-head"><strong>${right ? '✓ Correct!' : '✗ Not quite.'}</strong>
          <span class="xp-pop">+${xp} XP</span>
          ${s.combo >= 2 ? `<span class="combo-chip">🔥 ${s.combo} in a row</span>` : ''}</div>
        ${right ? '' : `<div class="if-answer">Answer: ${this.escapeHtml(correctText)}</div>`}
        ${q.explanation ? `<div class="if-exp">${this.escapeHtml(q.explanation)}</div>` : ''}
        ${q.answerSource === 'ai' ? '<div class="if-exp">This answer was chosen by AI, not taken from an answer key.</div>' : ''}
        ${q.id !== undefined ? `<button class="btn small" data-action="reportQuestion" data-param="${q.id}">Report wrong answer</button>` : ''}
        ${this.starNoteHtml?.('q', q) || ''}`;
    }
    this.recordAnswers?.([{ id: q.id, right }]);
    this.logActivity({ xp, answered: 1, correct: right ? 1 : 0, bestCombo: s.combo }).catch(e => console.error('Could not log activity', e));
  },

  nextQuestion() {
    const s = this.state.session;
    if (!s || s.answers[s.index] === undefined) return;
    s.index++;
    this.renderSessionContent();
  },

  /**
   * SM-2 Spaced Repetition Algorithm
   * Quality scale: 0=Again, 3=Hard, 4=Good, 5=Easy
   */
  async rateCard(quality) {
    quality = parseInt(quality);
    const s = this.state.session;
    // A fast double-tap must not rate this card twice and skip the next one.
    if (!s || s.busy || !s.data[s.index]) return;
    s.busy = true;
    try {
      const card = s.data[s.index];
      const { interval, repetition, ease } = sm2(quality, card);
      card.interval = interval;
      card.repetition = repetition;
      card.ease = ease;
      card.nextReview = Date.now() + (interval * 24 * 60 * 60 * 1000);
      await this.dbPut('flashcards', card);
      s.xp += XP.card;
      this.logActivity({ xp: XP.card, cards: 1 }).catch(e => console.error('Could not log activity', e));
      s.index++;
    } finally {
      s.busy = false;
    }
    this.renderSessionContent();
  },

  async renderSessionResults() {
    const s = this.state.session;
    if (s.resultsSaved) return;
    s.resultsSaved = true;
    const content = document.getElementById('session-content');
    const footer = document.getElementById('session-footer');
    const timerEl = document.getElementById('session-timer');
    clearInterval(this.state.sessionTimer);
    if (!content || !footer) return;

    if (s.type === 'mixed') {
      const right = s.answers.filter(a => a?.right).length;
      const score = Math.round((right / s.data.length) * 100);
      const topicStats = {};
      s.data.forEach((item, i) => {
        const name = item.topic || 'General';
        topicStats[name] ??= { correct: 0, total: 0 };
        topicStats[name].total++;
        if (s.answers[i]?.right) topicStats[name].correct++;
      });
      await this._updateTopicMastery(s.data[0]?.q?.exam || s.data[0]?.pairs?.[0]?.q?.exam || s.data[0]?.statements?.[0]?.q?.exam, topicStats);
      content.innerHTML = `<div class="results-box"><div class="res-score">${score}%</div><p>${right} right out of ${s.data.length}</p>
        <p class="xp-earned">+${s.xp} XP${s.bestCombo >= 3 ? ` · best streak ${s.bestCombo} in a row 🔥` : ''}</p>
        <p class="muted">Time: ${timerEl ? timerEl.textContent : ''}</p></div>`;
      footer.innerHTML = `<button class="btn accent large" data-action="exitSession" data-param="force">Finish</button>`;
      return;
    }

    if (s.type === 'test') {
      let correctCount = 0;
      const topicStats = {};
      s.data.forEach((q, i) => {
        const topicName = q.topic || "General";
        if (!topicStats[topicName]) topicStats[topicName] = { correct: 0, total: 0 };
        topicStats[topicName].total++;
        if (s.answers[i] && s.answers[i] === answerToLetter(q)) { correctCount++; topicStats[topicName].correct++; }
      });
      const score = Math.round((correctCount / s.data.length) * 100);
      // Exam mode awards XP and records mistakes at the end (practice mode did it answer by answer).
      if (!s.instant) {
        this.recordAnswers?.(s.data.map((q, i) => (s.answers[i] ? { id: q.id, right: s.answers[i] === answerToLetter(q) } : null)));
        const answered = s.answers.filter(Boolean).length;
        const xp = correctCount * XP.correct + (answered - correctCount) * XP.attempt;
        s.xp += xp;
        this.logActivity({ xp, answered, correct: correctCount }).catch(e => console.error('Could not log activity', e));
      }
      let bonus = '';
      if (s.challenge) {
        s.xp += XP.challenge;
        bonus = `<p class="challenge-done">⚡ Daily challenge complete: +${XP.challenge} XP bonus</p>`;
        this.logActivity({ xp: XP.challenge, challenge: true })
          .then(() => this.celebrate('Daily challenge complete! ⚡'))
          .catch(e => console.error('Could not log activity', e));
      }
      content.innerHTML = `<div class="results-box"><div class="res-score">${score}%</div><p>${correctCount} correct out of ${s.data.length}</p>
        <p class="xp-earned">+${s.xp} XP${s.bestCombo >= 3 ? ` · best streak ${s.bestCombo} in a row 🔥` : ''}</p>${bonus}
        <p class="muted">Time: ${timerEl ? timerEl.textContent : ''}</p><button class="btn small accent" data-action="exportSessionPDF" style="margin-top:20px">Export Results PDF</button></div>
        <h4 class="review-heading">Review answers</h4>
        <div class="results-review">${s.data.map((q, i) => this.renderReviewItem(q, i, s.answers[i])).join('')}</div>`;

      await this._updateTopicMastery(s.data[0].exam, topicStats);
      await this.dbAdd('mock_tests', { exam: s.data[0].exam, date: Date.now(), score, qCount: s.data.length, duration: timerEl ? timerEl.textContent : '', answers: s.answers, questions: s.data });
    } else {
      content.innerHTML = `<div class="results-box"><h3>Review Complete!</h3><p>You've reviewed ${s.data.length} cards today.</p><p class="xp-earned">+${s.xp} XP</p></div>`;
    }
    footer.innerHTML = `<button class="btn accent large" data-action="exitSession" data-param="force">Finish</button>`;
  },

  /** One question in the post-test review: the student's answer, the key, the explanation. */
  renderReviewItem(q, i, given) {
    const correct = answerToLetter(q);
    const opt = letter => {
      const text = letter ? (q.options || [])[letter.charCodeAt(0) - 65] : undefined;
      return letter ? `${letter}${text !== undefined ? `) ${this.escapeHtml(text)}` : ''}` : '—';
    };
    const right = given && given === correct;
    return `
      <div class="review-item ${right ? 'right' : 'wrong'}">
        <div class="review-q"><strong>${i + 1}.</strong> ${this.escapeHtml(q.text || '')}</div>
        <div class="review-a">Your answer: ${opt(given)} ${right ? '✓' : '✗'}</div>
        ${right ? '' : `<div class="review-a">Correct: ${opt(correct)}</div>`}
        ${q.explanation ? `<div class="review-exp">${this.escapeHtml(q.explanation)}</div>` : ''}
        ${q.answerSource === 'ai' ? '<div class="review-exp">The answer to this question was chosen by AI, not taken from an answer key.</div>' : ''}
        ${q.id !== undefined ? `<button class="btn small" data-action="reportQuestion" data-param="${q.id}">Report wrong answer</button>` : ''}
        ${this.starNoteHtml?.('q', q) || ''}
      </div>`;
  },

  /** Fold a session's results into each topic's mastery. topicStats: { name: { correct, total } }. */
  async _updateTopicMastery(examId, topicStats) {
    if (!examId) return;
    for (const topicName in topicStats) {
      const stats = topicStats[topicName];
      const topicId = `${examId}_${topicName}`;
      let topic = await this.dbGet('topics', topicId);
      if (!topic) topic = { id: topicId, exam: examId, name: topicName, mastery: 0, frequency: 50 };
      const sessionMastery = (stats.correct / stats.total) * 100;
      topic.mastery = updateMastery(topic.mastery, topic.attempts, sessionMastery);
      topic.attempts = (topic.attempts || 0) + 1;
      await this.dbPut('topics', topic);
    }
  },

  // --- Mixed formats -------------------------------------------------------------

  /** A practice session mixing true/false, type-the-answer, matching and select-all-true. */
  async startMixedPractice() {
    const examId = this.state.activeExam?.id;
    if (!examId) { this.showToast('Choose your exam first.', 'info'); return; }
    const items = buildMixedSession(await this.dbGetFromIndex('questions', 'exam', examId));
    if (items.length === 0) {
      this.showToast('No questions yet. Analyze a paper in Upload first.', 'info');
      return;
    }
    this.openSession('Mixed Practice', 'mixed', items, { instant: true });
  },

  renderMixedItem(item, content, footer) {
    const s = this.state.session;
    const names = { tf: 'True or false', typed: 'Type the answer', match: 'Match the pairs', multi: 'Select all that are true' };
    const esc = t => this.escapeHtml(t);
    let body = '';
    if (item.kind === 'tf') {
      body = `
        <div class="q-text">${esc(item.q.text)}</div>
        <div class="tf-proposed">Proposed answer: <strong>${esc(item.proposed)}</strong></div>
        <p class="kbd-hint">Is that the right answer? Keyboard: T or F</p>
        <div class="tf-btns">
          <button class="btn large tf-btn" data-action="answerTF" data-param="true">✓ True</button>
          <button class="btn large tf-btn" data-action="answerTF" data-param="false">✗ False</button>
        </div>`;
    } else if (item.kind === 'typed') {
      body = `
        <div class="q-text">${esc(item.q.text)}</div>
        <div class="typed-row">
          <input id="typed-answer" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your answer" placeholder="Type your answer">
          <button class="btn accent" data-action="submitTyped" id="typed-submit">Check</button>
        </div>`;
    } else if (item.kind === 'match') {
      body = `
        <p class="kbd-hint">Choose the answer for each question.</p>
        <ol class="match-list">${item.pairs.map((p, i) => `
          <li><span class="match-prompt">${esc(p.prompt)}</span>
            <select id="match-${i}" aria-label="Answer for question ${i + 1}">
              <option value="">Choose…</option>
              ${item.choices.map((c, j) => `<option value="${j}">${esc(c)}</option>`).join('')}
            </select></li>`).join('')}
        </ol>
        <button class="btn accent" data-action="submitMatch" id="match-submit">Check</button>`;
    } else {
      body = `
        <p class="kbd-hint">Each line is a question and a proposed answer. Tick every pair that is correct.</p>
        <ul class="multi-list">${item.statements.map((st, i) => `
          <li><label><input type="checkbox" id="multi-${i}">
            <span><span class="multi-q">${esc(st.q.text)}</span> <span class="multi-a">→ ${esc(st.answer)}</span></span></label></li>`).join('')}
        </ul>
        <button class="btn accent" data-action="submitMulti" id="multi-submit">Check</button>`;
    }
    content.innerHTML = `
      <div class="q-header">Question ${s.index + 1} of ${s.data.length} · ${names[item.kind]}${s.combo >= 2 ? ` <span class="combo-chip">🔥 ${s.combo} in a row</span>` : ''}</div>
      ${this.listenButtonHtml ? `<div class="q-tools">${this.listenButtonHtml()}</div>` : ''}
      ${body}
      <div id="instant-feedback" class="instant-feedback hidden" aria-live="polite"></div>`;
    footer.innerHTML = `<button class="btn" data-action="exitSession">Exit</button><div style="flex:1"></div><button class="btn accent" data-action="nextQuestion" id="next-q-btn" disabled>Next →</button>`;
    const input = document.getElementById('typed-answer');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (s.answers[s.index] === undefined) this.submitTyped();
        else this.nextQuestion();
      });
      input.focus();
    }
  },

  _mixedItem() {
    const s = this.state.session;
    if (!s || s.type !== 'mixed' || s.answers[s.index] !== undefined) return null;
    return s.data[s.index] || null;
  },

  answerTF(value) {
    const item = this._mixedItem();
    if (!item || item.kind !== 'tf') return;
    const said = value === 'true';
    const right = said === item.truth;
    document.querySelectorAll('.tf-btn').forEach(b => {
      b.disabled = true;
      if ((b.dataset.param === 'true') === item.truth) b.classList.add('correct');
      else if ((b.dataset.param === 'true') === said) b.classList.add('wrong');
    });
    const answer = correctText(item.q);
    this._finishMixed(right, item.truth
      ? `True: ${this.escapeHtml(answer)} is the answer.`
      : `False: the answer is ${this.escapeHtml(answer)}, not ${this.escapeHtml(item.proposed)}.`, item.q, [{ id: item.q.id, right }]);
  },

  submitTyped() {
    const item = this._mixedItem();
    const input = document.getElementById('typed-answer');
    if (!item || item.kind !== 'typed' || !input) return;
    const typed = input.value.trim();
    if (!typed) { input.focus(); return; }
    const right = checkTyped(typed, item.answer, wrongOptions(item.q));
    input.readOnly = true;
    input.classList.add(right ? 'correct' : 'wrong');
    document.getElementById('typed-submit')?.setAttribute('disabled', '');
    this._finishMixed(right, right
      ? `The answer is ${this.escapeHtml(item.answer)}.`
      : `You wrote “${this.escapeHtml(typed)}”. The answer is <strong>${this.escapeHtml(item.answer)}</strong>.`, item.q, [{ id: item.q.id, right }]);
  },

  submitMatch() {
    const item = this._mixedItem();
    if (!item || item.kind !== 'match') return;
    const chosen = item.pairs.map((_, i) => document.getElementById(`match-${i}`)?.value ?? '');
    if (chosen.some(v => v === '')) { this.showToast('Choose an answer for every question.', 'info'); return; }
    let rightCount = 0;
    const perQuestion = [];
    item.pairs.forEach((p, i) => {
      const sel = document.getElementById(`match-${i}`);
      const ok = item.choices[Number(chosen[i])] === p.answer;
      perQuestion.push({ id: p.q.id, right: ok });
      if (ok) rightCount++;
      if (sel) { sel.disabled = true; sel.classList.add(ok ? 'correct' : 'wrong'); }
    });
    document.getElementById('match-submit')?.setAttribute('disabled', '');
    const right = rightCount === item.pairs.length;
    const key = item.pairs.map((p, i) => `<li>${this.escapeHtml(p.prompt.slice(0, 80))} → <strong>${this.escapeHtml(p.answer)}</strong></li>`).join('');
    this._finishMixed(right, `${rightCount} of ${item.pairs.length} matched correctly.${right ? '' : `<ol class="match-key">${key}</ol>`}`, null, perQuestion);
  },

  submitMulti() {
    const item = this._mixedItem();
    if (!item || item.kind !== 'multi') return;
    let wrongCount = 0;
    const perQuestion = [];
    item.statements.forEach((st, i) => {
      const box = document.getElementById(`multi-${i}`);
      const ticked = !!box?.checked;
      if (ticked !== st.truth) wrongCount++;
      perQuestion.push({ id: st.q.id, right: ticked === st.truth });
      if (box) {
        box.disabled = true;
        box.closest('li')?.classList.add(st.truth ? 'correct' : 'wrong-pair', ticked === st.truth ? 'got' : 'missed');
      }
    });
    document.getElementById('multi-submit')?.setAttribute('disabled', '');
    const truths = item.statements.filter(st => st.truth).length;
    this._finishMixed(wrongCount === 0, wrongCount === 0
      ? `All ${truths} correct pair${truths === 1 ? '' : 's'} found.`
      : `${truths} pair${truths === 1 ? ' was' : 's were'} correct (marked in green); ${wrongCount} of your choices were off.`, null, perQuestion);
  },

  /** Shared by every mixed format: record, explain, combo and XP. */
  _finishMixed(right, detailHtml, q = null, perQuestion = []) {
    const s = this.state.session;
    s.answers[s.index] = { right };
    s.combo = right ? s.combo + 1 : 0;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    const xp = right ? XP.correct : XP.attempt;
    s.xp += xp;
    const nextBtn = document.getElementById('next-q-btn');
    if (nextBtn) nextBtn.disabled = false;
    const box = document.getElementById('instant-feedback');
    if (box) {
      box.className = `instant-feedback ${right ? 'right' : 'wrong'}`;
      box.innerHTML = `
        <div class="if-head"><strong>${right ? '✓ Correct!' : '✗ Not quite.'}</strong>
          <span class="xp-pop">+${xp} XP</span>
          ${s.combo >= 2 ? `<span class="combo-chip">🔥 ${s.combo} in a row</span>` : ''}</div>
        <div class="if-answer">${detailHtml}</div>
        ${q?.explanation ? `<div class="if-exp">${this.escapeHtml(q.explanation)}</div>` : ''}
        ${q?.id !== undefined && q ? `<button class="btn small" data-action="reportQuestion" data-param="${q.id}">Report wrong answer</button>` : ''}
        ${q ? this.starNoteHtml?.('q', q) || '' : ''}`;
    }
    this.recordAnswers?.(perQuestion);
    this.logActivity({ xp, answered: 1, correct: right ? 1 : 0, mixed: 1, bestCombo: s.combo })
      .catch(e => console.error('Could not log activity', e));
  },

  startSessionTimer() {
    const el = document.getElementById('session-timer');
    const start = this.state.session.startTime;
    if (this.state.sessionTimer) clearInterval(this.state.sessionTimer);
    this.state.sessionTimer = setInterval(() => {
      const diff = Date.now() - start;
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (el) el.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, 1000);
  },

  async exitSession(force) {
    if (force === 'force' || await this.confirmAction('Are you sure you want to exit?')) {
      if (this.state.sessionTimer) clearInterval(this.state.sessionTimer);
      this.stopSpeaking?.();
      // Flashcard and mixed-practice time counts as study time (test time is saved with the test).
      const s = this.state.session;
      if ((s?.type === 'flashcard' || s?.type === 'mixed') && !s.timeLogged) {
        s.timeLogged = true;
        const seconds = Math.min(MAX_SESSION_SECONDS, Math.round((Date.now() - s.startTime) / 1000));
        if (seconds > 0) this.logActivity({ seconds }).catch(e => console.error('Could not log activity', e));
      }
      this.hideSubView('active-session-overlay');
      if (this.resumeParticles) this.resumeParticles();
      this.updateDashboard();
    }
  },

  // --- Focus Timer (Preact) ---
  showFocusTimer() {
    const overlay = document.getElementById('focus-timer-overlay');
    const mountNode = document.getElementById('focus-timer-mount');
    if (overlay) overlay.classList.remove('hidden');
    if (mountNode) {
      render(h(FocusTimer, {
        onClose: () => {
          render(null, mountNode);
          if (overlay) overlay.classList.add('hidden');
        }
      }), mountNode);
    }
  },

  // --- PDF Export ---
  async exportSessionPDF() {
    const s = this.state.session;
    if (!s || !s.data) return;
    const { jsPDF } = await import('jspdf'); // ~350 KB; only needed on export
    const doc = new jsPDF();
    const PAGE_BOTTOM = 280;
    let y = 20;
    // Write wrapped text, starting a new page whenever a line would run off the bottom.
    const write = (text, { x = 20, size = 12, style = 'normal', gap = 6, width = 170 } = {}) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      for (const line of doc.splitTextToSize(toPdfText(text), width)) {
        if (y > PAGE_BOTTOM) { doc.addPage(); y = 20; }
        doc.text(line, x, y);
        y += gap;
      }
    };

    const examId = s.data[0]?.exam;
    const examName = this.state.userExams.find(e => e.id === examId)?.name || this.state.activeExam?.name || 'N/A';
    let correctCount = 0;
    s.data.forEach((q, i) => { if (s.answers[i] && s.answers[i] === answerToLetter(q)) correctCount++; });
    const score = Math.round((correctCount / s.data.length) * 100);

    write(`Woni ${s.title} Results`, { size: 20, style: 'bold', gap: 10 });
    write(`Date: ${new Date().toLocaleString()}`);
    write(`Exam: ${examName}`, { gap: 10 });
    write(`Score: ${score}% (${correctCount}/${s.data.length})`, { size: 16, style: 'bold', gap: 12 });
    s.data.forEach((q, i) => {
      write(`${i + 1}. ${q.text || q.question || 'No text'}`, { style: 'bold' });
      const correct = answerToLetter(q) || q.answer || '?';
      const mark = s.answers[i] === correct ? 'correct' : 'wrong';
      write(`Your answer: ${s.answers[i] || 'None'} | Correct: ${correct} (${mark})`, { x: 25, width: 165, gap: 10 });
    });
    this.saveFile(`Woni_Result_${Date.now()}.pdf`, doc.output('blob'));
  },
};
