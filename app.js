/**
 * Woni — Core Application Logic (SPA)
 */

const app = {
  // --- State ---
  state: {
    userExams: [],
    activeExam: null,
    apiKey: localStorage.getItem('woni_groq_key') || '',
    theme: localStorage.getItem('woni_theme') || 'dark',
    isFirstRun: !localStorage.getItem('woni_setup_done'),
    db: null,
    currentView: 'dashboard',
    uploadFiles: [],
    analysisStatus: '',
    analysisProgress: 0,
  },

  // --- Initialization ---
  async init() {
    console.log('Woni initializing...');
    this.applyTheme();
    this.initEventListeners();
    this.initNavigation();

    // Initialize IndexedDB
    await this.initDB();

    // Load state from DB/LocalStorage
    this.loadState();

    if (this.state.isFirstRun) {
      this.showOnboarding();
    } else {
      this.updateDashboard();
    }

    // Initial view
    this.showView(this.state.currentView);
  },

  async initDB() {
    try {
      this.state.db = await idb.openDB('woni_db', 2, {
        upgrade(db, oldVersion, newVersion) {
          // Papers store
          if (!db.objectStoreNames.contains('papers')) {
            const pStore = db.createObjectStore('papers', { keyPath: 'id', autoIncrement: true });
            pStore.createIndex('exam', 'exam');
          }
          // Questions store
          if (!db.objectStoreNames.contains('questions')) {
            const qStore = db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
            qStore.createIndex('exam', 'exam');
            qStore.createIndex('topic', 'topic');
            qStore.createIndex('paperId', 'paperId');
          }
          // Flashcards store
          if (!db.objectStoreNames.contains('flashcards')) {
            const fStore = db.createObjectStore('flashcards', { keyPath: 'id', autoIncrement: true });
            fStore.createIndex('nextReview', 'nextReview');
            fStore.createIndex('topic', 'topic');
          }
          // Progress store
          if (!db.objectStoreNames.contains('progress')) {
            db.createObjectStore('progress', { keyPath: 'id' });
          }
          // Topics store (to store topic analysis)
          if (!db.objectStoreNames.contains('topics')) {
            const tStore = db.createObjectStore('topics', { keyPath: 'id' }); // id: exam_topicName
            tStore.createIndex('exam', 'exam');
          }
          // Mock tests store
          if (!db.objectStoreNames.contains('mock_tests')) {
            const mStore = db.createObjectStore('mock_tests', { keyPath: 'id', autoIncrement: true });
            mStore.createIndex('exam', 'exam');
          }
        },
      });
      console.log('IndexedDB initialized');
    } catch (e) {
      console.error('DB init failed', e);
    }
  },

  async dbAdd(storeName, data) {
    return this.state.db.add(storeName, data);
  },
  async dbPut(storeName, data) {
    return this.state.db.put(storeName, data);
  },
  async dbGet(storeName, key) {
    return this.state.db.get(storeName, key);
  },
  async dbGetAll(storeName) {
    return this.state.db.getAll(storeName);
  },
  async dbDelete(storeName, key) {
    return this.state.db.delete(storeName, key);
  },
  async dbGetFromIndex(storeName, indexName, value) {
    return this.state.db.getAllFromIndex(storeName, indexName, value);
  },

  loadState() {
    const savedExams = localStorage.getItem('woni_user_exams');
    if (savedExams) {
      this.state.userExams = JSON.parse(savedExams);
      this.state.activeExam = this.state.userExams[0] || null;
      this.updateActiveExamBadge();
    }

    const savedApiKey = localStorage.getItem('woni_groq_key');
    if (savedApiKey) {
      this.state.apiKey = savedApiKey;
      document.getElementById('api-key-input').value = savedApiKey;
    }

    const savedTheme = localStorage.getItem('woni_theme');
    if (savedTheme) {
      this.state.theme = savedTheme;
      document.getElementById('theme-select').value = savedTheme;
      this.applyTheme();
    }
  },

  initEventListeners() {
    // Onboarding
    document.getElementById('save-exams-btn').addEventListener('click', () => this.saveExams());

    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const viewId = e.currentTarget.dataset.view;
        this.showView(viewId);
      });
    });

    // Upload
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

    document.getElementById('start-analysis-btn').addEventListener('click', () => this.startAnalysis());
  },

  initNavigation() {
    // Handle back button / hash changes if needed
  },

  // --- View Management ---
  showView(viewId) {
    this.state.currentView = viewId;

    // Update UI
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewId);
    });

    if (viewId === 'dashboard') this.updateDashboard();
    if (viewId === 'upload') this.updateUploadView();
    if (viewId === 'practice') this.updatePracticeView();
    if (viewId === 'progress') this.updateProgressView();
  },

  showSubView(id) {
    document.getElementById(id).classList.remove('hidden');
  },

  hideSubView(id) {
    document.getElementById(id).classList.add('hidden');
  },

  showOnboarding() {
    document.getElementById('onboarding-overlay').classList.remove('hidden');
  },

  // --- Actions ---
  saveExams() {
    const selected = [];
    document.querySelectorAll('.exam-checkbox input:checked').forEach(input => {
      selected.push({ id: input.value, name: input.dataset.name });
    });

    if (selected.length === 0) {
      alert('Please select at least one exam.');
      return;
    }

    this.state.userExams = selected;
    this.state.activeExam = selected[0];
    this.state.isFirstRun = false;

    localStorage.setItem('woni_user_exams', JSON.stringify(selected));
    localStorage.setItem('woni_setup_done', 'true');

    document.getElementById('onboarding-overlay').classList.add('hidden');
    this.updateActiveExamBadge();
    this.updateDashboard();
    this.showView('dashboard');
  },

  updateActiveExamBadge() {
    const badge = document.getElementById('active-exam-badge');
    if (this.state.activeExam) {
      badge.textContent = this.state.activeExam.name;
    }
  },

  saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (key && !key.startsWith('gsk_')) {
      alert('Key should start with gsk_');
      return;
    }
    this.state.apiKey = key;
    localStorage.setItem('woni_groq_key', key);
    alert('API Key saved!');
  },

  setTheme(theme) {
    this.state.theme = theme;
    localStorage.setItem('woni_theme', theme);
    this.applyTheme();
    // Update select if not changed from UI
    const sel = document.getElementById('theme-select');
    if (sel.value !== theme) sel.value = theme;
  },

  applyTheme() {
    const isDark = this.state.theme === 'dark' ||
      (this.state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('light-theme', !isDark);
  },

  // --- Dashboard Logic ---
  async updateDashboard() {
    const tests = await this.dbGetAll('mock_tests');
    const questions = await this.dbGetAll('questions');
    const cards = await this.dbGetAll('flashcards');

    // Stats calculation
    const avgScore = tests.length > 0
      ? Math.round(tests.reduce((acc, t) => acc + t.score, 0) / tests.length)
      : 0;

    document.getElementById('dash-mastery').textContent = `${avgScore}%`;
    document.getElementById('dash-study-time').textContent = `${tests.length * 20}m`; // Simplified
    document.getElementById('dash-streak').textContent = `${new Set(tests.map(t => new Date(t.date).toDateString())).size}d`;

    // Recommendations
    const topics = await this.dbGetFromIndex('topics', 'exam', this.state.activeExam?.id);
    const recList = document.getElementById('recommendations-list');
    if (topics.length > 0) {
      const weakTopics = topics.sort((a,b) => a.frequency - b.frequency).slice(0, 3);
      recList.className = 'rec-list';
      recList.innerHTML = weakTopics.map(t => `
        <div class="rec-item" onclick="app.showTopicStudy('${t.name}')">
          <span class="rec-topic">${t.name}</span>
          <span class="rec-reason">High importance, low mastery</span>
        </div>
      `).join('');
    }

    // Upcoming Reviews
    const dueCount = cards.filter(c => c.nextReview <= Date.now()).length;
    const reviewEl = document.getElementById('upcoming-reviews');
    if (dueCount > 0) {
      reviewEl.innerHTML = `
        <div class="review-alert" onclick="app.showView('practice')">
          <span>${dueCount} cards due for review</span>
          <button class="btn accent small">Review Now</button>
        </div>
      `;
    } else {
      reviewEl.innerHTML = `<p class="muted">All cards reviewed! Check back tomorrow.</p>`;
    }
  },

  showTopicStudy(topicName) {
     // Navigate to a filtered practice or notes view
     alert('Topic focus: ' + topicName);
  },

  // --- Upload & Analysis Logic ---
  updateUploadView() {
    const select = document.getElementById('upload-exam-select');
    select.innerHTML = this.state.userExams.map(ex => `<option value="${ex.id}">${ex.name}</option>`).join('');
    this.renderFileList();
  },

  handleFiles(files) {
    const validFiles = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf', 'txt', 'jpg', 'jpeg', 'png'].includes(ext);
    });

    this.state.uploadFiles.push(...validFiles);
    this.renderFileList();
    document.getElementById('start-analysis-btn').disabled = this.state.uploadFiles.length === 0;
  },

  removeFile(index) {
    this.state.uploadFiles.splice(index, 1);
    this.renderFileList();
    document.getElementById('start-analysis-btn').disabled = this.state.uploadFiles.length === 0;
  },

  renderFileList() {
    const list = document.getElementById('file-list');
    list.innerHTML = this.state.uploadFiles.map((f, i) => `
      <div class="uz-file">
        <span>${f.name}</span>
        <button onclick="app.removeFile(${i})">✕</button>
      </div>
    `).join('');
  },

  async startAnalysis() {
    if (!this.state.apiKey) {
      alert('Please save your Groq API Key in Settings first.');
      this.showView('settings');
      return;
    }

    const btn = document.getElementById('start-analysis-btn');
    const progress = document.getElementById('analysis-progress');
    const fill = document.getElementById('progress-fill');
    const status = document.getElementById('progress-status');
    const examId = document.getElementById('upload-exam-select').value;

    btn.disabled = true;
    progress.classList.remove('hidden');

    try {
      const extractedTexts = [];

      for (let i = 0; i < this.state.uploadFiles.length; i++) {
        const file = this.state.uploadFiles[i];
        const step = 100 / this.state.uploadFiles.length;

        status.textContent = `Extracting text from ${file.name}...`;
        fill.style.width = `${i * step}%`;

        let text = '';
        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'pdf') {
          text = await this.extractPDFText(file);
        } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
          text = await this.extractImageText(file);
        } else {
          text = await file.text();
        }

        extractedTexts.push({ name: file.name, text });

        // Save paper metadata to DB
        await this.dbAdd('papers', {
          name: file.name,
          exam: examId,
          timestamp: Date.now(),
          text: text.slice(0, 10000) // Store partial text to avoid hitting storage limits if huge, though IndexedDB is generous
        });
      }

      fill.style.width = '90%';
      status.textContent = 'AI is analyzing questions...';

      // Perform AI Analysis
      await this.performAIAnalysis(examId, extractedTexts);

      fill.style.width = '100%';
      status.textContent = 'Analysis complete!';

      setTimeout(() => {
        progress.classList.add('hidden');
        btn.disabled = false;
        this.state.uploadFiles = [];
        this.renderFileList();
        this.showView('practice');
        alert('All papers analyzed and added to your bank!');
      }, 1000);

    } catch (e) {
      console.error(e);
      status.textContent = 'Error: ' + e.message;
      btn.disabled = false;
      alert('Analysis failed: ' + e.message);
    }
  },

  async extractPDFText(file) {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 20); // Limit for performance
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map(i => i.str).join(' ') + '\n';
    }
    return text.trim();
  },

  async extractImageText(file) {
    const worker = await Tesseract.createWorker('eng');
    const result = await worker.recognize(file);
    await worker.terminate();
    return result.data.text;
  },

  async performAIAnalysis(examId, extractedTexts) {
    const combinedText = extractedTexts.map(t => `SOURCE: ${t.name}\n${t.text.slice(0, 4000)}`).join('\n---\n');

    const prompt = `You are an AI specialized in exam preparation for ${examId}.
Extract structured questions from the provided text.
Include: Multiple Choice Questions, answers, and explanations.
Also identify the key topic for each question and its frequency of occurrence in the source.

TEXT:
${combinedText}

Return ONLY valid JSON with two keys: "questions" (array) and "topics" (array of {name, frequency, priority}).
Frequency should be 0-100. Priority should be "high", "med", or "low".

Format:
{
  "questions": [
    {
      "text": "Question text?",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "topic": "Topic Name",
      "difficulty": "medium",
      "explanation": "Why A is correct..."
    }
  ],
  "topics": [
     { "name": "Topic Name", "frequency": 85, "priority": "high" }
  ]
}`;

    const response = await this.groqCall(prompt);
    const result = this.parseJSON(response);

    if (result.questions && Array.isArray(result.questions)) {
      for (const q of result.questions) {
        q.exam = examId;
        await this.dbAdd('questions', q);

        // Auto-generate flashcard
        await this.dbAdd('flashcards', {
          questionId: null,
          front: q.text,
          back: `Answer: ${q.answer}\n\nExplanation: ${q.explanation}`,
          topic: q.topic,
          nextReview: Date.now(),
          interval: 0,
          repetition: 0,
          ease: 2.5
        });
      }
    }

    if (result.topics && Array.isArray(result.topics)) {
      for (const t of result.topics) {
        t.id = `${examId}_${t.name}`;
        t.exam = examId;
        await this.dbPut('topics', t);
      }
    }
  },

  async groqCall(prompt) {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" }
      }),
    });

    if (!resp.ok) throw new Error(`Groq API Error: ${resp.status}`);
    const data = await resp.json();
    return data.choices[0].message.content;
  },

  parseJSON(raw) {
    try {
      // In case AI returns wrapped in markdown
      let text = raw.replace(/```json|```/g, '').trim();
      const s = text.indexOf('[');
      const e = text.lastIndexOf(']');
      if (s >= 0 && e >= 0) {
        return JSON.parse(text.slice(s, e + 1));
      }
      // If it returned a single object with "questions" key
      const obj = JSON.parse(text);
      return obj.questions || obj;
    } catch (e) {
      console.error('Failed to parse JSON from AI', e, raw);
      return [];
    }
  },

  // --- Practice Logic ---
  async updatePracticeView() {
    const select = document.getElementById('mock-exam-select');
    select.innerHTML = this.state.userExams.map(ex => `<option value="${ex.id}">${ex.name}</option>`).join('');

    // Auto-update topics when exam changes
    select.onchange = (e) => this.updateMockTopics(e.target.value);
    this.updateMockTopics(select.value);
  },

  async updateMockTopics(examId) {
    const topics = await this.dbGetFromIndex('topics', 'exam', examId);
    const container = document.getElementById('mock-topic-checks');
    if (topics.length === 0) {
      container.innerHTML = '<p class="muted">No topics analyzed yet for this exam.</p>';
      return;
    }
    container.innerHTML = topics.map(t => `
      <label class="topic-check">
        <input type="checkbox" value="${t.name}" checked>
        <span>${t.name}</span>
      </label>
    `).join('');
  },

  showMockTestSetup() {
    this.showSubView('mock-test-setup');
  },

  async startMockTest() {
    const examId = document.getElementById('mock-exam-select').value;
    const qCount = parseInt(document.getElementById('mock-q-count').value);
    const selectedTopics = Array.from(document.querySelectorAll('#mock-topic-checks input:checked')).map(i => i.value);

    let allQuestions = await this.dbGetFromIndex('questions', 'exam', examId);
    if (selectedTopics.length > 0) {
      allQuestions = allQuestions.filter(q => selectedTopics.includes(q.topic));
    }

    if (allQuestions.length === 0) {
      alert('No questions found for the selected criteria. Try uploading more papers.');
      return;
    }

    // Shuffle and pick
    const selected = allQuestions.sort(() => 0.5 - Math.random()).slice(0, qCount);

    this.hideSubView('mock-test-setup');
    this.openSession('Mock Test', 'test', selected);
  },

  async startFlashcards() {
    const cards = await this.dbGetAll('flashcards');
    const due = cards.filter(c => c.nextReview <= Date.now()).sort((a,b) => a.nextReview - b.nextReview);

    if (due.length === 0) {
       if (cards.length === 0) {
         alert('No flashcards available. Upload papers to auto-generate them.');
       } else {
         alert('All caught up! No flashcards due for review.');
       }
       return;
    }

    this.openSession('Flashcards', 'flashcard', due);
  },

  openSession(title, type, data) {
    this.state.session = {
      title,
      type,
      data,
      index: 0,
      startTime: Date.now(),
      answers: [],
      score: 0
    };

    document.getElementById('session-title').textContent = title;
    document.getElementById('active-session-overlay').classList.remove('hidden');
    this.renderSessionContent();
    this.startSessionTimer();
  },

  renderSessionContent() {
    const s = this.state.session;
    const content = document.getElementById('session-content');
    const footer = document.getElementById('session-footer');
    const item = s.data[s.index];

    if (!item) {
      this.renderSessionResults();
      return;
    }

    if (s.type === 'test') {
      content.innerHTML = `
        <div class="q-header">Question ${s.index + 1} of ${s.data.length}</div>
        <div class="q-text">${item.text}</div>
        <div class="options-grid">
          ${item.options.map((opt, i) => `
            <button class="option-btn" onclick="app.selectOption(${i})">
              <span class="opt-letter">${String.fromCharCode(65 + i)}</span>
              <span class="opt-text">${opt}</span>
            </button>
          `).join('')}
        </div>
      `;
      footer.innerHTML = `
        <button class="btn" onclick="app.exitSession()">Exit</button>
        <div style="flex:1"></div>
        <button class="btn accent" onclick="app.nextQuestion()" id="next-q-btn" disabled>Next →</button>
      `;
    } else {
      // Flashcard
      content.innerHTML = `
        <div class="card-count">Card ${s.index + 1} of ${s.data.length}</div>
        <div class="flashcard-box" id="flashcard-box" onclick="this.classList.toggle('flipped')">
          <div class="card-front">${item.front}</div>
          <div class="card-back">${item.back.replace(/\n/g, '<br>')}</div>
        </div>
        <p class="muted" style="text-align:center;margin-top:16px">Tap card to flip</p>
      `;
      footer.innerHTML = `
        <div class="sm2-btns hidden" id="sm2-btns">
          <button class="btn danger" onclick="app.rateCard(1)">Again</button>
          <button class="btn" style="color:var(--gold)" onclick="app.rateCard(3)">Hard</button>
          <button class="btn" style="color:var(--green)" onclick="app.rateCard(4)">Good</button>
          <button class="btn accent" onclick="app.rateCard(5)">Easy</button>
        </div>
        <button class="btn accent large" id="show-answer-btn" onclick="document.getElementById('flashcard-box').classList.add('flipped'); document.getElementById('sm2-btns').classList.remove('hidden'); this.classList.add('hidden')">Show Answer</button>
      `;
    }
  },

  selectOption(i) {
    const s = this.state.session;
    const item = s.data[s.index];
    const btns = document.querySelectorAll('.option-btn');

    btns.forEach(b => b.classList.remove('selected'));
    btns[i].classList.add('selected');

    s.answers[s.index] = String.fromCharCode(65 + i);
    document.getElementById('next-q-btn').disabled = false;
  },

  nextQuestion() {
    this.state.session.index++;
    this.renderSessionContent();
  },

  async rateCard(quality) {
    const s = this.state.session;
    const card = s.data[s.index];

    // SM-2 Spaced Repetition Algorithm
    let { interval, repetition, ease } = card;

    if (quality >= 3) {
      if (repetition === 0) interval = 1;
      else if (repetition === 1) interval = 6;
      else interval = Math.round(interval * ease);
      repetition++;
    } else {
      repetition = 0;
      interval = 1;
    }

    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ease < 1.3) ease = 1.3;

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

    if (s.type === 'test') {
      let correctCount = 0;
      const topicStats = {}; // To update topic mastery

      s.data.forEach((q, i) => {
        if (!topicStats[q.topic]) topicStats[q.topic] = { correct: 0, total: 0 };
        topicStats[q.topic].total++;
        if (s.answers[i] === q.answer) {
          correctCount++;
          topicStats[q.topic].correct++;
        }
      });
      const score = Math.round((correctCount / s.data.length) * 100);

      content.innerHTML = `
        <div class="results-box">
          <div class="res-score">${score}%</div>
          <p>${correctCount} correct out of ${s.data.length} questions</p>
          <p class="muted">Time: ${timerEl.textContent}</p>
          <button class="btn small accent" onclick="app.exportSessionPDF()" style="margin-top:20px">Export Results PDF</button>
        </div>
      `;

      // Update topic mastery in DB
      for (const topicName in topicStats) {
        const stats = topicStats[topicName];
        const topicId = `${s.data[0].exam}_${topicName}`;
        const topic = await this.dbGet('topics', topicId);
        if (topic) {
          const currentMastery = topic.mastery || 0;
          const sessionMastery = (stats.correct / stats.total) * 100;
          // Simple moving average for mastery
          topic.mastery = Math.round((currentMastery + sessionMastery) / 2);
          await this.dbPut('topics', topic);
        }
      }

      // Save to mock_tests store
      await this.dbAdd('mock_tests', {
        exam: s.data[0].exam,
        date: Date.now(),
        score,
        qCount: s.data.length,
        duration: timerEl.textContent,
        answers: s.answers,
        questions: s.data
      });

    } else {
      content.innerHTML = `
        <div class="results-box">
          <h3>Review Complete!</h3>
          <p>You've reviewed ${s.data.length} cards today.</p>
        </div>
      `;
    }

    footer.innerHTML = `<button class="btn accent large" onclick="app.exitSession(true)">Finish</button>`;
  },

  startSessionTimer() {
    const el = document.getElementById('session-timer');
    const start = this.state.session.startTime;
    this.state.sessionTimer = setInterval(() => {
      const diff = Date.now() - start;
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    }, 1000);
  },

  exitSession(force = false) {
    if (force || confirm('Are you sure you want to exit? Progress may not be saved.')) {
      clearInterval(this.state.sessionTimer);
      document.getElementById('active-session-overlay').classList.add('hidden');
      this.updateDashboard();
    }
  },

  exportSessionPDF() {
    const s = this.state.session;
    if (!s || !s.data) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.text(`Woni ${s.title} Results`, 20, 20);

    doc.setFontSize(12);
    doc.text(`Date: ${new Date().toLocaleString()}`, 20, 30);
    doc.text(`Exam: ${this.state.activeExam?.name || 'N/A'}`, 20, 40);

    let correctCount = 0;
    s.data.forEach((q, i) => {
      if (s.answers[i] === q.answer) correctCount++;
    });
    const score = Math.round((correctCount / s.data.length) * 100);

    doc.setFontSize(16);
    doc.text(`Score: ${score}% (${correctCount}/${s.data.length})`, 20, 55);

    doc.setFontSize(12);
    let y = 70;
    s.data.forEach((q, i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold');
      doc.text(`${i+1}. ${q.text.slice(0, 80)}${q.text.length > 80 ? '...' : ''}`, 20, y);
      y += 7;
      doc.setFont('helvetica', 'normal');
      doc.text(`Your Answer: ${s.answers[i] || 'None'} | Correct: ${q.answer}`, 25, y);
      y += 10;
    });

    doc.save(`Woni_Result_${Date.now()}.pdf`);
  },

  // --- Progress Logic ---
  async updateProgressView() {
    const tests = await this.dbGetAll('mock_tests');
    const topics = await this.dbGetAll('topics');

    // Chart logic
    const ctx = document.getElementById('performance-chart').getContext('2d');
    if (this.chart) this.chart.destroy();

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: tests.map(t => new Date(t.date).toLocaleDateString()).slice(-10),
        datasets: [{
          label: 'Mock Test Score',
          data: tests.map(t => t.score).slice(-10),
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });

    // Heatmap / Topics
    const heatmap = document.getElementById('mastery-heatmap');
    if (topics.length > 0) {
      heatmap.innerHTML = topics.map(t => {
        const mastery = t.mastery || 0;
        return `
          <div class="heatmap-topic" style="background: rgba(16, 185, 129, ${mastery/100})">
            <span class="ht-name">${t.name}</span>
            <span class="ht-freq">${mastery}% Mastery</span>
            <span class="ht-subtext">${t.frequency}% Importance</span>
          </div>
        `;
      }).join('');
    } else {
      heatmap.innerHTML = `<p class="muted">No topics analyzed yet.</p>`;
    }
  },

  // --- Data Management ---
  async exportData() {
    const data = {
      userExams: this.state.userExams,
      papers: await this.dbGetAll('papers'),
      questions: await this.dbGetAll('questions'),
      flashcards: await this.dbGetAll('flashcards'),
      progress: await this.dbGetAll('progress'),
      topics: await this.dbGetAll('topics'),
      mock_tests: await this.dbGetAll('mock_tests'),
      version: 1,
      exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `woni_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (confirm('Importing data will overwrite existing records. Continue?')) {
        // Clear stores
        const stores = ['papers', 'questions', 'flashcards', 'progress', 'topics', 'mock_tests'];
        for (const store of stores) {
          await this.state.db.clear(store);
          if (data[store]) {
            for (const item of data[store]) {
              await this.dbAdd(store, item);
            }
          }
        }

        if (data.userExams) {
          this.state.userExams = data.userExams;
          localStorage.setItem('woni_user_exams', JSON.stringify(data.userExams));
        }

        alert('Data imported successfully!');
        location.reload();
      }
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  },

  clearAllData() {
    if (confirm('DANGER: This will delete ALL your study data, papers, and progress. Continue?')) {
      localStorage.clear();
      location.reload();
    }
  }
};

// Configure PDF.js Worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Start the app
window.addEventListener('DOMContentLoaded', () => app.init());
