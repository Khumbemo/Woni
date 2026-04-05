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
    session: null,
    activeLibExam: 'csir_net',
  },

  // --- Initialization ---
  async init() {
    console.log('Woni initializing...');
    this.applyTheme();
    this.initEventListeners();
    this.initNavigation();
    this.initParticles();
    this.updateLucide();

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
      this.state.db = await idb.openDB('woni_db', 3, {
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
          // Library store
          if (!db.objectStoreNames.contains('library')) {
            const lStore = db.createObjectStore('library', { keyPath: 'id', autoIncrement: true });
            lStore.createIndex('exam', 'exam');
            lStore.createIndex('subject', 'subject');
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
    // Swipe Navigation
    let touchStartX = 0;
    const content = document.getElementById('main-content');
    content.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    content.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe(touchStartX, touchEndX);
    }, { passive: true });

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

    if (dropZone) {
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
    }
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
    }

    document.getElementById('start-analysis-btn').addEventListener('click', () => this.startAnalysis());
  },

  initNavigation() {
    this.VIEWS = ['dashboard', 'library', 'upload', 'practice', 'progress', 'settings'];
  },

  handleSwipe(start, end) {
    const threshold = 100;
    const diff = end - start;
    if (Math.abs(diff) < threshold) return;

    // Check if we are in a subview or session (swipe disabled)
    if (!document.getElementById('active-session-overlay').classList.contains('hidden')) return;

    const currentIndex = this.VIEWS.indexOf(this.state.currentView);
    if (diff > 0 && currentIndex > 0) {
      // Swipe Right -> Previous View
      this.showView(this.VIEWS[currentIndex - 1]);
    } else if (diff < 0 && currentIndex < this.VIEWS.length - 1) {
      // Swipe Left -> Next View
      this.showView(this.VIEWS[currentIndex + 1]);
    }
  },

  // --- View Management ---
  showView(viewId) {
    this.state.currentView = viewId;

    // Update UI
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewId);
    });

    if (viewId === 'dashboard') this.updateDashboard();
    if (viewId === 'library') this.updateLibraryView();
    if (viewId === 'upload') this.updateUploadView();
    if (viewId === 'practice') this.updatePracticeView();
    if (viewId === 'progress') this.updateProgressView();

    this.updateLucide();
  },

  updateLucide() {
    if (window.lucide) {
      lucide.createIcons();
    }
  },

  initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    const mouse = { x: null, y: null, radius: 150 };

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.x;
      mouse.y = e.y;
    });

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resize);
    resize();

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.baseX = this.x;
        this.baseY = this.y;
        this.size = Math.random() * 2 + 1;
        this.density = (Math.random() * 30) + 1;
        this.speedX = Math.random() * 0.5 - 0.25;
        this.speedY = Math.random() * 0.5 - 0.25;
        this.color = document.body.classList.contains('dark-theme') ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)';
      }
      update() {
        // Natural movement
        this.x += this.speedX;
        this.y += this.speedY;

        // Interaction
        let dx = mouse.x - this.x;
        let dy = mouse.y - this.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        let forceDirectionX = dx / distance;
        let forceDirectionY = dy / distance;
        let maxDistance = mouse.radius;
        let force = (maxDistance - distance) / maxDistance;
        let directionX = forceDirectionX * force * this.density;
        let directionY = forceDirectionY * force * this.density;

        if (distance < mouse.radius) {
          this.x -= directionX;
          this.y -= directionY;
        }

        if (this.x > canvas.width) this.x = 0;
        if (this.x < 0) this.x = canvas.width;
        if (this.y > canvas.height) this.y = 0;
        if (this.y < 0) this.y = canvas.height;
      }
      draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const init = () => {
      particles = [];
      const count = Math.min(Math.floor((canvas.width * canvas.height) / 15000), 100);
      for (let i = 0; i < count; i++) {
        particles.push(new Particle());
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.update();
        p.draw();
      });
      requestAnimationFrame(animate);
    };

    init();
    animate();
  },

  showSubView(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  },

  hideSubView(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  },

  showOnboarding() {
    this.showSubView('onboarding-overlay');
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

    this.hideSubView('onboarding-overlay');
    this.updateDashboard();
    this.showView('dashboard');
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
    const sel = document.getElementById('theme-select');
    if (sel && sel.value !== theme) sel.value = theme;
  },

  applyTheme() {
    const isDark = this.state.theme === 'dark' ||
      (this.state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('light-theme', !isDark);
  },

  // --- Dashboard Logic ---
  async updateDashboard() {
    if (!this.state.db) return;
    const tests = await this.dbGetAll('mock_tests');
    const cards = await this.dbGetAll('flashcards');

    this.updateQuote();
    this.updateBuddy();

    const avgScore = tests.length > 0
      ? Math.round(tests.reduce((acc, t) => acc + t.score, 0) / tests.length)
      : 0;

    const masteryEl = document.getElementById('dash-mastery');
    if (masteryEl) masteryEl.textContent = `${avgScore}%`;
    const studyTimeEl = document.getElementById('dash-study-time');
    if (studyTimeEl) studyTimeEl.textContent = `${tests.length * 20}m`;
    const streakEl = document.getElementById('dash-streak');
    if (streakEl) streakEl.textContent = `${new Set(tests.map(t => new Date(t.date).toDateString())).size}d`;

    const topics = await this.dbGetFromIndex('topics', 'exam', this.state.activeExam?.id);
    const recList = document.getElementById('recommendations-list');
    if (recList && topics.length > 0) {
      const weakTopics = topics.sort((a, b) => (a.mastery || 0) - (b.mastery || 0)).slice(0, 3);
      recList.className = 'rec-list';
      recList.innerHTML = weakTopics.map(t => `
        <div class="rec-item" onclick="app.showTopicStudy('${t.name}')">
          <span class="rec-topic">${t.name}</span>
          <span class="rec-reason">Current Mastery: ${t.mastery || 0}%</span>
        </div>
      `).join('');
    }
    this.updateLucide();
  },

  showTopicStudy(topicName) {
    alert('Topic focus: ' + topicName);
  },

  async updateBuddy() {
    const tests = await this.dbGetAll('mock_tests');
    const streak = parseInt(document.getElementById('dash-streak').textContent) || 0;

    let msg = "Welcome back, scholar! What shall we discover today?";
    let icon = "smile";

    if (streak >= 7) {
      msg = `🔥 ${streak} day streak! You're in the elite zone of focus!`;
      icon = "zap";
    } else if (tests.length > 0) {
      const lastTest = tests[tests.length - 1];
      if (lastTest.score > 80) {
        msg = `Incredible! ${lastTest.score}% on your last test. Your mastery is growing!`;
        icon = "award";
      } else if (lastTest.score < 50) {
        msg = "That last test was tough, but remember: failure is just data for success. Let's review!";
        icon = "frown";
      }
    }

    const msgEl = document.getElementById('buddy-msg');
    const iconEl = document.getElementById('buddy-icon');
    if (msgEl) msgEl.textContent = msg;
    if (iconEl) iconEl.setAttribute('data-lucide', icon);
    this.updateLucide();
  },

  async updateQuote() {
    const quotes = [
      { text: "Science is a way of thinking much more than it is a body of knowledge.", author: "Carl Sagan" },
      { text: "The important thing is not to stop questioning.", author: "Albert Einstein" },
      { text: "Everything is theoretically impossible, until it is done.", author: "Robert A. Heinlein" },
      { text: "The good thing about science is that it's true whether or not you believe in it.", author: "Neil deGrasse Tyson" },
      { text: "Science and everyday life cannot and should not be separated.", author: "Rosalind Franklin" },
      { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
      { text: "Don't let what you cannot do interfere with what you can do.", author: "John Wooden" }
    ];

    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    const textEl = document.getElementById('quote-text');
    const authEl = document.getElementById('quote-author');
    if (textEl) textEl.textContent = `"${quote.text}"`;
    if (authEl) authEl.textContent = `— ${quote.author}`;
  },

  // --- Library Logic ---
  CURATED_RESOURCES: {
    csir_net: {
      "Biochemistry": [
        { title: "Principles of Biochemistry", author: "Lehninger", url: "https://archive.org/details/LehningerPrinciplesOfBiochemistry" },
        { title: "Biochemistry Notes", author: "Open Library", url: "https://openlibrary.org/subjects/biochemistry" }
      ],
      "Molecular Biology": [
        { title: "Molecular Biology of the Cell", author: "Alberts", url: "https://www.ncbi.nlm.nih.gov/books/NBK21054/" }
      ]
    },
    npsc_cce: {
      "Nagaland History": [
        { title: "A Brief History of Nagaland", author: "State Portal", url: "https://www.nagaland.gov.in/portal/portal/StatePortal/Government/AboutNagaland" }
      ],
      "Indian Polity": [
        { title: "Indian Polity", author: "Laxmikanth (Reference)", url: "https://archive.org/details/indianpolity5thedition" }
      ]
    }
  },

  updateLibraryView() {
    const tabs = document.getElementById('lib-exam-tabs');
    if (!tabs) return;

    tabs.innerHTML = this.state.userExams.map(ex => `
      <div class="lib-tab ${this.state.activeLibExam === ex.id ? 'active' : ''}"
           onclick="app.setLibExam('${ex.id}')">
        ${ex.name}
      </div>
    `).join('');

    this.renderLibraryContent();
  },

  setLibExam(id) {
    this.state.activeLibExam = id;
    this.updateLibraryView();
  },

  async renderLibraryContent() {
    const container = document.getElementById('lib-subjects');
    if (!container) return;

    const examId = this.state.activeLibExam;
    const curated = this.CURATED_RESOURCES[examId] || {};
    const userBooks = await this.dbGetFromIndex('library', 'exam', examId);

    // Group user books by subject
    const groupedUser = {};
    userBooks.forEach(b => {
      if (!groupedUser[b.subject]) groupedUser[b.subject] = [];
      groupedUser[b.subject].push(b);
    });

    // Merge subjects
    const allSubjects = Array.from(new Set([...Object.keys(curated), ...Object.keys(groupedUser)]));

    if (allSubjects.length === 0) {
      container.innerHTML = '<div class="empty-list">No books in this section yet. Add your own or wait for updates!</div>';
      return;
    }

    container.innerHTML = allSubjects.map(sub => `
      <div class="lib-subject-group">
        <h3>${sub}</h3>
        <div class="bookshelf">
          ${(curated[sub] || []).map(b => `
            <div class="book-card" onclick="window.open('${b.url}', '_blank')">
              <div class="book-icon"><i data-lucide="external-link"></i></div>
              <span class="book-title">${b.title}</span>
            </div>
          `).join('')}
          ${(groupedUser[sub] || []).map(b => `
            <div class="book-card" onclick="app.openLocalBook(${b.id})">
              <div class="book-icon"><i data-lucide="file-text"></i></div>
              <span class="book-title">${b.name}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    this.updateLucide();
  },

  async handleLibraryUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const subject = prompt("Enter subject for this book (e.g., Biochemistry, History):") || "General";

    const reader = new FileReader();
    reader.onload = async (e) => {
      await this.dbAdd('library', {
        name: file.name,
        exam: this.state.activeLibExam,
        subject: subject,
        data: e.target.result,
        type: file.type
      });
      this.renderLibraryContent();
      alert('Book added to your shelf!');
    };
    reader.readAsDataURL(file);
  },

  async openLocalBook(id) {
    const book = await this.dbGet('library', id);
    if (!book) return;

    const win = window.open();
    win.document.write(`<iframe src="${book.data}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
  },

  // --- Upload & Analysis Logic ---
  updateUploadView() {
    const select = document.getElementById('upload-exam-select');
    if (select) {
      select.innerHTML = this.state.userExams.map(ex => `<option value="${ex.id}">${ex.name}</option>`).join('');
    }
    this.renderFileList();
  },

  handleFiles(files) {
    const validFiles = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf', 'txt', 'jpg', 'jpeg', 'png'].includes(ext);
    });

    this.state.uploadFiles.push(...validFiles);
    this.renderFileList();
    const btn = document.getElementById('start-analysis-btn');
    if (btn) btn.disabled = this.state.uploadFiles.length === 0;
  },

  removeFile(index) {
    this.state.uploadFiles.splice(index, 1);
    this.renderFileList();
    const btn = document.getElementById('start-analysis-btn');
    if (btn) btn.disabled = this.state.uploadFiles.length === 0;
  },

  renderFileList() {
    const list = document.getElementById('file-list');
    if (list) {
      list.innerHTML = this.state.uploadFiles.map((f, i) => `
        <div class="uz-file">
          <span class="file-item-info">
            <i data-lucide="file" class="file-icon-mini"></i>
            ${f.name}
          </span>
          <button onclick="app.removeFile(${i})" class="remove-file-btn">
            <i data-lucide="x"></i>
          </button>
        </div>
      `).join('');
      this.updateLucide();
    }
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

    if (btn) btn.disabled = true;
    if (progress) progress.classList.remove('hidden');

    try {
      const extractedTexts = [];
      for (let i = 0; i < this.state.uploadFiles.length; i++) {
        const file = this.state.uploadFiles[i];
        const step = 100 / this.state.uploadFiles.length;
        if (status) status.textContent = `Extracting text from ${file.name}...`;
        if (fill) fill.style.width = `${i * step}%`;

        let text = '';
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') text = await this.extractPDFText(file);
        else if (['jpg', 'jpeg', 'png'].includes(ext)) text = await this.extractImageText(file);
        else text = await file.text();

        extractedTexts.push({ name: file.name, text });
        await this.dbAdd('papers', { name: file.name, exam: examId, timestamp: Date.now(), text: text.slice(0, 10000) });
      }

      if (fill) fill.style.width = '90%';
      if (status) status.textContent = 'AI is analyzing questions...';
      await this.performAIAnalysis(examId, extractedTexts);
      if (fill) fill.style.width = '100%';
      if (status) status.textContent = 'Analysis complete!';

      setTimeout(() => {
        if (progress) progress.classList.add('hidden');
        if (btn) btn.disabled = false;
        this.state.uploadFiles = [];
        this.renderFileList();
        this.showView('practice');
        alert('All papers analyzed and added to your bank!');
      }, 1000);
    } catch (e) {
      console.error(e);
      if (status) status.textContent = 'Error: ' + e.message;
      if (btn) btn.disabled = false;
      alert('Analysis failed: ' + e.message);
    }
  },

  async extractPDFText(file) {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 20);
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
    const prompt = `You are an AI specialized in exam preparation for ${examId}. Extract structured questions and topics from the text. For each question, include options, answer, topic name, difficulty, and explanation. For each topic, include its name, frequency (0-100), and priority (high, med, low). Return ONLY a JSON object: { "questions": [...], "topics": [...] }`;
    const response = await this.groqCall(prompt);
    const result = this.parseJSON(response);

    if (result.questions) {
      for (const q of result.questions) {
        q.exam = examId;
        await this.dbAdd('questions', q);
        await this.dbAdd('flashcards', { questionId: null, front: q.text, back: `Answer: ${q.answer}\n\nExplanation: ${q.explanation}`, topic: q.topic, nextReview: Date.now(), interval: 0, repetition: 0, ease: 2.5 });
      }
    }
    if (result.topics) {
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.apiKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" } }),
    });
    if (!resp.ok) throw new Error(`Groq API Error: ${resp.status}`);
    const data = await resp.json();
    return data.choices[0].message.content;
  },

  parseJSON(raw) {
    try {
      let text = raw.trim();
      // Remove markdown code blocks if present
      if (text.includes('```')) {
        const matches = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (matches && matches[1]) {
          text = matches[1];
        } else {
          text = text.replace(/```[a-z]*\n/gi, '').replace(/\n```/g, '');
        }
      }

      // Attempt to find the first '{' and last '}' to strip any leading/trailing text
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        text = text.slice(start, end + 1);
      }

      return JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse JSON', e, raw);
      // Fallback: try to find an array if the object parse failed
      try {
        const startArr = raw.indexOf('[');
        const endArr = raw.lastIndexOf(']');
        if (startArr !== -1 && endArr !== -1) {
          return { questions: JSON.parse(raw.slice(startArr, endArr + 1)) };
        }
      } catch (e2) { }
      return {};
    }
  },

  // --- Practice Logic ---
  async updatePracticeView() {
    const select = document.getElementById('mock-exam-select');
    if (select) {
      select.innerHTML = this.state.userExams.map(ex => `<option value="${ex.id}">${ex.name}</option>`).join('');
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
      alert('No questions found for the selected criteria.');
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
      alert(cards.length === 0 ? 'No flashcards available.' : 'All caught up!');
      return;
    }
    this.openSession('Flashcards', 'flashcard', due);
  },

  showTopicGrid() {
    this.showView('progress'); // Redirect to progress for now
  },

  openSession(title, type, data) {
    this.state.session = { title, type, data, index: 0, startTime: Date.now(), answers: [], score: 0 };
    const titleEl = document.getElementById('session-title');
    if (titleEl) titleEl.textContent = title;
    this.showSubView('active-session-overlay');
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
      footer.innerHTML = `<button class="btn" onclick="app.exitSession()">Exit</button><div style="flex:1"></div><button class="btn accent" onclick="app.nextQuestion()" id="next-q-btn" disabled>Next →</button>`;
    } else {
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
    const btns = document.querySelectorAll('.option-btn');
    btns.forEach(b => b.classList.remove('selected'));
    btns[i].classList.add('selected');
    s.answers[s.index] = String.fromCharCode(65 + i);
    const nextBtn = document.getElementById('next-q-btn');
    if (nextBtn) nextBtn.disabled = false;
  },

  nextQuestion() {
    this.state.session.index++;
    this.renderSessionContent();
  },

  async rateCard(quality) {
    const s = this.state.session;
    const card = s.data[s.index];
    let { interval, repetition, ease } = card;
    if (quality >= 3) {
      if (repetition === 0) interval = 1;
      else if (repetition === 1) interval = 6;
      else interval = Math.round(interval * (ease || 2.5));
      repetition++;
    } else {
      repetition = 0; interval = 1;
    }
    ease = (ease || 2.5) + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ease < 1.3) ease = 1.3;
    card.interval = interval; card.repetition = repetition; card.ease = ease;
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
        if (!topicStats[q.topic]) topicStats[q.topic] = { correct: 0, total: 0 };
        topicStats[q.topic].total++;
        if (s.answers[i] === q.answer) { correctCount++; topicStats[q.topic].correct++; }
      });
      const score = Math.round((correctCount / s.data.length) * 100);
      content.innerHTML = `<div class="results-box"><div class="res-score">${score}%</div><p>${correctCount} correct out of ${s.data.length}</p><p class="muted">Time: ${timerEl ? timerEl.textContent : ''}</p><button class="btn small accent" onclick="app.exportSessionPDF()" style="margin-top:20px">Export Results PDF</button></div>`;

      for (const topicName in topicStats) {
        const stats = topicStats[topicName];
        const topicId = `${s.data[0].exam}_${topicName}`;
        const topic = await this.dbGet('topics', topicId);
        if (topic) {
          const currentMastery = topic.mastery || 0;
          const sessionMastery = (stats.correct / stats.total) * 100;
          topic.mastery = Math.round((currentMastery + sessionMastery) / 2);
          await this.dbPut('topics', topic);
        }
      }
      await this.dbAdd('mock_tests', { exam: s.data[0].exam, date: Date.now(), score, qCount: s.data.length, duration: timerEl ? timerEl.textContent : '', answers: s.answers, questions: s.data });
    } else {
      content.innerHTML = `<div class="results-box"><h3>Review Complete!</h3><p>You've reviewed ${s.data.length} cards today.</p></div>`;
    }
    footer.innerHTML = `<button class="btn accent large" onclick="app.exitSession(true)">Finish</button>`;
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

  exitSession(force = false) {
    if (force || confirm('Are you sure you want to exit?')) {
      if (this.state.sessionTimer) clearInterval(this.state.sessionTimer);
      this.hideSubView('active-session-overlay');
      this.updateDashboard();
    }
  },

  // --- Focus Timer Logic ---
  timer: { minutes: 25, seconds: 0, isRunning: false, interval: null, mode: 'study' },

  showFocusTimer() {
    this.showSubView('focus-timer-overlay');
  },

  toggleTimer() {
    const t = this.timer;
    const btn = document.getElementById('timer-start-btn');
    if (t.isRunning) {
      clearInterval(t.interval); t.isRunning = false;
      if (btn) btn.textContent = 'Resume';
    } else {
      t.isRunning = true;
      if (btn) btn.textContent = 'Pause';
      t.interval = setInterval(() => this.tickTimer(), 1000);
    }
  },

  tickTimer() {
    const t = this.timer;
    if (t.seconds === 0) {
      if (t.minutes === 0) { this.timerFinished(); return; }
      t.minutes--; t.seconds = 59;
    } else t.seconds--;
    this.updateTimerUI();
  },

  updateTimerUI() {
    const t = this.timer;
    const timeStr = `${t.minutes.toString().padStart(2, '0')}:${t.seconds.toString().padStart(2, '0')}`;
    const timeEl = document.getElementById('timer-time');
    if (timeEl) timeEl.textContent = timeStr;
    const total = t.mode === 'study' ? 25 * 60 : 5 * 60;
    const current = t.minutes * 60 + t.seconds;
    const offset = 283 - (current / total) * 283;
    const progressEl = document.getElementById('timer-progress');
    if (progressEl) progressEl.style.strokeDashoffset = offset;
  },

  timerFinished() {
    const t = this.timer;
    clearInterval(t.interval); t.isRunning = false;
    if (t.mode === 'study') { alert('Time for a break!'); t.mode = 'break'; t.minutes = 5; }
    else { alert('Break over!'); t.mode = 'study'; t.minutes = 25; }
    t.seconds = 0;
    const labelEl = document.getElementById('timer-label');
    if (labelEl) labelEl.textContent = t.mode === 'study' ? 'Study Time' : 'Break Time';
    const btnEl = document.getElementById('timer-start-btn');
    if (btnEl) btnEl.textContent = 'Start';
    this.updateTimerUI();
  },

  resetTimer() {
    const t = this.timer;
    clearInterval(t.interval); t.isRunning = false; t.mode = 'study'; t.minutes = 25; t.seconds = 0;
    const labelEl = document.getElementById('timer-label');
    if (labelEl) labelEl.textContent = 'Study Time';
    const btnEl = document.getElementById('timer-start-btn');
    if (btnEl) btnEl.textContent = 'Start';
    this.updateTimerUI();
  },

  exportSessionPDF() {
    const s = this.state.session;
    if (!s || !s.data) return;
    const { jsPDF } = window.jspdf;
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
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.text(`${i + 1}. ${q.text.slice(0, 80)}${q.text.length > 80 ? '...' : ''}`, 20, y); y += 7;
      doc.setFont('helvetica', 'normal'); doc.text(`Your Answer: ${s.answers[i] || 'None'} | Correct: ${q.answer}`, 25, y); y += 10;
    });
    doc.save(`Woni_Result_${Date.now()}.pdf`);
  },

  // --- Progress Logic ---
  async updateProgressView() {
    if (!this.state.db) return;
    const tests = await this.dbGetAll('mock_tests');
    const topics = await this.dbGetAll('topics');
    const ctxEl = document.getElementById('performance-chart');
    if (ctxEl) {
      const ctx = ctxEl.getContext('2d');
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: tests.map(t => new Date(t.date).toLocaleDateString()).slice(-10),
          datasets: [{ label: 'Mock Test Score', data: tests.map(t => t.score).slice(-10), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', fill: true, tension: 0.4 }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
      });
    }

    const heatmap = document.getElementById('mastery-heatmap');
    if (heatmap) {
      if (topics.length > 0) {
        heatmap.innerHTML = topics.map(t => {
          const mastery = t.mastery || 0;
          return `<div class="heatmap-topic" style="background: rgba(16, 185, 129, ${mastery / 100 + 0.1})"><span class="ht-name">${t.name}</span><span class="ht-freq">${mastery}% Mastery</span><span class="ht-subtext">${t.frequency}% Importance</span></div>`;
        }).join('');
      } else {
        heatmap.innerHTML = `<p class="muted">No topics analyzed yet.</p>`;
      }
    }
  },

  // --- Data Management ---
  async exportData() {
    const data = { userExams: this.state.userExams, papers: await this.dbGetAll('papers'), questions: await this.dbGetAll('questions'), flashcards: await this.dbGetAll('flashcards'), progress: await this.dbGetAll('progress'), topics: await this.dbGetAll('topics'), mock_tests: await this.dbGetAll('mock_tests'), version: 1, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `woni_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  },

  async importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text(); const data = JSON.parse(text);
      if (confirm('Importing data will overwrite existing records. Continue?')) {
        const stores = ['papers', 'questions', 'flashcards', 'progress', 'topics', 'mock_tests'];
        for (const store of stores) {
          await this.state.db.clear(store);
          if (data[store]) { for (const item of data[store]) { await this.dbAdd(store, item); } }
        }
        if (data.userExams) { this.state.userExams = data.userExams; localStorage.setItem('woni_user_exams', JSON.stringify(data.userExams)); }
        alert('Data imported successfully!'); location.reload();
      }
    } catch (e) { alert('Import failed: ' + e.message); }
  },

  clearAllData() {
    if (confirm('DANGER: This will delete ALL your study data, papers, and progress. Continue?')) {
      localStorage.clear();
      indexedDB.deleteDatabase('woni_db');
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
