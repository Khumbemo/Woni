/**
 * Woni — shared utilities  (js/woni.js)
 * Loaded by both npsc.html and csir.html
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

/* ── API key ─────────────────────────────────────────────────────────── */
function getKey() { return localStorage.getItem('woni_groq_key') || ''; }

/* ── PDF text extraction (pdf.js) ────────────────────────────────────── */
async function extractPDFText(file) {
  try {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 80);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map(i => i.str).join(' ') + '\n';
    }
    return text.trim() || `[No text extracted from ${file.name}]`;
  } catch (e) {
    return `[PDF error: ${e.message}]`;
  }
}

async function extractFileText(file) {
  if (file.name.toLowerCase().endsWith('.txt')) return await file.text();
  return extractPDFText(file);
}

/* ── Groq API call ───────────────────────────────────────────────────── */
async function groqCall(prompt, maxTokens = 2000) {
  const key = getKey();
  if (!key) throw new Error('No API key — save your Groq key on the home page first.');

  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 401) throw new Error('Invalid API key. Check console.groq.com/keys');
    if (resp.status === 429) throw new Error('Rate limit reached. Wait a moment and retry.');
    throw new Error(msg);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

/* ── Parse JSON safely from AI response ─────────────────────────────── */
function parseJSON(raw) {
  let text = raw.replace(/```json|```/g, '').trim();
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s >= 0) text = text.slice(s, e + 1);
  return JSON.parse(text);
}

/* ── Toast ───────────────────────────────────────────────────────────── */
function toast(msg, duration = 2800) {
  let el = document.getElementById('woni-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'woni-toast'; el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

/* ── Loading state helper ────────────────────────────────────────────── */
function setLoading(btn, loading, defaultHTML) {
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="dots"><span>·</span><span>·</span><span>·</span></span>`;
  } else {
    btn.disabled = false;
    btn.innerHTML = defaultHTML;
  }
}

/* ── Render bar chart ────────────────────────────────────────────────── */
function renderBarChart(containerId, items, colorVar = '--accent') {
  const el = document.getElementById(containerId);
  if (!el || !items.length) return;
  const max = Math.max(...items.map(i => i.value));
  el.innerHTML = items.map(item => {
    const w = max > 0 ? Math.round((item.value / max) * 100) : 0;
    return `<div class="bar-row">
      <div class="bar-label" title="${item.label}">${item.label}</div>
      <div class="bar-outer">
        <div class="bar-inner" style="width:${w}%;background:var(${colorVar})">${item.value}</div>
      </div>
      <div class="bar-num">${item.value}</div>
    </div>`;
  }).join('');
}

/* ── Render topic grid ───────────────────────────────────────────────── */
function renderTopicGrid(containerId, topics, onClickTopic) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!topics.length) {
    el.innerHTML = `<div class="empty-state">
      <p>No topics to display. Try adjusting the filter.</p>
    </div>`;
    return;
  }
  el.innerHTML = topics.map((t, i) => `
    <div class="topic-card priority-${t.priority}" onclick="${onClickTopic}(${i})" style="cursor:pointer">
      <div class="tc-header">
        <div class="tc-rank">#${i + 1}</div>
        <div>
          <div class="tc-name">${escHtml(t.name)}</div>
          <div class="tc-freq">score ${t.frequency}/100</div>
        </div>
      </div>
      <div class="tc-bar-wrap">
        <div class="tc-bar" style="width:${t.frequency}%"></div>
      </div>
      ${t.subtopics?.length
        ? `<div class="tc-subtopics">• ${t.subtopics.slice(0, 3).map(escHtml).join(' &nbsp;•&nbsp; ')}</div>`
        : ''}
      ${t.years?.length
        ? `<div class="tc-years">${t.years.map(y => `<span class="tc-year">${y}</span>`).join('')}</div>`
        : ''}
    </div>`).join('');
}

/* ── PDF export (jsPDF) ──────────────────────────────────────────────── */
function exportNotesPDF(title, exam, htmlContent) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const tmp = document.createElement('div');
  tmp.innerHTML = htmlContent;
  const plain = tmp.innerText || tmp.textContent || '';

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20); doc.setTextColor(15, 15, 20);
  doc.text('Woni Study Notes', 20, 24);

  doc.setFontSize(12); doc.setTextColor(60, 60, 80);
  doc.text(`${exam} — ${title}`, 20, 34);

  doc.setFontSize(8); doc.setTextColor(130, 130, 160);
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN')} · woni.app`, 20, 42);

  doc.setDrawColor(249, 115, 22); doc.setLineWidth(0.6);
  doc.line(20, 46, 190, 46);

  // Body
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10); doc.setTextColor(25, 25, 40);
  const lines = doc.splitTextToSize(plain, 170);
  let y = 56;
  for (const line of lines) {
    if (y > 278) { doc.addPage(); y = 20; }
    const isBold = /^[A-Z#\*]/.test(line.trim()) && line.trim().length < 80;
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.text(line, 20, y);
    y += 5.5;
  }

  const safe = title.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 40);
  doc.save(`Woni_${exam}_${safe}.pdf`);
  toast('PDF saved!');
}

function exportReportPDF(examName, topics) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22); doc.setTextColor(15, 15, 20);
  doc.text('Woni — Topic Frequency Report', 20, 26);
  doc.setFontSize(12); doc.setTextColor(60, 60, 80);
  doc.text(examName, 20, 36);
  doc.setFontSize(8); doc.setTextColor(130, 130, 160);
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN')}`, 20, 44);
  doc.setDrawColor(249, 115, 22); doc.setLineWidth(0.7); doc.line(20, 48, 190, 48);

  const priorities = ['high', 'med', 'low'];
  const labels = { high: 'HIGH PRIORITY', med: 'MEDIUM PRIORITY', low: 'LOW PRIORITY' };
  const colors = { high: [249,115,22], med: [245,158,11], low: [100,100,120] };

  let y = 58;
  for (const p of priorities) {
    const group = topics.filter(t => t.priority === p);
    if (!group.length) continue;
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(...colors[p]); doc.text(labels[p], 20, y); y += 9;

    for (const t of group) {
      if (y > 274) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20, 20, 40);
      doc.text(`• ${t.name}  (${t.frequency}/100)`, 24, y); y += 6;
      if (t.subtopics?.length) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80, 80, 110);
        const sub = doc.splitTextToSize('  ' + t.subtopics.join(', '), 160);
        doc.text(sub, 28, y); y += sub.length * 5;
      }
      y += 2;
    }
    y += 4;
  }

  doc.save(`Woni_${examName.replace(/\s+/g,'_')}_Report.pdf`);
  toast('Report PDF saved!');
}

/* ── Helpers ─────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  const view = document.getElementById('view-' + id);
  const nav  = document.getElementById('nav-' + id);
  if (view) view.classList.add('active');
  if (nav)  nav.classList.add('active');
  const titles = { upload:'Upload Papers', topics:'Topic Analysis', notes:'Study Notes' };
  const tb = document.getElementById('topbar-title');
  if (tb) tb.textContent = titles[id] || '';
}
