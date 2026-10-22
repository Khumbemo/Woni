/**
 * Woni — Practice View Module
 * Mock tests, flashcards, topic mastery, focus timer, and SM-2 algorithm.
 */
import { h, render } from 'preact';
import FocusTimer from '../components/FocusTimer.jsx';
import { shuffle, answerToLetter, sm2, toPdfText, updateMastery } from '../utils.js';

export const practiceMixin = {
  async updatePracticeView() {
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
    this.showSubView('mock-test-setup');
  },

  async startMockTest() {
    const examId = document.getElementById('mock-exam-select')?.value;
    const rawCount = parseInt(document.getElementById('mock-q-count')?.value, 10);
    const qCount = Math.min(100, Math.max(1, Number.isFinite(rawCount) ? rawCount : 10));
    const selectedTopics = Array.from(document.querySelectorAll('#mock-topic-checks input:checked')).map(i => i.value);
    const started = await this.startTopicTest(examId, selectedTopics, qCount);
    if (started) this.hideSubView('mock-test-setup');
  },

  /** Start a mock test from the bank, optionally limited to some topics. Returns false if there were no questions. */
  async startTopicTest(examId, topics = [], qCount = 10) {
    let allQuestions = await this.dbGetFromIndex('questions', 'exam', examId);
    if (topics.length > 0) {
      allQuestions = allQuestions.filter(q => topics.includes(q.topic));
    }
    if (allQuestions.length === 0) {
      this.showToast('No questions found for the selected criteria.', 'info');
      return false;
    }
    this.openSession('Mock Test', 'test', shuffle(allQuestions).slice(0, qCount));
    return true;
  },

  async startFlashcards() {
    const examId = this.state.activeExam?.id;
    // Cards saved before flashcards recorded their exam (no `exam`) show for every exam.
    const cards = (await this.dbGetAll('flashcards')).filter(c => !examId || !c.exam || c.exam === examId);
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

  openSession(title, type, data) {
    this.state.session = { title, type, data, index: 0, startTime: Date.now(), answers: [], score: 0, busy: false };
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

    if (!item) {
      this.renderSessionResults();
      return;
    }

    if (s.type === 'test') {
      content.innerHTML = `
        <div class="q-header">Question ${s.index + 1} of ${s.data.length}</div>
        <div class="q-text">${this.escapeHtml(item.text)}</div>
        <div class="options-grid">
          ${(item.options || []).map((opt, i) => `
            <button class="option-btn" data-action="selectOption" data-param="${i}">
              <span class="opt-letter">${String.fromCharCode(65 + i)}</span>
              <span class="opt-text">${this.escapeHtml(opt)}</span>
            </button>
          `).join('')}
        </div>
      `;
      footer.innerHTML = `<button class="btn" data-action="exitSession">Exit</button><div style="flex:1"></div><button class="btn accent" data-action="nextQuestion" id="next-q-btn" disabled>Next →</button>`;
    } else {
      content.innerHTML = `
        <div class="card-count">Card ${s.index + 1} of ${s.data.length}</div>
        <div class="flashcard-box" id="flashcard-box" data-action="flipCard">
          <div class="card-front">${this.escapeHtml(item.front)}</div>
          <div class="card-back">${this.escapeHtml(item.back)}</div>
        </div>
        <p class="muted" style="text-align:center;margin-top:16px">Tap card to flip</p>
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
    const btns = document.querySelectorAll('.option-btn');
    btns.forEach(b => b.classList.remove('selected'));
    if (btns[i]) btns[i].classList.add('selected');
    s.answers[s.index] = String.fromCharCode(65 + i);
    const nextBtn = document.getElementById('next-q-btn');
    if (nextBtn) nextBtn.disabled = false;
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
      content.innerHTML = `<div class="results-box"><div class="res-score">${score}%</div><p>${correctCount} correct out of ${s.data.length}</p><p class="muted">Time: ${timerEl ? timerEl.textContent : ''}</p><button class="btn small accent" data-action="exportSessionPDF" style="margin-top:20px">Export Results PDF</button></div>`;

      for (const topicName in topicStats) {
        const stats = topicStats[topicName];
        const examId = s.data[0].exam;
        const topicId = `${examId}_${topicName}`;
        let topic = await this.dbGet('topics', topicId);
        if (!topic) topic = { id: topicId, exam: examId, name: topicName, mastery: 0, frequency: 50 };
        const sessionMastery = (stats.correct / stats.total) * 100;
        topic.mastery = updateMastery(topic.mastery, topic.attempts, sessionMastery);
        topic.attempts = (topic.attempts || 0) + 1;
        await this.dbPut('topics', topic);
      }
      await this.dbAdd('mock_tests', { exam: s.data[0].exam, date: Date.now(), score, qCount: s.data.length, duration: timerEl ? timerEl.textContent : '', answers: s.answers, questions: s.data });
    } else {
      content.innerHTML = `<div class="results-box"><h3>Review Complete!</h3><p>You've reviewed ${s.data.length} cards today.</p></div>`;
    }
    footer.innerHTML = `<button class="btn accent large" data-action="exitSession" data-param="force">Finish</button>`;
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
