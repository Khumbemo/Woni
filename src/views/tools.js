/**
 * Woni — study tools: mistake notebook, bookmarks & notes, AI flashcards &
 * summaries, daily reminders and read-aloud.
 */
import { toPdfText } from '../utils.js';
import {
  updateMistake, inNotebook, pickMistakes, cleanAiCards, cleanAiSummary, summaryText,
  parseTime, buildReminderIcs, nextReminderAt, questionSpeech, NOTES_MAX_CHARS,
} from '../studytools.js';

const REMINDER_KEY = 'woni_reminder_time';
const REMINDER_NOTIFY_KEY = 'woni_reminder_notify';
const MAX_NOTE = 1000;
const MAX_BOOK_PAGES = 15;

export const toolsMixin = {
  // --- Mistake notebook --------------------------------------------------------

  /**
   * Record answers to bank questions: [{ id, right }]. Wrong answers go into
   * the mistake notebook; two right answers in a row take them out.
   * Queued, so overlapping calls can't overwrite each other.
   */
  recordAnswers(results) {
    const list = (results || []).filter(r => r && r.id !== undefined && r.id !== null);
    const run = this._answerQueue.then(async () => {
      if (!this.state.db) return;
      for (const { id, right } of list) {
        const q = await this.dbGet('questions', id);
        if (!q) continue;
        const next = updateMistake(q.mistake, !!right, Date.now());
        if (next === null && !q.mistake) continue; // right first time: nothing to store
        q.mistake = next;
        await this.dbPut('questions', q);
      }
    });
    this._answerQueue = run.catch(() => {});
    return run;
  },

  _answerQueue: Promise.resolve(),

  async mistakeCount() {
    const examId = this.state.activeExam?.id;
    if (!examId || !this.state.db) return 0;
    return (await this.dbGetFromIndex('questions', 'exam', examId)).filter(inNotebook).length;
  },

  async startMistakeReview() {
    const examId = this.state.activeExam?.id;
    if (!examId) { this.showToast('Choose your exam first.', 'info'); return; }
    await this._answerQueue;
    const picked = pickMistakes(await this.dbGetFromIndex('questions', 'exam', examId));
    if (picked.length === 0) {
      this.showToast('Your mistake notebook is empty. Questions you get wrong will appear here.', 'info');
      return;
    }
    this.openSession('Mistake Review', 'test', picked, { instant: true });
  },

  /** Practice tab: show how many mistakes are waiting. */
  async updateToolCounts() {
    const set = (id, n, word) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n ? `${n} ${word}${n === 1 ? '' : 's'}` : '';
    };
    set('mistake-count', await this.mistakeCount(), 'question');
    const examId = this.state.activeExam?.id;
    if (examId && this.state.db) {
      const qs = (await this.dbGetFromIndex('questions', 'exam', examId)).filter(q => q.starred).length;
      const cs = (await this.dbGetAll('flashcards')).filter(c => c.starred && (!c.exam || c.exam === examId)).length;
      set('starred-count', qs + cs, 'item');
    }
  },

  // --- Bookmarks & notes ----------------------------------------------------------

  /** "q:12" or "c:5" -> ['questions', 12]. */
  _ref(param) {
    const [kind, id] = String(param || '').split(':');
    const store = kind === 'q' ? 'questions' : kind === 'c' ? 'flashcards' : null;
    const key = parseInt(id, 10);
    return store && Number.isFinite(key) ? [store, key] : [null, null];
  },

  async toggleStar(param) {
    const [store, id] = this._ref(param);
    if (!store) return;
    const item = await this.dbGet(store, id);
    if (!item) return;
    item.starred = !item.starred;
    await this.dbPut(store, item);
    // Keep copies held by an open session in step.
    for (const it of this.state.session?.data || []) if (it?.id === id && (store === 'questions' ? it.text !== undefined : it.front !== undefined)) it.starred = item.starred;
    document.querySelectorAll(`[data-action="toggleStar"][data-param="${param}"]`).forEach(b => {
      b.classList.toggle('on', item.starred);
      b.setAttribute('aria-pressed', String(item.starred));
      b.textContent = item.starred ? '★ Starred' : '☆ Star';
    });
    this.showToast(item.starred ? 'Starred. Find it under Practice → Starred & Notes.' : 'Star removed.', 'info');
    if (!document.getElementById('starred-overlay')?.classList.contains('hidden')) this.renderStarred();
  },

  /** Star and note buttons (and the note, if any) for a question or flashcard. */
  starNoteHtml(kind, item) {
    if (!item || item.id === undefined) return '';
    const ref = `${kind}:${item.id}`;
    return `
      <div class="item-tools">
        <button class="btn small star-btn${item.starred ? ' on' : ''}" data-action="toggleStar" data-param="${ref}" aria-pressed="${!!item.starred}">${item.starred ? '★ Starred' : '☆ Star'}</button>
        <button class="btn small" data-action="editNote" data-param="${ref}">${item.note ? '📝 Edit note' : '📝 Add note'}</button>
      </div>
      ${item.note ? `<div class="item-note" data-note-for="${ref}"><strong>Your note:</strong> ${this.escapeHtml(item.note)}</div>` : `<div class="item-note hidden" data-note-for="${ref}"></div>`}`;
  },

  async editNote(param) {
    const [store, id] = this._ref(param);
    if (!store) return;
    const item = await this.dbGet(store, id);
    if (!item) return;
    this.state.noteRef = param;
    const ta = document.getElementById('note-text');
    const ctx = document.getElementById('note-context');
    if (ctx) ctx.textContent = store === 'questions' ? item.text : item.front;
    if (ta) ta.value = item.note || '';
    this.showSubView('note-overlay');
    ta?.focus();
  },

  cancelNote() {
    this.state.noteRef = null;
    this.hideSubView('note-overlay');
  },

  async saveNote() {
    const param = this.state.noteRef;
    const [store, id] = this._ref(param);
    if (!store) { this.cancelNote(); return; }
    const item = await this.dbGet(store, id);
    if (!item) { this.cancelNote(); return; }
    const note = (document.getElementById('note-text')?.value || '').trim().slice(0, MAX_NOTE);
    if (note) item.note = note; else delete item.note;
    await this.dbPut(store, item);
    for (const it of this.state.session?.data || []) if (it?.id === id && (store === 'questions' ? it.text !== undefined : it.front !== undefined)) it.note = item.note;
    document.querySelectorAll(`[data-note-for="${param}"]`).forEach(el => {
      el.classList.toggle('hidden', !note);
      el.innerHTML = note ? `<strong>Your note:</strong> ${this.escapeHtml(note)}` : '';
    });
    document.querySelectorAll(`[data-action="editNote"][data-param="${param}"]`).forEach(b => { b.textContent = note ? '📝 Edit note' : '📝 Add note'; });
    this.cancelNote();
    this.showToast(note ? 'Note saved.' : 'Note removed.', 'success');
    if (!document.getElementById('starred-overlay')?.classList.contains('hidden')) this.renderStarred();
  },

  async showStarred() {
    this.showSubView('starred-overlay');
    await this.renderStarred();
  },

  hideStarred() {
    this.hideSubView('starred-overlay');
    if (this.state.currentView === 'practice') this.updateToolCounts();
  },

  async _starredItems() {
    const examId = this.state.activeExam?.id;
    const qs = examId ? await this.dbGetFromIndex('questions', 'exam', examId) : await this.dbGetAll('questions');
    const cs = (await this.dbGetAll('flashcards')).filter(c => !examId || !c.exam || c.exam === examId);
    return {
      questions: qs.filter(q => q.starred || q.note),
      cards: cs.filter(c => c.starred || c.note),
    };
  },

  async renderStarred() {
    const list = document.getElementById('starred-list');
    if (!list) return;
    const { questions, cards } = await this._starredItems();
    const sq = questions.filter(q => q.starred).length;
    const sc = cards.filter(c => c.starred).length;
    const qBtn = document.getElementById('starred-practice-btn');
    const cBtn = document.getElementById('starred-cards-btn');
    if (qBtn) { qBtn.disabled = sq === 0; qBtn.textContent = `Practise ${sq} starred question${sq === 1 ? '' : 's'}`; }
    if (cBtn) { cBtn.disabled = sc === 0; cBtn.textContent = `Review ${sc} starred card${sc === 1 ? '' : 's'}`; }
    const row = (kind, item, text) => `
      <div class="bank-item">
        <div class="bank-text">${this.escapeHtml(text)}</div>
        ${this.starNoteHtml(kind, item)}
      </div>`;
    list.innerHTML = (questions.length || cards.length)
      ? [
        questions.length ? `<h4 class="task-group">Questions <span>${questions.length}</span></h4>${questions.map(q => row('q', q, q.text || '')).join('')}` : '',
        cards.length ? `<h4 class="task-group">Flashcards <span>${cards.length}</span></h4>${cards.map(c => row('c', c, c.front || '')).join('')}` : '',
      ].join('')
      : '<p class="muted bank-empty">Nothing starred yet. Use ☆ Star on a question or flashcard, or add a note.</p>';
  },

  async startStarredQuestions() {
    const { questions } = await this._starredItems();
    const starred = questions.filter(q => q.starred && !q.flagged);
    if (!starred.length) return;
    this.hideSubView('starred-overlay');
    this.openSession('Starred Questions', 'test', starred.slice(0, 50), { instant: true });
  },

  async startStarredCards() {
    const { cards } = await this._starredItems();
    const starred = cards.filter(c => c.starred && !c.flagged);
    if (!starred.length) return;
    this.hideSubView('starred-overlay');
    this.openSession('Starred Flashcards', 'flashcard', starred);
  },

  // --- AI flashcards & summaries ------------------------------------------------------

  async showAiNotes() {
    const sel = document.getElementById('ai-source');
    if (sel) {
      const examId = this.state.activeExam?.id;
      const papers = this.state.db ? (await this.dbGetAll('papers')).filter(p => !examId || p.exam === examId) : [];
      const books = this.state.db ? (await this.dbGetAll('library')).filter(b => !examId || b.exam === examId) : [];
      sel.innerHTML = [
        '<option value="paste">Paste or type text</option>',
        ...papers.map(p => `<option value="paper:${p.id}">Paper: ${this.escapeHtml(p.name || 'Untitled')}</option>`),
        ...books.map(b => `<option value="book:${b.id}">Book: ${this.escapeHtml(b.name || 'Untitled')}</option>`),
      ].join('');
      sel.onchange = () => this._aiSourceChanged();
      this._aiSourceChanged();
    }
    this.state.aiNotes = { cards: [], summary: null };
    this._renderAiOutput();
    this.showSubView('ai-notes-overlay');
  },

  hideAiNotes() {
    this.hideSubView('ai-notes-overlay');
  },

  _aiSourceChanged() {
    const v = document.getElementById('ai-source')?.value || 'paste';
    document.getElementById('ai-paste-wrap')?.classList.toggle('hidden', v !== 'paste');
    document.getElementById('ai-pages-wrap')?.classList.toggle('hidden', !v.startsWith('book:'));
  },

  /** The study text for the chosen source. Throws with a readable message. */
  async _aiSourceText(onProgress) {
    const v = document.getElementById('ai-source')?.value || 'paste';
    let text = '';
    if (v === 'paste') {
      text = document.getElementById('ai-text')?.value || '';
    } else if (v.startsWith('paper:')) {
      text = (await this.dbGet('papers', parseInt(v.slice(6), 10)))?.text || '';
    } else if (v.startsWith('book:')) {
      const book = await this.dbGet('library', parseInt(v.slice(5), 10));
      if (!book) throw new Error('That book is no longer on your shelf.');
      const from = Math.max(1, parseInt(document.getElementById('ai-page-from')?.value, 10) || 1);
      const to = Math.max(from, parseInt(document.getElementById('ai-page-to')?.value, 10) || from);
      if (to - from + 1 > MAX_BOOK_PAGES) throw new Error(`Choose at most ${MAX_BOOK_PAGES} pages at a time.`);
      const isPdf = (book.type || '').includes('pdf') || /\.pdf$/i.test(book.name || '');
      const data = book.data instanceof ArrayBuffer ? book.data : new Uint8Array(book.data || []).buffer;
      if (isPdf) {
        text = await this.extractPDFText(new File([data], book.name || 'book.pdf', { type: 'application/pdf' }), onProgress, { from, to });
      } else {
        text = new TextDecoder().decode(data);
      }
    }
    text = text.trim();
    if (text.length < 80) throw new Error('There is not enough text to work from. Paste a longer passage or choose other pages.');
    return text.slice(0, NOTES_MAX_CHARS);
  },

  async makeAiCards() { return this._runAi('cards'); },
  async makeAiSummary() { return this._runAi('summary'); },

  async _runAi(kind) {
    const status = document.getElementById('ai-status');
    const buttons = document.querySelectorAll('#ai-notes-overlay [data-ai-run]');
    const say = m => { if (status) status.textContent = m; };
    buttons.forEach(b => { b.disabled = true; });
    try {
      say('Reading the text...');
      const text = await this._aiSourceText(say);
      const examId = this.state.activeExam?.id || 'your exam';
      say(kind === 'cards' ? 'AI is writing flashcards...' : 'AI is writing a summary...');
      if (kind === 'cards') {
        const cards = cleanAiCards(await this.generateStudyCards(examId, text, say));
        if (!cards.length) throw new Error('The AI returned no flashcards. Try again or use a different passage.');
        this.state.aiNotes.cards = cards.map(c => ({ ...c, keep: true }));
        say(`${cards.length} flashcards ready. Edit or untick any, then save.`);
      } else {
        const summary = cleanAiSummary(await this.generateSummary(examId, text, say));
        if (!summary) throw new Error('The AI returned no summary. Try again or use a different passage.');
        this.state.aiNotes.summary = summary;
        say('Summary ready.');
      }
      this._renderAiOutput();
    } catch (e) {
      say('');
      this.showToast(e.message || 'Something went wrong.', 'error');
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  },

  _renderAiOutput() {
    const out = document.getElementById('ai-output');
    if (!out) return;
    const { cards = [], summary = null } = this.state.aiNotes || {};
    const esc = t => this.escapeHtml(t);
    let html = '';
    if (cards.length) {
      html += `<h4 class="task-group">Flashcards <span>${cards.length}</span></h4>
        <ol class="ai-cards">${cards.map((c, i) => `
          <li class="ai-card">
            <label class="ai-keep"><input type="checkbox" data-ai-keep="${i}" ${c.keep ? 'checked' : ''}> Keep</label>
            <textarea data-ai-front="${i}" rows="2" aria-label="Front of card ${i + 1}">${esc(c.front)}</textarea>
            <textarea data-ai-back="${i}" rows="2" aria-label="Back of card ${i + 1}">${esc(c.back)}</textarea>
          </li>`).join('')}
        </ol>
        <button class="btn accent" data-action="saveAiCards">Save ticked flashcards</button>`;
    }
    if (summary) {
      html += `<h4 class="task-group">Summary</h4>
        <article class="ai-summary">
          <h3>${esc(summary.title)}</h3>
          <ul>${summary.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          ${summary.keyTerms.length ? `<h4>Key terms</h4><dl>${summary.keyTerms.map(k => `<dt>${esc(k.term)}</dt><dd>${esc(k.meaning)}</dd>`).join('')}</dl>` : ''}
        </article>
        <div class="form-actions">
          <button class="btn" data-action="copySummary">Copy</button>
          <button class="btn accent" data-action="exportSummaryPDF">Save as PDF</button>
        </div>`;
    }
    out.innerHTML = html;
  },

  async saveAiCards() {
    const cards = (this.state.aiNotes?.cards || []).map((c, i) => ({
      keep: !!document.querySelector(`[data-ai-keep="${i}"]`)?.checked,
      front: (document.querySelector(`[data-ai-front="${i}"]`)?.value ?? c.front).trim(),
      back: (document.querySelector(`[data-ai-back="${i}"]`)?.value ?? c.back).trim(),
    })).filter(c => c.keep && c.front && c.back);
    if (!cards.length) { this.showToast('Tick at least one flashcard to save.', 'info'); return; }
    const examId = this.state.activeExam?.id || null;
    const existing = new Set((await this.dbGetAll('flashcards')).map(c => String(c.front).trim().toLowerCase()));
    let saved = 0;
    for (const c of cards) {
      if (existing.has(c.front.toLowerCase())) continue;
      existing.add(c.front.toLowerCase());
      await this.dbAdd('flashcards', { exam: examId, front: c.front, back: c.back, topic: 'AI notes', source: 'ai-notes', nextReview: Date.now(), interval: 0, repetition: 0, ease: 2.5 });
      saved++;
    }
    const skipped = cards.length - saved;
    this.showToast(`Saved ${saved} flashcard${saved === 1 ? '' : 's'}${skipped ? ` (${skipped} already in your deck)` : ''}. They're due for review now.`, 'success');
    this.state.aiNotes.cards = [];
    this._renderAiOutput();
  },

  async copySummary() {
    const text = summaryText(this.state.aiNotes?.summary);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.showToast('Summary copied.', 'success');
    } catch {
      this.showToast('Copying isn’t allowed here. Use Save as PDF instead.', 'error');
    }
  },

  async exportSummaryPDF() {
    const s = this.state.aiNotes?.summary;
    if (!s) return;
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    let y = 20;
    const write = (text, { size = 12, style = 'normal', gap = 6, x = 20, width = 170 } = {}) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      for (const line of doc.splitTextToSize(toPdfText(text), width)) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, x, y);
        y += gap;
      }
    };
    write(s.title, { size: 18, style: 'bold', gap: 10 });
    write(`Woni revision summary · ${new Date().toLocaleDateString()}`, { size: 10, gap: 10 });
    for (const p of s.points) write(`• ${p}`, { gap: 7 });
    if (s.keyTerms.length) {
      y += 4;
      write('Key terms', { size: 14, style: 'bold', gap: 8 });
      for (const k of s.keyTerms) write(`${k.term}: ${k.meaning}`, { gap: 7 });
    }
    write('Made by AI from your study text. Check important facts against your textbook.', { size: 9, style: 'italic', gap: 6 });
    this.saveFile(`Woni_Summary_${Date.now()}.pdf`, doc.output('blob'));
  },

  // --- Reminders -----------------------------------------------------------------------

  getReminderTime() {
    const t = localStorage.getItem(REMINDER_KEY);
    return parseTime(t) ? t : '';
  },

  /** Settings: remember the time and (re)schedule the in-app reminder. */
  async saveReminder() {
    const time = document.getElementById('reminder-time')?.value || '';
    if (!parseTime(time)) { this.showToast('Choose a time for your reminder.', 'error'); return; }
    localStorage.setItem(REMINDER_KEY, time);
    const notify = !!document.getElementById('reminder-notify')?.checked;
    if (notify && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* older Safari: callback form only */ }
    }
    localStorage.setItem(REMINDER_NOTIFY_KEY, String(notify));
    this.scheduleReminder();
    this.showToast(`Reminder set for ${time}.`, 'success');
  },

  /** A daily calendar event with an alert, for any phone or computer calendar. */
  addReminderToCalendar() {
    const time = document.getElementById('reminder-time')?.value || this.getReminderTime();
    const ics = buildReminderIcs(time);
    if (!ics) { this.showToast('Choose a time for your reminder first.', 'error'); return; }
    localStorage.setItem(REMINDER_KEY, time);
    this.saveFile('woni-daily-study.ics', new Blob([ics], { type: 'text/calendar' }));
    this.showToast('Open the downloaded file to add the daily reminder to your calendar.', 'info');
  },

  /**
   * While Woni is open, remind at the chosen time if the daily goal isn't met
   * yet. (Browsers can't wake a closed web app on a schedule without a server;
   * the calendar event covers that.)
   */
  scheduleReminder() {
    clearTimeout(this._reminderTimer);
    const time = this.getReminderTime();
    if (!time) return;
    const at = nextReminderAt(time);
    // setTimeout can't wait longer than ~24.8 days; a day is fine.
    this._reminderTimer = setTimeout(() => this._fireReminder(), Math.max(0, at - Date.now()));
  },

  async _fireReminder() {
    try {
      const stats = await this.getStudyStats();
      const goal = this.getDailyGoal();
      if ((stats.today.xp || 0) < goal) {
        const msg = `Time to study! ${goal - (stats.today.xp || 0)} XP to today's goal.`;
        const canNotify = localStorage.getItem(REMINDER_NOTIFY_KEY) === 'true'
          && typeof Notification !== 'undefined' && Notification.permission === 'granted';
        if (canNotify && document.visibilityState !== 'visible') {
          new Notification('Woni', { body: msg, icon: 'icons/icon-192.png', tag: 'woni-reminder' });
        } else {
          this.showToast(msg, 'info');
        }
      }
    } finally {
      this.scheduleReminder();
    }
  },

  initReminderSettings() {
    const input = document.getElementById('reminder-time');
    const notify = document.getElementById('reminder-notify');
    if (input) input.value = this.getReminderTime();
    if (notify) {
      notify.checked = localStorage.getItem(REMINDER_NOTIFY_KEY) === 'true';
      if (typeof Notification === 'undefined') notify.closest('label')?.classList.add('hidden');
    }
    this.scheduleReminder();
  },

  // --- Read aloud -------------------------------------------------------------------------

  canSpeak() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  },

  /** Read the current question (or flashcard side) aloud; pressing again stops. */
  readAloud() {
    if (!this.canSpeak()) return;
    const synth = window.speechSynthesis;
    if (synth.speaking) { synth.cancel(); this._setSpeaking(false); return; }
    const s = this.state.session;
    const item = s?.data?.[s.index];
    if (!item) return;
    let text = '';
    if (s.type === 'flashcard') {
      const flipped = document.getElementById('flashcard-box')?.classList.contains('flipped');
      text = flipped ? `${item.front}. Answer: ${item.back}` : item.front;
    } else if (s.type === 'mixed') {
      text = item.kind === 'tf' ? `${item.q.text} Proposed answer: ${item.proposed}. True or false?`
        : item.kind === 'typed' ? item.q.text
        : item.kind === 'match' ? item.pairs.map((p, i) => `${i + 1}. ${p.prompt}`).join(' ')
        : item.statements.map((st, i) => `${i + 1}. ${st.q.text} Answer: ${st.answer}.`).join(' ');
    } else {
      text = questionSpeech(item);
    }
    if (!text) return;
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 3000));
    u.lang = document.documentElement.lang || 'en';
    u.rate = 0.95;
    u.onend = u.onerror = () => this._setSpeaking(false);
    this._setSpeaking(true);
    synth.speak(u);
  },

  stopSpeaking() {
    if (this.canSpeak() && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    this._setSpeaking(false);
  },

  _setSpeaking(on) {
    document.querySelectorAll('[data-action="readAloud"]').forEach(b => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? '⏹ Stop' : '🔊 Listen';
    });
  },

  /** A "Listen" button for session screens (nothing if the browser can't speak). */
  listenButtonHtml() {
    return this.canSpeak() ? '<button class="btn small listen-btn" data-action="readAloud" aria-pressed="false">🔊 Listen</button>' : '';
  },
};
