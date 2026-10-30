/**
 * Woni — Question Bank
 * Browse, search, edit, report and delete saved questions, and the papers
 * they came from. Editing a question also rewrites its flashcard.
 */
import { answerToLetter } from '../utils.js';

const PAGE = 50;

/** Flashcard text for a question (shared with the upload flow). */
export function flashcardBack(q) {
  const letter = answerToLetter(q);
  const answerText = letter ? `${letter}) ${q.options[letter.charCodeAt(0) - 65]}` : q.answer;
  return `Answer: ${answerText}${q.explanation ? `\n\nExplanation: ${q.explanation}` : ''}`;
}

export const bankMixin = {
  /** Flashcards made from this question (by sync id; older cards by their text). */
  async linkedFlashcards(q) {
    const cards = await this.dbGetAll('flashcards');
    return cards.filter(c => (c.questionSyncId && c.questionSyncId === q.syncId)
      || (!c.questionSyncId && c.front === q.text && (!c.exam || c.exam === q.exam)));
  },

  async showQuestionBank() {
    this.state.bank = { query: '', filter: 'all', shown: PAGE };
    const search = document.getElementById('bank-search');
    const filter = document.getElementById('bank-filter');
    if (search) {
      search.value = '';
      search.oninput = () => { this.state.bank.query = search.value; this.state.bank.shown = PAGE; this.renderQuestionBank(); };
    }
    if (filter) {
      filter.value = 'all';
      filter.onchange = () => { this.state.bank.filter = filter.value; this.state.bank.shown = PAGE; this.renderQuestionBank(); };
    }
    this.showSubView('question-bank-overlay');
    await this.renderQuestionBank();
    search?.focus();
  },

  hideQuestionBank() {
    this.hideSubView('question-bank-overlay');
    if (this.state.currentView) this.showView(this.state.currentView);
  },

  async renderQuestionBank() {
    const list = document.getElementById('bank-list');
    const summary = document.getElementById('bank-summary');
    if (!list || !this.state.bank) return;
    const examId = this.state.activeExam?.id;
    const all = examId ? await this.dbGetFromIndex('questions', 'exam', examId) : await this.dbGetAll('questions');
    const { query, filter, shown } = this.state.bank;
    const q = query.trim().toLowerCase();
    const matches = all.filter(item => {
      if (filter === 'reported' && !item.flagged) return false;
      if (filter === 'ai' && item.answerSource === 'paper') return false;
      if (filter === 'disputed' && item.recheck?.agrees !== false) return false;
      if (!q) return true;
      return [item.text, item.topic, item.explanation, ...(item.options || [])].some(s => String(s || '').toLowerCase().includes(q));
    }).sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));

    const reported = all.filter(x => x.flagged).length;
    if (summary) summary.textContent = `${matches.length} of ${all.length} questions${reported ? ` · ${reported} reported` : ''}`;
    if (matches.length === 0) {
      list.innerHTML = `<p class="muted bank-empty">${all.length ? 'No questions match.' : 'No saved questions yet. Analyze a paper in Upload to add some.'}</p>`;
      return;
    }
    list.innerHTML = matches.slice(0, shown).map(item => {
      const letter = answerToLetter(item);
      const badges = [
        item.flagged ? '<span class="ar-badge bad">Reported</span>' : '',
        item.answerSource === 'ai' ? '<span class="ar-badge warn">AI answer</span>' : '',
        item.recheck?.agrees === false ? '<span class="ar-badge bad">Disputed</span>' : '',
      ].join('');
      return `
        <div class="bank-item">
          <div class="bank-text">${this.escapeHtml(item.text || '')}</div>
          <div class="bank-meta">${this.escapeHtml(item.topic || 'General')} · Answer ${this.escapeHtml(letter || String(item.answer || '?'))}${badges}</div>
          <div class="bank-actions">
            <button class="btn small" data-action="editQuestion" data-param="${item.id}">Edit</button>
            <button class="btn small danger" data-action="deleteQuestion" data-param="${item.id}">Delete</button>
          </div>
        </div>`;
    }).join('') + (matches.length > shown
      ? `<button class="btn bank-more" data-action="showMoreQuestions">Show ${Math.min(PAGE, matches.length - shown)} more</button>` : '');
  },

  showMoreQuestions() {
    this.state.bank.shown += PAGE;
    this.renderQuestionBank();
  },

  async editQuestion(id) {
    const q = await this.dbGet('questions', parseInt(id, 10));
    if (!q) return;
    this.state.editingQuestionId = q.id;
    const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v ?? ''; };
    set('qe-text', q.text);
    set('qe-options', (q.options || []).join('\n'));
    set('qe-answer', answerToLetter(q) || 'A');
    set('qe-explanation', q.explanation);
    set('qe-topic', q.topic);
    const note = document.getElementById('qe-note');
    if (note) {
      note.textContent = q.flagged ? 'You reported this question. Saving your corrections clears the report.' : '';
      note.classList.toggle('hidden', !q.flagged);
    }
    this.showSubView('question-edit-overlay');
    document.getElementById('qe-text')?.focus();
  },

  cancelQuestionEdit() {
    this.state.editingQuestionId = null;
    this.hideSubView('question-edit-overlay');
  },

  async saveQuestionEdit() {
    const q = await this.dbGet('questions', this.state.editingQuestionId);
    if (!q) { this.cancelQuestionEdit(); return; }
    const val = elId => (document.getElementById(elId)?.value || '').trim();
    const text = val('qe-text');
    const options = val('qe-options').split('\n').map(s => s.trim()).filter(Boolean);
    const answer = val('qe-answer').toUpperCase();
    if (text.length < 5) { this.showToast('The question needs some text.', 'error'); return; }
    if (options.length < 2 || options.length > 8) { this.showToast('Enter 2 to 8 options, one per line.', 'error'); return; }
    const idx = answer.charCodeAt(0) - 65;
    if (!/^[A-H]$/.test(answer) || idx >= options.length) {
      this.showToast(`The answer must be one of A–${String.fromCharCode(64 + options.length)}.`, 'error');
      return;
    }

    const cards = await this.linkedFlashcards(q);
    Object.assign(q, { text, options, answer, explanation: val('qe-explanation'), topic: val('qe-topic') || 'General' });
    // The student checked it, so earlier doubts no longer apply.
    q.answerSource = 'edited';
    delete q.flagged; delete q.flaggedAt; delete q.recheck;
    await this.dbPut('questions', q);
    for (const c of cards) {
      Object.assign(c, { front: q.text, back: flashcardBack(q), topic: q.topic, questionSyncId: q.syncId });
      delete c.flagged;
      await this.dbPut('flashcards', c);
    }
    this.cancelQuestionEdit();
    this.showToast(cards.length ? 'Question and its flashcard updated.' : 'Question updated.', 'success');
    this.renderQuestionBank();
  },

  async deleteQuestion(id) {
    const q = await this.dbGet('questions', parseInt(id, 10));
    if (!q) return;
    if (!(await this.confirmAction('Delete this question and its flashcard? This also removes it from your other synced devices.'))) return;
    for (const c of await this.linkedFlashcards(q)) await this.dbDelete('flashcards', c.id);
    await this.dbDelete('questions', q.id);
    this.showToast('Question deleted.', 'success');
    this.renderQuestionBank();
  },

  /** Mark a question (and its flashcards) as having a wrong answer; reported items leave tests until fixed. */
  async reportQuestion(id) {
    const q = await this.dbGet('questions', parseInt(id, 10));
    if (!q) return;
    if (!q.flagged) {
      q.flagged = true;
      q.flaggedAt = Date.now();
      await this.dbPut('questions', q);
      for (const c of await this.linkedFlashcards(q)) {
        c.flagged = true;
        await this.dbPut('flashcards', c);
      }
    }
    document.querySelectorAll(`[data-action="reportQuestion"][data-param="${q.id}"]`).forEach(b => {
      b.disabled = true;
      b.textContent = 'Reported';
    });
    this.showToast('Reported. It is left out of tests until you fix it in Practice → Question Bank.', 'info');
  },

  /** Report the flashcard on screen. Cards made from a question report that question too. */
  async reportFlashcard() {
    const s = this.state.session;
    const card = s?.data?.[s.index];
    if (!card) return;
    card.flagged = true;
    await this.dbPut('flashcards', card);
    const questions = card.exam ? await this.dbGetFromIndex('questions', 'exam', card.exam) : await this.dbGetAll('questions');
    const q = questions.find(x => (card.questionSyncId && x.syncId === card.questionSyncId) || x.text === card.front);
    if (q && !q.flagged) {
      q.flagged = true;
      q.flaggedAt = Date.now();
      await this.dbPut('questions', q);
    }
    const btn = document.getElementById('report-card-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Reported'; }
    this.showToast('Reported. Fix or delete it in Practice → Question Bank.', 'info');
  },

  // --- Papers ---
  async renderPaperList() {
    const wrap = document.getElementById('paper-list-wrap');
    const list = document.getElementById('paper-list');
    if (!wrap || !list) return;
    const examId = this.state.activeExam?.id;
    const papers = (examId ? await this.dbGetFromIndex('papers', 'exam', examId) : await this.dbGetAll('papers'))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    wrap.classList.toggle('hidden', papers.length === 0);
    list.innerHTML = papers.map(p => `
      <div class="uz-file">
        <span class="file-item-info">
          <i data-lucide="file-text" class="file-icon-mini"></i>
          ${this.escapeHtml(p.name || 'Paper')}
          <span class="muted">${p.timestamp ? new Date(p.timestamp).toLocaleDateString() : ''}</span>
        </span>
        <button class="remove-file-btn" data-action="deletePaper" data-param="${p.id}" aria-label="Delete ${this.escapeHtml(p.name || 'paper')}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>`).join('');
    this.updateLucide();
  },

  async deletePaper(id) {
    const paper = await this.dbGet('papers', parseInt(id, 10));
    if (!paper) return;
    if (!(await this.confirmAction(`Delete the paper "${paper.name}"? Questions already saved from it stay in your bank.`))) return;
    await this.dbDelete('papers', paper.id);
    this.showToast('Paper deleted.', 'success');
    this.renderPaperList();
  },
};
