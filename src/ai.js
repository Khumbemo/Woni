// Legacy build: same API, transpiled for older Android WebViews / Safari.
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { parseJSON, splitIntoChunks, findAnswerKey, salvageArray, mergeAnalyses, textAfterQuestion } from './utils.js';

// pdf.js and Tesseract are large; load them only when a file is analyzed.
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = pdfWorker;
    return lib;
  });
  return pdfjsPromise;
}

const MAX_PDF_PAGES = 60;
const MAX_OCR_PAGES = 30;       // OCR takes a few seconds a page
const SCANNED_PAGE_CHARS = 20;  // fewer real characters than this: treat the page as a scan

/** Draw a PDF page at a resolution good enough for OCR (about 2× screen size, capped). */
async function renderPageToCanvas(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return canvas;
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
// Long papers are analysed in parts (see performAIAnalysis).
const CHUNK_CHARS = 6000;          // ≈15-20 questions; their JSON fits in one reply
const ANALYSIS_MAX_TOKENS = 8000;  // reply length asked for (the proxy may cap it lower)
const MAX_PARTS = 16;              // ≈96k characters: a few full papers per analysis
const MAX_CALLS = 30;              // including follow-ups after a cut-off reply
const MAX_SPLIT_DEPTH = 2;
const MIN_SPLIT_CHARS = 1500;
const RATE_LIMIT_WAITS = [20, 40, 60]; // seconds
const RECHECK_BATCH = 10;    // questions per second-opinion request

export const aiMixin = {
  /**
   * Text of a PDF. Pages without a text layer (scans, photos) are rendered
   * and read with OCR. `onProgress(message)` reports long steps.
   */
  async extractPDFText(file, onProgress = () => {}) {
    const pdfjsLib = await loadPdfjs();
    const ab = await file.arrayBuffer();
    // Uploaded PDFs are untrusted: never let pdf.js evaluate code from them
    // (defence in depth against bugs like CVE-2024-4367).
    const loadingTask = pdfjsLib.getDocument({ data: ab, isEvalSupported: false });
    const pdf = await loadingTask.promise;
    let ocr = null;
    try {
      const pages = [];
      const maxPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
      let ocrPages = 0;
      for (let p = 1; p <= maxPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        let text = content.items.map(i => i.str || '').join(' ').trim();
        if (text.replace(/\s/g, '').length < SCANNED_PAGE_CHARS && ocrPages < MAX_OCR_PAGES) {
          onProgress(`Reading scanned page ${p} of ${maxPages} (OCR)...`);
          ocr ??= await this._ocrWorker();
          const canvas = await renderPageToCanvas(page);
          const { data } = await ocr.recognize(canvas);
          text = (data.text || '').trim();
          ocrPages++;
        }
        page.cleanup();
        pages.push(text);
      }
      return pages.join('\n').trim();
    } finally {
      await ocr?.terminate();
      await loadingTask.destroy(); // free the worker's copy of the document
    }
  },

  async extractImageText(file) {
    const worker = await this._ocrWorker();
    try {
      const result = await worker.recognize(file);
      return result.data.text;
    } finally {
      await worker.terminate();
    }
  },

  /** A Tesseract worker using the copies of its files served with the app (see vite.config.js). */
  async _ocrWorker() {
    const { createWorker } = await import('tesseract.js');
    // Absolute URLs: the worker resolves relative paths against its own location.
    const base = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href;
    return createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      // The Claude preview overrides this (see artifact/shim.js).
      langPath: this.ocrLangPath || `${base}lang`,
      workerBlobURL: false,
    });
  },

  /**
   * Official syllabus unit names per exam, injected into AI prompts
   * so extracted topics align with real exam categories.
   */
  SYLLABUS_HINTS: {
    csir_net: 'Official CSIR NET Life Science units: (1) Molecules & Interaction, (2) Cellular Organization, (3) Fundamental Processes, (4) Cell Communication, (5) Developmental Biology, (6) System Physiology (Plant & Animal), (7) Inheritance Biology, (8) Diversity of Life Forms, (9) Ecological Principles, (10) Evolution & Behaviour, (11) Applied Biology, (12) Methods in Biology.',
    gate_ls: 'Official GATE Life Sciences sections: General Aptitude, Chemistry, Biochemistry, Botany, Microbiology, Zoology, Food Technology, Ecology & Evolution.',
    ugc_net_env: 'Official UGC NET Environmental Sciences units: Environmental Chemistry, Pollution & Control, Environmental Biology & Ecology, Environmental Management & Policy, Climate Change & Sustainability, Biodiversity & Conservation, EIA & Audit.',
    npsc_ncs: 'NPSC NCS sections: General English, General Knowledge, History of Nagaland, Indian Polity, Geography, Economy, Current Affairs, Aptitude & Reasoning.',
    slet_ls: 'SLET Life Science units: Cell Biology, Genetics & Molecular Biology, Biochemistry, Physiology (Plant & Animal), Ecology & Evolution, Taxonomy & Systematics, Immunology, Biotechnology, Microbiology.',
  },

  /**
   * Performs AI analysis on extracted texts.
   * IMPORTANT: This method only RETURNS parsed data — it does NOT save to IndexedDB.
   * Saving happens in saveReviewedAnalysis() after user review.
   *
   * Papers are analysed in parts of about CHUNK_CHARS, cut between questions,
   * so long papers are covered in full and each reply stays short enough to
   * finish. A reply that was cut off anyway keeps its complete questions, and
   * its part is split in two and asked again.
   * `onProgress(message, fraction)` reports progress.
   */
  async performAIAnalysis(examId, extractedTexts, onProgress = () => {}) {
    let parts = [];
    for (const file of extractedTexts) {
      const key = findAnswerKey(file.text);
      for (const text of splitIntoChunks(file.text, CHUNK_CHARS)) parts.push({ name: file.name, text, key, depth: 0 });
    }
    const skippedParts = Math.max(0, parts.length - MAX_PARTS);
    parts = parts.slice(0, MAX_PARTS);

    const results = [];
    let total = parts.length, done = 0, calls = 0, failedParts = 0, firstError = null;
    while (parts.length && calls < MAX_CALLS) {
      const part = parts.shift();
      onProgress(total > 1 ? `AI is analyzing part ${done + 1} of ${total}...` : 'AI is analyzing questions...', done / total);
      let response;
      try {
        calls++;
        response = await this._withRateLimitRetry(() => this.groqCall(this._analysisPrompt(examId, part), { maxTokens: ANALYSIS_MAX_TOKENS }), onProgress);
      } catch (e) {
        // Out of quota or no connection: later parts would fail the same way.
        firstError = e;
        failedParts++;
        break;
      }
      const parsed = this.parseJSON(response);
      if (Array.isArray(parsed.questions)) {
        results.push(parsed);
        done++;
        continue;
      }
      // Not valid JSON: usually the reply hit its length limit. Keep its
      // complete questions and ask again for the text after the last one.
      const salvaged = { questions: salvageArray(response, 'questions'), topics: salvageArray(response, 'topics') };
      const last = salvaged.questions.filter(q => q && typeof q.text === 'string').at(-1);
      const rest = last ? textAfterQuestion(part.text, last.text) : null;
      if (rest !== null && rest.length < part.text.length) {
        results.push(salvaged);
        done++;
        if (rest) {
          parts.unshift({ ...part, text: rest });
          total++;
        }
        continue;
      }
      // Nothing usable to continue from: split the part in two instead.
      const halves = part.depth < MAX_SPLIT_DEPTH && part.text.length >= MIN_SPLIT_CHARS
        ? splitIntoChunks(part.text, Math.ceil(part.text.length / 2) + 200) : [];
      if (halves.length > 1) {
        parts.unshift(...halves.map(text => ({ ...part, text, depth: part.depth + 1 })));
        total += halves.length - 1;
      } else {
        results.push(salvaged);
        done++;
      }
    }
    failedParts += parts.length; // left over after MAX_CALLS
    if (results.length === 0 && firstError) throw firstError;

    const { questions, topics } = mergeAnalyses(results.map(r => ({
      questions: Array.isArray(r.questions) ? r.questions.filter(q => q && typeof q === 'object') : [],
      topics: Array.isArray(r.topics) ? r.topics.filter(t => t && typeof t === 'object' && t.name) : [],
    })));

    // Tag each item with the exam ID (but do NOT save to DB yet)
    questions.forEach(q => {
      q.exam = examId;
      q.answerSource = q.answerSource === 'paper' ? 'paper' : 'ai';
      if (typeof q.source !== 'string') delete q.source;
    });
    topics.forEach(t => {
      t.id = `${examId}_${t.name}`;
      t.exam = examId;
    });

    return { questions, topics, partsTotal: total + skippedParts, failedParts, skippedParts };
  },

  _analysisPrompt(examId, part) {
    const syllabusHint = this.SYLLABUS_HINTS[examId] || '';
    // The answer key usually sits at the end of the paper; give it to every part.
    const key = part.key && !part.text.includes(part.key.slice(0, 200))
      ? `\nThe paper's answer key (from elsewhere in the paper; match answers by question number):\n<answer-key>\n${part.key}\n</answer-key>\n`
      : '';
    return `You are an AI specialized in exam preparation for ${examId}.
${syllabusHint ? `Use these official syllabus units to categorize topics: ${syllabusHint}` : ''}
Below is text extracted from part of the student's exam paper ${part.name ? `"${part.name}" ` : ''}between <paper> tags.
Extract EVERY multiple-choice question that appears IN THIS TEXT, in order. Do not invent new questions.
Skip a question only if it is cut off at the start or end of this part.
If the text contains an answer key or worked solutions, use them for the answers.

For each question, include:
- "text": The question, as written in the paper.
- "options": An array of its options (usually 4), as written.
- "answer": The correct option letter (A, B, C or D).
- "answerSource": "paper" if the answer comes from an answer key or solution in the paper, otherwise "ai".
- "source": A short exact quote (8-20 words) copied from the paper where the question appears.
- "topic": The specific topic name (align with official syllabus units when possible).
- "difficulty": easy, medium, or hard.
- "explanation": One or two sentences on why the answer is correct.

For each topic covered by this part, include:
- "name": The topic name (use official syllabus unit names when applicable).
- "frequency": Estimated importance (0-100).
- "priority": high, med, or low.

Return ONLY a JSON object: { "questions": [...], "topics": [...] }
${key}
<paper>
${part.text}
</paper>`;
  },

  /** Run an AI call, waiting and retrying when the per-minute limit is hit (not the daily one). */
  async _withRateLimitRetry(call, onProgress = () => {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (e) {
        const msg = String(e?.message || '');
        const perMinute = /too many|\(429\)|rate.?limit/i.test(msg) && !/daily/i.test(msg);
        if (!perMinute || attempt >= RATE_LIMIT_WAITS.length) throw e;
        const secs = RATE_LIMIT_WAITS[attempt];
        onProgress(`AI rate limit reached. Waiting ${secs} seconds...`);
        await this._sleep(secs * 1000);
      }
    }
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Second opinion: ask the AI to answer the questions again without seeing
   * the first answers, and report where the two disagree.
   * Returns [{ index, answer, reason }] for the questions it could answer.
   */
  async recheckAnswers(examId, questions) {
    const results = [];
    for (let start = 0; start < questions.length; start += RECHECK_BATCH) {
      const batch = questions.slice(start, start + RECHECK_BATCH);
      const list = batch.map((q, i) => `${i + 1}. ${q.text}\n${(q.options || []).map((o, j) => `   ${String.fromCharCode(65 + j)}) ${o}`).join('\n')}`).join('\n\n');
      const prompt = `You are an expert examiner for ${examId}. Solve each multiple-choice question independently and carefully.
Think about each one, then give the single best option letter.

${list}

Return ONLY a JSON object: { "answers": [ { "n": <question number>, "answer": "<letter>", "reason": "<one sentence>" } ] }`;
      let parsed;
      try {
        parsed = this.parseJSON(await this._withRateLimitRetry(() => this.groqCall(prompt)));
      } catch (e) {
        // Keep the answers already checked; the rest show as "not checked".
        if (results.length === 0) throw e;
        break;
      }
      for (const a of Array.isArray(parsed.answers) ? parsed.answers : []) {
        const n = Number(a?.n);
        const letter = String(a?.answer || '').trim().toUpperCase().charAt(0);
        if (!Number.isInteger(n) || n < 1 || n > batch.length || !/^[A-H]$/.test(letter)) continue;
        results.push({ index: start + n - 1, answer: letter, reason: String(a.reason || '').slice(0, 300) });
      }
    }
    return results;
  },

  getProxyUrl() {
    return 'https://woni-ai-proxy.khumbemo.workers.dev/chat';
  },

  // --- Freemium Counter with Tamper Detection ---
  _freemiumHash(count) {
    // Simple hash to detect localStorage tampering
    return btoa(`woni_fc_${count}_salt_x7k`);
  },

  getFreemiumCount() {
    const count = parseInt(localStorage.getItem('woni_freemium_count') || '0', 10);
    const hash = localStorage.getItem('woni_freemium_hash');
    // If hash doesn't match, the counter was tampered — treat as exhausted
    if (hash && hash !== this._freemiumHash(count)) {
      return 5; // Max out
    }
    return count;
  },

  incrementFreemium() {
    if (this.state.apiKey) return;
    const count = this.getFreemiumCount() + 1;
    localStorage.setItem('woni_freemium_count', count.toString());
    localStorage.setItem('woni_freemium_hash', this._freemiumHash(count));
    this.updateSettingsUI();
  },

  updateSettingsUI() {
    const info = document.getElementById('api-key-info');
    if (!info) return;
    info.textContent = this.state.apiKey
      ? 'Using your own Groq API key. No limit from Woni.'
      : `Free analyses used: ${this.getFreemiumCount()} of 5.`;
  },

  /**
   * One chat completion via the user's Groq key, or the Woni proxy when no
   * key is saved. Returns the reply text.
   */
  async _chatCompletion({ messages, json = false, temperature, maxTokens }) {
    const useProxy = !this.state.apiKey;
    const url = useProxy ? this.getProxyUrl() : GROQ_URL;
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${this.state.apiKey}`;

    const body = { model: GROQ_MODEL, messages };
    if (json) body.response_format = { type: 'json_object' };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    let resp;
    try {
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (networkErr) {
      if (useProxy) {
        throw new Error('AI Proxy is currently unavailable. Please add your own free Groq API Key in Settings → API Key.');
      }
      throw new Error('Network error: Could not reach Groq API. Check your internet connection.');
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      if (useProxy) {
        let reason = '';
        try { reason = JSON.parse(errBody).error || ''; } catch {}
        throw new Error(`${reason || 'AI Proxy returned an error.'} You can add your own free Groq API Key in Settings → API Key.`);
      }
      throw new Error(`Groq API Error (${resp.status}): ${errBody.slice(0, 120)}`);
    }
    const data = await resp.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  },

  /** JSON-mode call used by paper analysis. */
  groqCall(prompt, { maxTokens } = {}) {
    return this._chatCompletion({ messages: [{ role: 'user', content: prompt }], json: true, maxTokens });
  },

  /** Plain-text call used by the analysis chat. */
  groqTextCall(prompt) {
    return this._chatCompletion({ messages: [{ role: 'user', content: prompt }] });
  },

  parseJSON(raw) {
    return parseJSON(raw);
  },

  /**
   * Subject-guarded conversational AI tutor for the Library Study Assistant.
   * Takes a full message history for multi-turn context.
   * @param {string} systemPrompt - The system instruction with subject constraints
   * @param {Array} messages - Array of { role: 'user'|'assistant', content: string }
   * @returns {string} The AI response text
   */
  async groqTutorCall(systemPrompt, messages) {
    return this._chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10), // Keep last 10 messages for context window efficiency
      ],
      temperature: 0.7,
      maxTokens: 1024,
    });
  }
};
