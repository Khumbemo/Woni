// Legacy build: same API, transpiled for older Android WebViews / Safari.
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { parseJSON } from './utils.js';

// pdf.js and Tesseract are large; load them only when a file is analyzed.
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = pdfWorker;
    return lib;
  });
  return pdfjsPromise;
}

const MAX_PDF_PAGES = 20;
const MAX_OCR_PAGES = 10;       // OCR takes a few seconds a page
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
const PAPER_BUDGET = 12000;  // characters of paper text sent for analysis
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
      langPath: `${base}lang`,
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
   * Smart text sampling — instead of a naive first-N-chars slice,
   * take chunks from beginning, middle, and end of each source
   * to capture better context from large PDFs.
   */
  _smartSample(text, budget = 4000) {
    if (text.length <= budget) return text;
    const third = Math.floor(budget / 3);
    const start = text.slice(0, third);
    const midPoint = Math.floor(text.length / 2);
    const middle = text.slice(midPoint - Math.floor(third / 2), midPoint + Math.floor(third / 2));
    const end = text.slice(-third);
    return `${start}\n[...middle section...]\n${middle}\n[...end section...]\n${end}`;
  },

  /**
   * Performs AI analysis on extracted texts.
   * IMPORTANT: This method only RETURNS parsed data — it does NOT save to IndexedDB.
   * Saving happens in saveReviewedAnalysis() after user review.
   */
  async performAIAnalysis(examId, extractedTexts) {
    // ~12k characters of paper (≈3k tokens) leaves room for the answer within
    // free-tier Groq limits and the proxy's prompt cap.
    const budget = Math.max(2000, Math.floor(PAPER_BUDGET / Math.max(1, extractedTexts.length)));
    const combinedText = extractedTexts.map(t => `SOURCE: ${t.name}\n${this._smartSample(t.text, budget)}`).join('\n---\n');
    const syllabusHint = this.SYLLABUS_HINTS[examId] || '';
    const prompt = `You are an AI specialized in exam preparation for ${examId}.
${syllabusHint ? `Use these official syllabus units to categorize topics: ${syllabusHint}` : ''}
Below is text extracted from the student's exam paper(s), between <paper> tags.
Extract the multiple-choice questions that appear IN THIS TEXT. Do not invent new questions.
If the text contains an answer key or worked solutions, use them for the answers.

For each question, include:
- "text": The question, as written in the paper.
- "options": An array of its options (usually 4), as written.
- "answer": The correct option letter (A, B, C or D).
- "answerSource": "paper" if the answer comes from an answer key or solution in the text, otherwise "ai".
- "source": A short exact quote (8-20 words) copied from the paper where the question appears.
- "topic": The specific topic name (align with official syllabus units when possible).
- "difficulty": easy, medium, or hard.
- "explanation": A brief explanation of why the answer is correct.

For each topic covered by the paper, include:
- "name": The topic name (use official syllabus unit names when applicable).
- "frequency": Estimated importance (0-100).
- "priority": high, med, or low.

Return ONLY a JSON object: { "questions": [...], "topics": [...] }

<paper>
${combinedText}
</paper>`;

    const response = await this.groqCall(prompt);
    const result = this.parseJSON(response);
    const questions = Array.isArray(result.questions) ? result.questions.filter(q => q && typeof q === 'object') : [];
    const topics = Array.isArray(result.topics) ? result.topics.filter(t => t && typeof t === 'object' && t.name) : [];

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

    return { questions, topics };
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
      const parsed = this.parseJSON(await this.groqCall(prompt));
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
  groqCall(prompt) {
    return this._chatCompletion({ messages: [{ role: 'user', content: prompt }], json: true });
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
