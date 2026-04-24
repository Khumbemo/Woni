/**
 * Woni — Library View Module
 * Handles curated resources, cloud books, local book uploads, and admin panel.
 */
import firebase from 'firebase/compat/app';

export const libraryMixin = {
  updateLibraryView() {
    const tabs = document.getElementById('lib-exam-tabs');
    if (tabs) {
      tabs.innerHTML = this.state.userExams.map(ex => `
        <button class="lib-tab ${ex.id === this.state.activeLibExam ? 'active' : ''}"
                data-action="switchLibTab" data-param="${this.escapeHtml(ex.id)}">${this.escapeHtml(ex.name)}</button>
      `).join('');
    }
    this.renderLibraryContent();
  },

  switchLibTab(examId) {
    this.state.activeLibExam = examId;
    this._resetStudyChat();
    this.updateLibraryView();
  },

  async renderLibraryContent() {
    const container = document.getElementById('lib-subjects');
    if (!container) return;

    const examId = this.state.activeLibExam;
    const curated = JSON.parse(JSON.stringify(this.CURATED_RESOURCES[examId] || {}));

    container.innerHTML = '<div class="skeleton-card" style="height:120px"></div><div class="skeleton-card" style="height:120px"></div>';

    const userBooks = await this.dbGetFromIndex('library', 'exam', examId);
    let cloudBooks = [];

    // Fetch from Firestore (graceful degradation)
    try {
      if (this.db && this.state.user) {
        const snapshot = await this.db.collection('library_books')
          .where('exam', '==', examId)
          .get();
        snapshot.forEach(doc => { cloudBooks.push(doc.data()); });
      }
    } catch (e) {
      if (e.code === 'permission-denied') {
        console.warn('Cloud Library: Firestore access denied. Using local + curated resources only.');
      } else {
        console.error('Failed to fetch cloud books', e);
      }
    }

    // Group user books by subject
    const groupedUser = {};
    userBooks.forEach(b => {
      if (!groupedUser[b.subject]) groupedUser[b.subject] = [];
      groupedUser[b.subject].push({ title: b.name, id: b.id, isLocal: true });
    });

    // Group cloud books into curated
    cloudBooks.forEach(b => {
      if (!curated[b.subject]) curated[b.subject] = [];
      curated[b.subject].push({ title: b.title, url: b.url, isCloud: true });
    });

    // Merge subjects
    const allSubjects = Array.from(new Set([...Object.keys(curated), ...Object.keys(groupedUser)]));

    // Search filtering
    const searchInput = document.getElementById('lib-search');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const filteredSubjects = query
      ? allSubjects.filter(sub => {
          if (sub.toLowerCase().includes(query)) return true;
          const books = [...(curated[sub] || []), ...(groupedUser[sub] || [])];
          return books.some(b => b.title.toLowerCase().includes(query));
        })
      : allSubjects;

    if (filteredSubjects.length === 0) {
      container.innerHTML = '<div class="empty-list">No books found. Try a different search or add your own!</div>';
      return;
    }

    container.innerHTML = filteredSubjects.map(sub => `
      <div class="lib-subject-group">
        <h3>${this.escapeHtml(sub)}</h3>
        <div class="bookshelf">
          ${(curated[sub] || []).map(b => `
            <div class="book-card" data-action="openExternal" data-param="${this.escapeHtml(b.url || '')}">
              <div class="book-icon"><i data-lucide="${b.isCloud ? 'cloud' : 'external-link'}"></i></div>
              <span class="book-title">${this.escapeHtml(b.title)}</span>
            </div>
          `).join('')}
          ${(groupedUser[sub] || []).map(b => `
            <div class="book-card" data-action="openLocalBook" data-param="${b.id}">
              <div class="book-icon"><i data-lucide="file-text"></i></div>
              <span class="book-title">${this.escapeHtml(b.title)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    this.updateLucide();
  },

  openExternal(url) {
    if (url) window.open(url, '_blank');
  },

  // --- Library Upload (now uses ArrayBuffer instead of base64) ---
  showLibraryUploadModal() {
    const modal = document.getElementById('library-upload-modal');
    if (modal) modal.classList.remove('hidden');
  },

  hideLibraryUploadModal() {
    const modal = document.getElementById('library-upload-modal');
    if (modal) modal.classList.add('hidden');
  },

  async handleLibraryUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const subjectInput = document.getElementById('lib-upload-subject');
    const subject = subjectInput ? subjectInput.value.trim() : 'General';
    if (!subject) {
      this.showToast('Please enter a subject name.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      // Store as ArrayBuffer (not base64) to save ~33% storage
      await this.dbAdd('library', {
        name: file.name,
        exam: this.state.activeLibExam,
        subject: subject,
        data: e.target.result,  // ArrayBuffer
        type: file.type
      });
      this.hideLibraryUploadModal();
      this.renderLibraryContent();
      this.showToast('Book added to your shelf!', 'success');
    };
    reader.readAsArrayBuffer(file);
  },

  async openLocalBook(id) {
    const book = await this.dbGet('library', parseInt(id));
    if (!book) return;

    try {
      let blob;
      if (book.data instanceof ArrayBuffer || book.data instanceof Uint8Array) {
        blob = new Blob([book.data], { type: book.type || 'application/pdf' });
      } else {
        // Legacy: handle old base64/dataURL entries
        const fetchRes = await fetch(book.data);
        blob = await fetchRes.blob();
      }
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) {
      console.error('Failed to open book', e);
      this.showToast('Could not open this book.', 'error');
    }
  },

  // --- Admin Cloud Upload ---
  async adminUploadBook() {
    const title = document.getElementById('admin-book-title')?.value.trim();
    const subject = document.getElementById('admin-book-subject')?.value.trim();
    const exam = document.getElementById('admin-book-exam')?.value;
    const fileInput = document.getElementById('admin-book-file');
    const file = fileInput?.files[0];

    if (!title || !subject || !file) {
      this.showToast('Please fill all fields and select a PDF.', 'error');
      return;
    }
    if (!this.state.user) {
      this.showToast('You must be signed in to upload cloud books.', 'error');
      return;
    }

    const btn = document.getElementById('admin-upload-btn');
    const originalText = btn?.textContent;
    if (btn) { btn.textContent = 'Uploading...'; btn.disabled = true; }

    try {
      const storageRef = this.storage.ref(`library_books/${exam}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`);
      const snapshot = await storageRef.put(file);
      const downloadURL = await snapshot.ref.getDownloadURL();

      await this.db.collection('library_books').add({
        title, subject, exam, url: downloadURL,
        addedBy: this.state.user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      this.showToast('Book uploaded successfully to cloud!', 'success');
      if (document.getElementById('admin-book-title')) document.getElementById('admin-book-title').value = '';
      if (document.getElementById('admin-book-subject')) document.getElementById('admin-book-subject').value = '';
      if (fileInput) fileInput.value = '';
      if (this.state.currentView === 'library') this.renderLibraryContent();
    } catch (e) {
      console.error(e);
      this.showToast('Upload failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.textContent = originalText; btn.disabled = false; }
    }
  },

  // ====================================================================
  //  Study Assistant — Subject-Scoped AI Tutor
  // ====================================================================

  /** Toggle the Study Assistant chat panel open/closed */
  toggleStudyAssistant() {
    const card = document.getElementById('study-assistant-card');
    const panel = document.getElementById('sa-chat-panel');
    if (!card || !panel) return;

    const isExpanded = card.classList.contains('sa-expanded');
    if (isExpanded) {
      card.classList.remove('sa-expanded');
      panel.classList.add('hidden');
    } else {
      card.classList.add('sa-expanded');
      panel.classList.remove('hidden');
      this.initStudyChat();
    }
    this.updateLucide();
  },

  /** Initialize chat: load history or show welcome message */
  async initStudyChat() {
    const examId = this.state.activeLibExam;
    if (!examId) return;

    // Load chat history from IndexedDB
    if (!this.state._studyChatCache || this.state._studyChatCache.exam !== examId) {
      let stored = null;
      try { stored = await this.dbGet('chat_history', examId); } catch {}
      this.state._studyChatCache = {
        exam: examId,
        messages: stored?.messages || [],
      };
    }

    // Show welcome if empty
    if (this.state._studyChatCache.messages.length === 0) {
      const examName = this.state.userExams.find(e => e.id === examId)?.name || examId;
      this.state._studyChatCache.messages.push({
        role: 'system',
        content: `Hi! I'm your ${examName} study assistant. Ask me about any topic in your syllabus — I'll explain concepts, quiz you, and help you revise.`
      });
    }

    this.renderStudyChatMessages();
    this._bindStudyChatInput();

    // Update subtitle with exam name
    const subtitle = document.getElementById('sa-subtitle');
    const examName = this.state.userExams.find(e => e.id === this.state.activeLibExam)?.name || '';
    if (subtitle && examName) subtitle.textContent = `Tutor for ${examName}`;
  },

  /** Bind Enter key on the chat input */
  _bindStudyChatInput() {
    const input = document.getElementById('sa-chat-input');
    if (!input || input._saBound) return;
    input._saBound = true;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendStudyChat();
      }
    });
  },

  /** Build the subject-guarded system prompt with user context */
  async _buildTutorSystemPrompt(examId) {
    const syllabusHint = this.SYLLABUS_HINTS?.[examId] || '';
    const examName = this.state.userExams.find(e => e.id === examId)?.name || examId;

    // Pull mastery data for context
    let masteryContext = '';
    try {
      const topics = await this.dbGetFromIndex('topics', 'exam', examId);
      if (topics.length > 0) {
        const sorted = topics.sort((a, b) => (a.mastery || 0) - (b.mastery || 0));
        const weak = sorted.slice(0, 3).map(t => `${t.name} (${t.mastery || 0}%)`).join(', ');
        const strong = sorted.slice(-3).map(t => `${t.name} (${t.mastery || 0}%)`).join(', ');
        masteryContext = `\nStudent's weakest topics: ${weak}\nStudent's strongest topics: ${strong}`;
      }
    } catch {}

    // Pull a few sample questions for context
    let sampleQuestions = '';
    try {
      const questions = await this.dbGetFromIndex('questions', 'exam', examId);
      if (questions.length > 0) {
        const samples = questions.slice(0, 3).map(q => `- ${q.text}`).join('\n');
        sampleQuestions = `\nSample questions from student's bank:\n${samples}`;
      }
    } catch {}

    return `You are Woni Study Assistant, an expert tutor exclusively for ${examName}.
${syllabusHint ? `\nOfficial syllabus: ${syllabusHint}` : ''}
${masteryContext}
${sampleQuestions}

RULES:
1. ONLY discuss topics within the ${examName} syllabus listed above.
2. If the student asks about anything outside these subjects (politics, entertainment, coding, etc.), politely decline: "I'm specialized in ${examName} topics. Let me help you with your syllabus subjects instead!"
3. Adjust explanation depth based on the student's mastery level — simpler for weak topics, more advanced for strong ones.
4. Use bullet points and clear structure. Keep answers concise (3-8 bullets).
5. When explaining a concept, end with a quick self-check question when appropriate.
6. If the student asks you to quiz them, create a mini MCQ from their syllabus.`;
  },

  /** Send a message to the Study Assistant */
  async sendStudyChat() {
    const input = document.getElementById('sa-chat-input');
    const sendBtn = document.getElementById('sa-chat-send');
    if (!input) return;
    const question = input.value.trim();
    if (!question) return;

    // Check freemium limits
    if (!this.state.apiKey) {
      const count = this.getFreemiumCount ? this.getFreemiumCount() : 0;
      if (count >= 5) {
        this.showToast('Freemium limit reached. Please add your API Key in Settings.', 'error');
        return;
      }
    }

    const examId = this.state.activeLibExam;
    if (!examId) return;

    // Add user message
    input.value = '';
    if (sendBtn) sendBtn.disabled = true;
    this.state._studyChatCache.messages.push({ role: 'user', content: question });
    this.renderStudyChatMessages();

    // Show typing indicator
    this._showTypingIndicator(true);

    try {
      const systemPrompt = await this._buildTutorSystemPrompt(examId);

      // Convert our message format to API format (skip system/display messages)
      const apiMessages = this.state._studyChatCache.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));

      const response = await this.groqTutorCall(systemPrompt, apiMessages);

      this.state._studyChatCache.messages.push({ role: 'assistant', content: response });
    } catch (e) {
      this.state._studyChatCache.messages.push({
        role: 'assistant',
        content: `I hit an error: ${e.message}\n\nTip: If this persists, check your API Key in Settings.`
      });
    } finally {
      this._showTypingIndicator(false);
      if (sendBtn) sendBtn.disabled = false;
      this.renderStudyChatMessages();
      this._saveStudyChatHistory();
    }
  },

  /** Render all chat messages */
  renderStudyChatMessages() {
    const log = document.getElementById('sa-chat-log');
    if (!log || !this.state._studyChatCache) return;

    log.innerHTML = this.state._studyChatCache.messages.map(m => {
      if (m.role === 'system') {
        return `<div class="sa-msg system">${this.escapeHtml(m.content)}</div>`;
      }
      if (m.role === 'user') {
        return `<div class="sa-msg user">${this.escapeHtml(m.content)}</div>`;
      }
      // assistant
      return `<div class="sa-msg ai"><span class="sa-msg-label">Woni Tutor</span>${this.escapeHtml(m.content)}</div>`;
    }).join('');

    // Scroll to bottom
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  },

  /** Show/hide typing dots */
  _showTypingIndicator(show) {
    const log = document.getElementById('sa-chat-log');
    if (!log) return;
    const existing = log.querySelector('.sa-typing');
    if (existing) existing.remove();
    if (show) {
      const dots = document.createElement('div');
      dots.className = 'sa-typing';
      dots.innerHTML = '<div class="sa-typing-dot"></div><div class="sa-typing-dot"></div><div class="sa-typing-dot"></div>';
      log.appendChild(dots);
      log.scrollTop = log.scrollHeight;
    }
  },

  /** Persist chat history to IndexedDB */
  async _saveStudyChatHistory() {
    if (!this.state._studyChatCache || !this.state.db) return;
    try {
      await this.dbPut('chat_history', {
        exam: this.state._studyChatCache.exam,
        messages: this.state._studyChatCache.messages.slice(-50), // Keep last 50 messages
        updatedAt: Date.now(),
      });
    } catch (e) {
      console.warn('Failed to save chat history', e);
    }
  },

  /** Reset chat when switching exam tabs */
  _resetStudyChat() {
    this.state._studyChatCache = null;
    const panel = document.getElementById('sa-chat-panel');
    const card = document.getElementById('study-assistant-card');
    if (panel) panel.classList.add('hidden');
    if (card) card.classList.remove('sa-expanded');
  },
};
