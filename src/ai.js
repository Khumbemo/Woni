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

  async performAIAnalysis(examId, extractedTexts) {
    const combinedText = extractedTexts.map(t => `SOURCE: ${t.name}\n${t.text.slice(0, 4000)}`).join('\n---\n');
    const prompt = `You are an AI specialized in exam preparation for ${examId}.
    Extract structured questions and topics from the text.

    For each question, include:
    - "text": The question content.
    - "options": An array of 4 multiple-choice options.
    - "answer": The correct option (A, B, C, or D).
    - "topic": The specific topic name.
    - "difficulty": easy, medium, or hard.
    - "explanation": A brief explanation of the answer.

    For each topic, include:
    - "name": The topic name.
    - "frequency": Estimated importance (0-100).
    - "priority": high, med, or low.

    Return ONLY a JSON object: { "questions": [...], "topics": [...] }`;

    const response = await this.groqCall(prompt);
    const result = this.parseJSON(response);
    let questions = Array.isArray(result.questions) ? result.questions : [];
    let topics = Array.isArray(result.topics) ? result.topics : [];

    if (result.questions) {
      for (const q of result.questions) {
        q.exam = examId;
        await this.dbAdd('questions', q);
        await this.dbAdd('flashcards', {
          questionId: null,
          front: q.text || q.question || "Empty Question",
          back: `Answer: ${q.answer}\n\nExplanation: ${q.explanation}`,
          topic: q.topic,
          nextReview: Date.now(),
          interval: 0,
          repetition: 0,
          ease: 2.5
        });
      }
    }
    if (result.topics) {
      for (const t of result.topics) {
        t.id = `${examId}_${t.name}`;
        t.exam = examId;
        t.mastery = 0;
        await this.dbPut('topics', t);
      }
    }
    return { questions, topics };
  },

  getProxyUrl() {
    return 'https://woni-ai-proxy.khumbemo.workers.dev/chat'; // Placeholder URL
  },

  incrementFreemium() {
    if (this.state.apiKey) return;
    const count = parseInt(localStorage.getItem('woni_freemium_count') || '0', 10);
    localStorage.setItem('woni_freemium_count', (count + 1).toString());
    
    // Update setting UI if visible
    this.updateSettingsUI();
  },

  updateSettingsUI() {
    // A helper to show freemium status in settings
    const info = document.getElementById('api-key-info');
    if (info && !this.state.apiKey) {
       const count = parseInt(localStorage.getItem('woni_freemium_count') || '0', 10);
       info.textContent = `Freemium Analyses Used: ${count}/5`;
    }
  },

  async groqCall(prompt) {
    const useProxy = !this.state.apiKey;
    const url = useProxy ? this.getProxyUrl() : 'https://api.groq.com/openai/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${this.state.apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" } }),
    });
    
    if (!resp.ok) throw new Error(useProxy ? "Proxy Error: Make sure your worker is deployed." : `Groq API Error: ${resp.status}`);
    const data = await resp.json();
    this.incrementFreemium();
    return data.choices[0].message.content;
  },

  async groqTextCall(prompt) {
    const useProxy = !this.state.apiKey;
    const url = useProxy ? this.getProxyUrl() : 'https://api.groq.com/openai/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${this.state.apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }] }),
    });
    
    if (!resp.ok) throw new Error(useProxy ? "Proxy Error: Make sure your worker is deployed." : `Groq API Error: ${resp.status}`);
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
  }
};
