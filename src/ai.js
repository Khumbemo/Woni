import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { parseJSON } from './utils.js';

// pdf.js and Tesseract are large; load them only when a file is analyzed.
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = pdfWorker;
    return lib;
  });
  return pdfjsPromise;
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export const aiMixin = {
  async extractPDFText(file) {
    const pdfjsLib = await loadPdfjs();
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
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const result = await worker.recognize(file);
    await worker.terminate();
    return result.data.text;
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
    const combinedText = extractedTexts.map(t => `SOURCE: ${t.name}\n${this._smartSample(t.text, 4000)}`).join('\n---\n');
    const syllabusHint = this.SYLLABUS_HINTS[examId] || '';
    const prompt = `You are an AI specialized in exam preparation for ${examId}.
    ${syllabusHint ? `Use these official syllabus units to categorize topics: ${syllabusHint}` : ''}
    Extract structured questions and topics from the text.

    For each question, include:
    - "text": The question content.
    - "options": An array of 4 multiple-choice options.
    - "answer": The correct option (A, B, C, or D).
    - "topic": The specific topic name (align with official syllabus units when possible).
    - "difficulty": easy, medium, or hard.
    - "explanation": A brief explanation of the answer.

    For each topic, include:
    - "name": The topic name (use official syllabus unit names when applicable).
    - "frequency": Estimated importance (0-100).
    - "priority": high, med, or low.

    Return ONLY a JSON object: { "questions": [...], "topics": [...] }`;

    const response = await this.groqCall(prompt);
    const result = this.parseJSON(response);
    const questions = Array.isArray(result.questions) ? result.questions : [];
    const topics = Array.isArray(result.topics) ? result.topics : [];

    // Tag each item with the exam ID (but do NOT save to DB yet)
    questions.forEach(q => { q.exam = examId; });
    topics.forEach(t => {
      t.id = `${examId}_${t.name}`;
      t.exam = examId;
      t.mastery = 0;
    });

    return { questions, topics };
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
