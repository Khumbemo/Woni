/**
 * Woni — Upload & Analysis View Module
 * Handles file uploads, AI analysis, analysis review, and the analysis chat assistant.
 */

export const uploadMixin = {
  updateUploadView() {
    this.renderFileList();
    this.renderAnalysisAssistant();
  },

  handleFiles(files) {
    const validFiles = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf', 'txt', 'jpg', 'jpeg', 'png'].includes(ext);
    });
    this.state.uploadFiles.push(...validFiles);
    this.renderFileList();
  },

  removeFile(index) {
    this.state.uploadFiles.splice(parseInt(index), 1);
    this.renderFileList();
  },

  renderFileList() {
    const list = document.getElementById('file-list');
    const btn = document.getElementById('start-analysis-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = this.state.uploadFiles.length > 0
        ? `Analyze with AI (${this.state.uploadFiles.length} file${this.state.uploadFiles.length > 1 ? 's' : ''}) →`
        : 'Analyze with AI →';
    }
    if (list) {
      list.innerHTML = this.state.uploadFiles.map((f, i) => `
        <div class="uz-file">
          <span class="file-item-info">
            <i data-lucide="file" class="file-icon-mini"></i>
            ${this.escapeHtml(f.name)}
          </span>
          <button data-action="removeFile" data-param="${i}" class="remove-file-btn">
            <i data-lucide="x"></i>
          </button>
        </div>
      `).join('');
      this.updateLucide();
    }
  },

  async startAnalysis() {
    if (!this.state.apiKey) {
      const freemiumCount = this.getFreemiumCount ? this.getFreemiumCount() : parseInt(localStorage.getItem('woni_freemium_count') || '0', 10);
      if (freemiumCount >= 5) {
        this.showToast('Freemium limit reached (5/5). Please save your API Key.', 'error');
        this.showView('settings');
        return;
      } else {
        this.showToast(`Using Freemium Tier (${freemiumCount + 1}/5)`, 'info');
      }
    }

    const btn = document.getElementById('start-analysis-btn');
    const progress = document.getElementById('analysis-progress');
    const fill = document.getElementById('progress-fill');
    const status = document.getElementById('progress-status');
    const fileInput = document.getElementById('file-input');
    const examId = this.state.activeExam?.id || this.state.userExams[0]?.id;

    if (!examId) {
      this.showToast('Please select your target exam first.', 'error');
      this.showOnboarding();
      return;
    }

    // Minimal Upload UI: first tap opens file picker.
    if (this.state.uploadFiles.length === 0) {
      if (fileInput) fileInput.click();
      return;
    }

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
      const analysis = await this.performAIAnalysis(examId, extractedTexts);

      this.state.latestAnalysisContext = {
        examId,
        topics: (analysis?.topics || []).slice(0, 6),
        questions: (analysis?.questions || []).slice(0, 5).map(q => q.text || '').filter(Boolean),
        chat: [],
      };

      // Validate before presenting for review
      const validatedQuestions = (analysis?.questions || []).map(q => this.validateQuestion(q));
      const validatedTopics = (analysis?.topics || []).map(t => this.validateTopic(t));

      this.state.pendingAnalysis = {
        examId,
        questions: validatedQuestions.map(q => ({ ...q, approved: (q.confidence || 0) >= 0.55 })),
        topics: validatedTopics.map(t => ({ ...t, approved: (t.confidence || 0) >= 0.55 })),
      };

      if (fill) fill.style.width = '100%';
      if (status) status.textContent = 'Analysis complete!';
      this.renderAnalysisReview();
      this.renderAnalysisAssistant();
      await this.updateDashboard();

      setTimeout(() => {
        if (progress) progress.classList.add('hidden');
        if (btn) btn.disabled = false;
        this.state.uploadFiles = [];
        this.renderFileList();
        this.showToast('Analysis complete! Review flagged items, then save.', 'success');
      }, 1000);
    } catch (e) {
      console.error(e);
      if (status) status.textContent = 'Error: ' + e.message;
      if (btn) btn.disabled = false;
      this.showToast('Analysis failed: ' + e.message, 'error');
      if (e.message && e.message.includes('API Key')) {
        setTimeout(() => this.showView('settings'), 1500);
      }
    }
  },

  // --- Analysis Review Panel ---
  renderAnalysisReview() {
    const wrap = document.getElementById('analysis-review');
    const summary = document.getElementById('analysis-review-summary');
    const list = document.getElementById('analysis-review-list');
    if (!wrap || !summary || !list) return;
    const p = this.state.pendingAnalysis;
    if (!p) {
      wrap.classList.add('hidden');
      list.innerHTML = '';
      summary.textContent = '';
      return;
    }
    wrap.classList.remove('hidden');
    const flaggedQ = p.questions.filter(q => q.issues.length > 0 || q.confidence < 0.6).length;
    const flaggedT = p.topics.filter(t => t.issues.length > 0 || t.confidence < 0.6).length;
    summary.textContent = `${p.questions.length} questions, ${p.topics.length} topics · Flagged: ${flaggedQ + flaggedT}`;

    const qRows = p.questions.slice(0, 8).map((q, idx) => `
      <div class="analysis-review-item">
        <div class="analysis-review-head">
          <label class="analysis-review-title"><input type="checkbox" data-kind="question" data-idx="${idx}" ${q.approved ? 'checked' : ''}> Q${idx + 1}: ${this.escapeHtml(q.topic || 'General')}</label>
          <span class="analysis-review-meta">confidence ${(q.confidence * 100).toFixed(0)}%</span>
        </div>
        <div class="analysis-review-meta">${this.escapeHtml((q.text || '').slice(0, 140))}</div>
        <div class="analysis-review-issues">${q.issues.length ? this.escapeHtml(q.issues.join(', ')) : 'No rule issues'}</div>
      </div>
    `).join('');

    const tRows = p.topics.slice(0, 8).map((t, idx) => `
      <div class="analysis-review-item">
        <div class="analysis-review-head">
          <label class="analysis-review-title"><input type="checkbox" data-kind="topic" data-idx="${idx}" ${t.approved ? 'checked' : ''}> Topic: ${this.escapeHtml(t.name)}</label>
          <span class="analysis-review-meta">confidence ${(t.confidence * 100).toFixed(0)}%</span>
        </div>
        <div class="analysis-review-meta">Frequency ${t.frequency}% · Priority ${this.escapeHtml(t.priority)}</div>
        <div class="analysis-review-issues">${t.issues.length ? this.escapeHtml(t.issues.join(', ')) : 'No rule issues'}</div>
      </div>
    `).join('');

    list.innerHTML = qRows + tRows;
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const kind = e.target.dataset.kind;
        const idx = parseInt(e.target.dataset.idx, 10);
        if (kind === 'question' && p.questions[idx]) p.questions[idx].approved = e.target.checked;
        if (kind === 'topic' && p.topics[idx]) p.topics[idx].approved = e.target.checked;
      });
    });
  },

  async saveReviewedAnalysis() {
    const p = this.state.pendingAnalysis;
    if (!p) return;
    const approvedQuestions = p.questions.filter(q => q.approved);
    const approvedTopics = p.topics.filter(t => t.approved);
    if (approvedQuestions.length === 0 && approvedTopics.length === 0) {
      this.showToast('Select at least one approved item to save.', 'error');
      return;
    }

    for (const q of approvedQuestions) {
      const clean = { ...q };
      delete clean.issues; delete clean.approved;
      clean.exam = p.examId;

      // Deduplication: check if a similar question already exists
      const existing = await this.dbGetFromIndex('questions', 'exam', p.examId);
      const isDuplicate = existing.some(eq =>
        eq.text && clean.text && eq.text.trim().toLowerCase() === clean.text.trim().toLowerCase()
      );
      if (isDuplicate) continue;

      await this.dbAdd('questions', clean);
      await this.dbAdd('flashcards', {
        questionId: null,
        front: clean.text,
        back: `Answer: ${clean.answer}\n\nExplanation: ${clean.explanation}`,
        topic: clean.topic,
        nextReview: Date.now(),
        interval: 0,
        repetition: 0,
        ease: 2.5
      });
    }

    for (const t of approvedTopics) {
      const clean = { ...t };
      delete clean.issues; delete clean.approved;
      clean.id = `${p.examId}_${clean.name}`;
      clean.exam = p.examId;
      await this.dbPut('topics', clean);
    }

    this.state.pendingAnalysis = null;
    this.renderAnalysisReview();
    await this.updateDashboard();
    this.showToast(`Saved ${approvedQuestions.length} questions and ${approvedTopics.length} topics to your bank.`, 'success');
  },

  // --- Analysis Chat Assistant ---
  renderAnalysisAssistant() {
    const wrapper = document.getElementById('analysis-assistant');
    const log = document.getElementById('analysis-chat-log');
    if (!wrapper || !log) return;
    const ctx = this.state.latestAnalysisContext;
    if (!ctx) {
      wrapper.classList.add('hidden');
      log.innerHTML = '';
      return;
    }
    wrapper.classList.remove('hidden');
    if (!ctx.chat || ctx.chat.length === 0) {
      ctx.chat = [{
        role: 'ai',
        text: `Analysis loaded for ${ctx.examId}. Ask me anything about priority topics, likely repeated questions, or how to revise effectively.`,
      }];
    }
    log.innerHTML = ctx.chat.map(m => `
      <div class="analysis-chat-msg ${m.role === 'user' ? 'user' : 'ai'}">${this.escapeHtml(m.text)}</div>
    `).join('');
    log.scrollTop = log.scrollHeight;
  },

  async askAnalysisAssistant() {
    const input = document.getElementById('analysis-chat-input');
    const sendBtn = document.getElementById('analysis-chat-send');
    if (!input) return;
    const question = input.value.trim();
    if (!question) return;
    if (!this.state.latestAnalysisContext) {
      this.showToast('Run analysis first to ask topic-specific questions.', 'info');
      return;
    }
    input.value = '';
    if (sendBtn) sendBtn.disabled = true;
    const ctx = this.state.latestAnalysisContext;
    ctx.chat = ctx.chat || [];
    ctx.chat.push({ role: 'user', text: question });
    this.renderAnalysisAssistant();

    try {
      const prompt = `You are Woni study assistant. Use this analysis context to answer the student clearly.\nExam: ${ctx.examId}\nTop topics: ${ctx.topics.map(t => `${t.name} (${t.frequency}%/${t.priority})`).join(', ')}\nExample questions: ${ctx.questions.map(q => `- ${q}`).join('\n')}\n\nStudent question: ${question}\n\nGive concise practical answer with 3-6 bullets.`;
      const answer = await this.groqTextCall(prompt);
      ctx.chat.push({ role: 'ai', text: answer || 'I could not generate a response right now. Please try again.' });
    } catch (e) {
      ctx.chat.push({ role: 'ai', text: `I hit an error while answering: ${e.message}` });
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      this.renderAnalysisAssistant();
    }
  },

  // --- Validation ---
  validateQuestion(question) {
    const issues = [];
    const options = Array.isArray(question.options) ? question.options.filter(Boolean) : [];
    const text = String(question.text || '').trim();
    const answer = String(question.answer || '').trim();
    const explanation = String(question.explanation || '').trim();

    if (text.length < 12) issues.push('Question text too short');
    if (options.length < 2) issues.push('At least 2 options required');
    if (!explanation) issues.push('Explanation missing');

    const answerUpper = answer.toUpperCase();
    const byLetter = /^[A-Z]$/.test(answerUpper) ? options[answerUpper.charCodeAt(0) - 65] : null;
    const answerMatchesOption = options.some(opt => String(opt).trim().toLowerCase() === answer.toLowerCase());
    if (!answer || (!byLetter && !answerMatchesOption && !/^[A-Z]$/.test(answerUpper))) {
      issues.push('Answer not aligned with options');
    }

    let confidence = typeof question.confidence === 'number' ? question.confidence : 0.65;
    if (issues.length === 0) confidence += 0.2;
    if (issues.length >= 2) confidence -= 0.2;
    confidence = Math.max(0.2, Math.min(0.98, confidence));

    return { ...question, options, issues, confidence };
  },

  validateTopic(topic) {
    const issues = [];
    const name = String(topic.name || '').trim();
    if (!name) issues.push('Topic name missing');
    const frequency = Math.max(0, Math.min(100, Number(topic.frequency || 0)));
    const priority = ['high', 'med', 'low'].includes(String(topic.priority || '').toLowerCase())
      ? String(topic.priority).toLowerCase()
      : (frequency >= 35 ? 'high' : frequency >= 20 ? 'med' : 'low');
    const note = String(topic.note || '').trim()
      || `Revise ${name || 'this topic'} with concept summary + repeated PYQ patterns.`;

    let confidence = typeof topic.confidence === 'number' ? topic.confidence : 0.7;
    if (issues.length > 0) confidence -= 0.25;
    confidence = Math.max(0.2, Math.min(0.98, confidence));

    return { ...topic, name, frequency, priority, note, issues, confidence };
  },

  EXAM_TOPIC_GUARD: {
    csir_net: ['biochem', 'molecular', 'cell', 'genetic', 'ecology', 'evolution', 'plant', 'animal', 'physiology', 'immunology', 'microbiology', 'biotechnology', 'biostat', 'bioinformatics', 'development', 'taxonomy'],
    gate_ls: ['biochem', 'molecular', 'cell', 'genetic', 'ecology', 'evolution', 'plant', 'animal', 'physiology', 'microbiology', 'biotechnology'],
    ugc_net_env: ['environment', 'ecology', 'pollution', 'biodiversity', 'conservation', 'climate', 'sustainability', 'ecosystem', 'forest', 'wildlife'],
    npsc_ncs: ['history', 'polity', 'geography', 'economy', 'nagaland', 'current affairs', 'aptitude'],
    slet_ls: ['biochem', 'molecular', 'cell', 'genetic', 'ecology', 'evolution', 'plant', 'animal', 'physiology', 'immunology', 'microbiology', 'biotechnology', 'life science'],
  },

  isRelevantToExam(examId, topicName = '', questionText = '') {
    const guards = this.EXAM_TOPIC_GUARD[examId];
    if (!guards || guards.length === 0) return true;
    const hay = `${String(topicName).toLowerCase()} ${String(questionText).toLowerCase()}`;
    return guards.some(g => hay.includes(g));
  },

  async secondPassVerify(examId, questions, topics) {
    try {
      const payload = { examId, questions: questions.slice(0, 40), topics: topics.slice(0, 20) };
      const prompt = `You are a strict exam-data validator. Fix malformed items and improve quality.\nReturn ONLY JSON with same shape:\n{"questions":[{text,options,answer,topic,difficulty,explanation,confidence}],"topics":[{name,frequency,priority,focusReason,note,confidence}]}\nInput JSON:\n${JSON.stringify(payload)}`;
      const resp = await this.groqCall(prompt);
      const parsed = this.parseJSON(resp);
      return {
        questions: Array.isArray(parsed.questions) ? parsed.questions : questions,
        topics: Array.isArray(parsed.topics) ? parsed.topics : topics,
      };
    } catch (e) {
      return { questions, topics };
    }
  },

  async getImportantTopics(examId) {
    if (!examId) return [];
    const topics = await this.dbGetFromIndex('topics', 'exam', examId);
    const important = topics
      .filter(t => (t.frequency || 0) >= 40 || ['high', 'med'].includes((t.priority || '').toLowerCase()))
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
      .slice(0, 6);
    if (important.length > 0) return important;
    return topics.sort((a, b) => (b.frequency || 0) - (a.frequency || 0)).slice(0, 6);
  },

  makeFallbackTopics(questions = []) {
    const map = {};
    for (const q of questions) {
      const topicName = (q.topic || 'General').trim();
      if (!map[topicName]) map[topicName] = { count: 0, examples: [] };
      map[topicName].count++;
      if (map[topicName].examples.length < 2) map[topicName].examples.push(q.text || '');
    }
    const total = questions.length || 1;
    return Object.entries(map).map(([name, info]) => {
      const frequency = Math.round((info.count / total) * 100);
      const priority = frequency >= 35 ? 'high' : frequency >= 20 ? 'med' : 'low';
      return { name, frequency, priority, focusReason: `Appears in ${info.count} extracted question(s).`, note: `Focus on ${name}: revise core definitions, standard question patterns, and common mistakes.` };
    }).sort((a, b) => b.frequency - a.frequency);
  },

  runBenchmarkSuite(benchmarkSet = []) {
    const rows = benchmarkSet.map(item => {
      const predTopics = new Set((item.predictedTopics || []).map(t => String(t).toLowerCase()));
      const truthTopics = new Set((item.truthTopics || []).map(t => String(t).toLowerCase()));
      const tp = [...truthTopics].filter(t => predTopics.has(t)).length;
      const precision = predTopics.size ? tp / predTopics.size : 0;
      const recall = truthTopics.size ? tp / truthTopics.size : 0;
      const f1 = (precision + recall) ? (2 * precision * recall / (precision + recall)) : 0;
      return { id: item.id, precision, recall, f1 };
    });
    const avg = rows.reduce((a, r) => ({ precision: a.precision + r.precision, recall: a.recall + r.recall, f1: a.f1 + r.f1 }), { precision: 0, recall: 0, f1: 0 });
    const n = rows.length || 1;
    return { sampleCount: rows.length, average: { precision: avg.precision / n, recall: avg.recall / n, f1: avg.f1 / n }, rows, note: 'Use this with 50-100 manually labeled papers for reliable benchmark.' };
  },
};
