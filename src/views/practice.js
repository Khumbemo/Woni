/**
 * Woni — Practice View Module
 * Mock tests, flashcards, topic mastery, focus timer, and SM-2 algorithm.
 */
import { h, render } from 'preact';
import FocusTimer from '../components/FocusTimer.jsx';
import { jsPDF } from 'jspdf';

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
    const qCount = parseInt(document.getElementById('mock-q-count')?.value) || 10;
    const selectedTopics = Array.from(document.querySelectorAll('#mock-topic-checks input:checked')).map(i => i.value);

    let allQuestions = await this.dbGetFromIndex('questions', 'exam', examId);
    if (selectedTopics.length > 0) {
      allQuestions = allQuestions.filter(q => selectedTopics.includes(q.topic));
    }

    if (allQuestions.length === 0) {
      this.showToast('No questions found for the selected criteria.', 'info');
      return;
    }

    const selected = allQuestions.sort(() => 0.5 - Math.random()).slice(0, qCount);
    this.hideSubView('mock-test-setup');
    this.openSession('Mock Test', 'test', selected);
  },

  async startFlashcards() {
    const cards = await this.dbGetAll('flashcards');
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
    this.state.session = { title, type, data, index: 0, startTime: Date.now(), answers: [], score: 0 };
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
          <div class="card-back">${this.escapeHtml(item.back).replace(/\\n/g, '<br>')}</div>
        </div>
        <p class="muted" style="text-align:center;margin-top:16px">Tap card to flip</p>
      `;
      footer.innerHTML = `
        <div class="sm2-btns hidden" id="sm2-btns">
          <button class="btn danger" data-action="rateCard" data-param="0">Again</button>
          <button class="btn" style="color:var(--gold)" data-action="rateCard" data-param="2">Hard</button>
          <button class="btn" style="color:var(--green)" data-action="rateCard" data-param="3">Good</button>
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
    this.state.session.index++;
    this.renderSessionContent();
  },

  /**
   * SM-2 Spaced Repetition Algorithm
   * Quality scale: 0=Again, 2=Hard, 3=Good, 5=Easy
   */
  async rateCard(quality) {
    quality = parseInt(quality);
    const s = this.state.session;
    const card = s.data[s.index];
    let { interval, repetition, ease } = card;

    ease = ease || 2.5;

    if (quality >= 3) {
      if (repetition === 0) interval = 1;
      else if (repetition === 1) interval = 6;
      else interval = Math.round(interval * ease);
      repetition++;
    } else {
      repetition = 0;
      interval = 1;
    }

    // SM-2 ease factor formula
    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    ease = Math.max(1.3, ease); // Floor at 1.3

    card.interval = interval;
    card.repetition = repetition;
    card.ease = ease;
    card.nextReview = Date.now() + (interval * 24 * 60 * 60 * 1000);
    await this.dbPut('flashcards', card);
    s.index++;
    this.renderSessionContent();
  },

  async renderSessionResults() {
    const s = this.state.session;
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
        if (s.answers[i] === q.answer) { correctCount++; topicStats[topicName].correct++; }
      });
      const score = Math.round((correctCount / s.data.length) * 100);
      content.innerHTML = `<div class="results-box"><div class="res-score">${score}%</div><p>${correctCount} correct out of ${s.data.length}</p><p class="muted">Time: ${timerEl ? timerEl.textContent : ''}</p><button class="btn small accent" data-action="exportSessionPDF" style="margin-top:20px">Export Results PDF</button></div>`;

      for (const topicName in topicStats) {
        const stats = topicStats[topicName];
        const examId = s.data[0].exam;
        const topicId = `${examId}_${topicName}`;
        let topic = await this.dbGet('topics', topicId);
        if (!topic) topic = { id: topicId, exam: examId, name: topicName, mastery: 0, frequency: 50 };
        const currentMastery = topic.mastery || 0;
        const sessionMastery = (stats.correct / stats.total) * 100;
        topic.mastery = Math.round((currentMastery + sessionMastery) / 2);
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

  exitSession(force) {
    if (force === 'force' || confirm('Are you sure you want to exit?')) {
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
  exportSessionPDF() {
    const s = this.state.session;
    if (!s || !s.data) return;
    const doc = new jsPDF();
    doc.setFontSize(20); doc.text(`Woni ${s.title} Results`, 20, 20);
    doc.setFontSize(12); doc.text(`Date: ${new Date().toLocaleString()}`, 20, 30);
    doc.text(`Exam: ${this.state.activeExam?.name || 'N/A'}`, 20, 40);
    let correctCount = 0;
    s.data.forEach((q, i) => { if (s.answers[i] === q.answer) correctCount++; });
    const score = Math.round((correctCount / s.data.length) * 100);
    doc.setFontSize(16); doc.text(`Score: ${score}% (${correctCount}/${s.data.length})`, 20, 55);
    doc.setFontSize(12); let y = 70;
    s.data.forEach((q, i) => {
      if (y > 260) { doc.addPage(); y = 20; }
      const qText = q.text || q.question || "No text";
      const lines = doc.splitTextToSize(`${i + 1}. ${qText}`, 170);
      doc.setFont('helvetica', 'bold');
      doc.text(lines, 20, y);
      y += (lines.length * 6);
      doc.setFont('helvetica', 'normal');
      doc.text(`Your Answer: ${s.answers[i] || 'None'} | Correct: ${q.answer}`, 25, y);
      y += 10;
    });
    doc.save(`Woni_Result_${Date.now()}.pdf`);
  },
};
