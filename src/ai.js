import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { createWorker } from 'tesseract.js';

// Configure PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export const aiMixin = {
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
    if (info && !this.state.apiKey) {
       const count = this.getFreemiumCount();
       info.textContent = `Freemium Analyses Used: ${count}/5`;
    }
  },

  async groqCall(prompt) {
    const useProxy = !this.state.apiKey;
    const url = useProxy ? this.getProxyUrl() : 'https://api.groq.com/openai/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${this.state.apiKey}`;

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" } }),
      });
    } catch (networkErr) {
      if (useProxy) {
        throw new Error('AI Proxy is currently unavailable. Please add your own free Groq API Key in Settings → API Key.');
      }
      throw new Error('Network error: Could not reach Groq API. Check your internet connection.');
    }
    
    if (!resp.ok) {
      if (useProxy) throw new Error('AI Proxy returned an error. Please add your own free Groq API Key in Settings → API Key.');
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Groq API Error (${resp.status}): ${errBody.slice(0, 120)}`);
    }
    const data = await resp.json();
    this.incrementFreemium();
    return data.choices[0].message.content;
  },

  async groqTextCall(prompt) {
    const useProxy = !this.state.apiKey;
    const url = useProxy ? this.getProxyUrl() : 'https://api.groq.com/openai/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${this.state.apiKey}`;

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }] }),
      });
    } catch (networkErr) {
      if (useProxy) {
        throw new Error('AI Proxy is currently unavailable. Please add your own free Groq API Key in Settings → API Key.');
      }
      throw new Error('Network error: Could not reach Groq API. Check your internet connection.');
    }
    
    if (!resp.ok) {
      if (useProxy) throw new Error('AI Proxy returned an error. Please add your own free Groq API Key in Settings → API Key.');
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Groq API Error (${resp.status}): ${errBody.slice(0, 120)}`);
    }
    const data = await resp.json();
    this.incrementFreemium();
    return (data.choices?.[0]?.message?.content || '').trim();
  },

  parseJSON(raw) {
    try {
      let text = raw.trim();
      // Remove markdown code blocks if present
      if (text.includes('\`\`\`')) {
        const matches = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
        if (matches && matches[1]) {
          text = matches[1];
        } else {
          text = text.replace(/\`\`\`[a-z]*\n/gi, '').replace(/\n\`\`\`/g, '');
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

  /**
   * Subject-guarded conversational AI tutor for the Library Study Assistant.
   * Takes a full message history for multi-turn context.
   * @param {string} systemPrompt - The system instruction with subject constraints
   * @param {Array} messages - Array of { role: 'user'|'assistant', content: string }
   * @returns {string} The AI response text
   */
  async groqTutorCall(systemPrompt, messages) {
    const useProxy = !this.state.apiKey;
    const url = useProxy ? this.getProxyUrl() : 'https://api.groq.com/openai/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${this.state.apiKey}`;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10) // Keep last 10 messages for context window efficiency
    ];

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
    } catch (networkErr) {
      if (useProxy) {
        throw new Error('AI Proxy is currently unavailable. Please add your own free Groq API Key in Settings → API Key.');
      }
      throw new Error('Network error: Could not reach Groq API. Check your internet connection.');
    }

    if (!resp.ok) {
      if (useProxy) throw new Error('AI Proxy returned an error. Please add your own free Groq API Key in Settings → API Key.');
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Groq API Error (${resp.status}): ${errBody.slice(0, 120)}`);
    }
    const data = await resp.json();
    this.incrementFreemium();
    return (data.choices?.[0]?.message?.content || '').trim();
  }
};
