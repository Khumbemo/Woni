/**
 * Woni — Claude Artifact adapter.
 *
 * Loaded only in the Artifact preview build (see artifact/build.mjs). The
 * Artifact viewer blocks network requests to other hosts and native dialogs,
 * so this swaps in:
 *   - AI calls (Groq) -> Claude via the `sample` capability
 *   - file exports    -> the viewer's save prompt via `downloads`
 *   - confirm()       -> an in-page dialog
 *   - external links  -> real <a target="_blank"> links
 * and adds a banner with a "sample questions" loader for quick testing.
 */
const app = window.app;
const use = name => (window.claude?.use ? window.claude.use(name) : Promise.resolve(null));
const samplePromise = use('sample');
const downloadsPromise = use('downloads');

// --- AI via Claude -------------------------------------------------------

const SAMPLE_ERRORS = {
  not_granted: 'Claude access was declined for this page. Reload the page to be asked again.',
  sampling_disabled: 'Claude is not available for this account.',
  rate_limited: 'Too many AI requests right now. Wait a minute and try again.',
  session_expired: 'Your Claude session expired. Sign in to Claude again.',
  prompt_too_large: 'That file is too long to analyze at once. Try a shorter one.',
  refused: 'Claude declined this request. Try different content.',
};

async function askClaude(input, opts = {}) {
  const sample = await samplePromise;
  if (!sample) throw new Error('AI is unavailable in this view. Open the page inside Claude to use it.');
  try {
    const { text } = await sample(input, opts);
    return text.trim();
  } catch (e) {
    throw new Error(SAMPLE_ERRORS[e?.code] || `AI request failed (${e?.code || 'error'}). Try again.`);
  }
}

app.groqCall = prompt =>
  askClaude(`${prompt}\n\nReply with only the JSON object, no other text.`);

app.groqTextCall = prompt => askClaude(prompt, { cache: false });

app.groqTutorCall = (systemPrompt, messages) =>
  askClaude([{ role: 'user', content: systemPrompt }, ...messages.slice(-10)], { cache: false });

// Claude usage is billed to the viewer, so the Groq freemium counter doesn't apply.
app.getFreemiumCount = () => 0;
app.incrementFreemium = () => {};
app.updateSettingsUI = () => {
  const info = document.getElementById('api-key-info');
  if (info) info.textContent = 'In this preview, AI features run on Claude. No API key needed.';
};

// --- Downloads -----------------------------------------------------------

app.saveFile = async (filename, blob) => {
  const downloads = await downloadsPromise;
  if (!downloads) {
    app.showToast('Saving files is not available in this view.', 'error');
    return;
  }
  try {
    await downloads.save({ filename, data: blob });
    app.showToast(`Saved ${filename}`, 'success');
  } catch (e) {
    if (e?.code !== 'declined') app.showToast(`Could not save ${filename} (${e?.code || 'error'}).`, 'error');
  }
};

// --- Links ---------------------------------------------------------------

app.openExternal = url => {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// --- In-page confirm dialog ---------------------------------------------

const style = document.createElement('style');
style.textContent = `
  .wa-banner { position: fixed; top: env(safe-area-inset-top, 0px); left: 0; right: 0; z-index: 10000;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 16px;
    background: var(--surface2); border-bottom: 1px solid var(--border); color: var(--text);
    font: 13px/1.4 var(--sans); }
  .wa-banner p { margin: 0; flex: 1 1 240px; min-width: 0; color: var(--muted); }
  .wa-banner strong { color: var(--accent); font-weight: 600; }
  .wa-btn { font: 600 13px var(--sans); padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--border); background: var(--surface); color: var(--text); }
  .wa-btn:hover { border-color: var(--border-hover); }
  .wa-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .wa-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .wa-btn.danger { background: var(--red); border-color: var(--red); color: #fff; }
  .wa-dialog-back { position: fixed; inset: 0; z-index: 10001; display: grid; place-items: center;
    padding: 16px; background: rgba(0,0,0,.55); }
  .wa-dialog { width: min(100%, 380px); padding: 20px; border-radius: 14px; background: var(--surface);
    border: 1px solid var(--border); color: var(--text); font: 15px/1.5 var(--sans);
    display: grid; gap: 16px; }
  .wa-dialog p { margin: 0; }
  .wa-dialog .wa-actions { display: flex; justify-content: flex-end; gap: 8px; }
`;
document.head.appendChild(style);

app.confirmAction = message => new Promise(resolve => {
  const back = document.createElement('div');
  back.className = 'wa-dialog-back';
  back.innerHTML = `
    <div class="wa-dialog" role="alertdialog" aria-modal="true" aria-labelledby="wa-dialog-msg">
      <p id="wa-dialog-msg"></p>
      <div class="wa-actions">
        <button class="wa-btn" id="wa-dialog-cancel">Cancel</button>
        <button class="wa-btn ${/DANGER|delete/i.test(message) ? 'danger' : 'primary'}" id="wa-dialog-ok">Continue</button>
      </div>
    </div>`;
  back.querySelector('#wa-dialog-msg').textContent = message;
  const close = ok => { back.remove(); resolve(ok); };
  back.querySelector('#wa-dialog-cancel').onclick = () => close(false);
  back.querySelector('#wa-dialog-ok').onclick = () => close(true);
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(false); });
  document.body.appendChild(back);
  back.querySelector('#wa-dialog-ok').focus();
});

// --- Sample questions ----------------------------------------------------

const SAMPLE_QUESTIONS = [
  { topic: 'Molecular Biology', difficulty: 'easy', text: 'Which enzyme unwinds the DNA double helix at the replication fork?',
    options: ['Primase', 'DNA ligase', 'Helicase', 'Topoisomerase I'], answer: 'C',
    explanation: 'Helicase breaks the hydrogen bonds between base pairs to separate the two strands; topoisomerases relieve the supercoiling this creates ahead of the fork.' },
  { topic: 'Biochemistry', difficulty: 'easy', text: 'The Michaelis constant (Km) is the substrate concentration at which the reaction velocity equals:',
    options: ['Vmax', 'Twice Vmax', 'Zero', 'Half of Vmax'], answer: 'D',
    explanation: 'From the Michaelis–Menten equation v = Vmax[S]/(Km + [S]), setting [S] = Km gives v = Vmax/2.' },
  { topic: 'Molecular Biology', difficulty: 'easy', text: 'Which of the following codons is a stop codon?',
    options: ['UAA', 'AUG', 'GCU', 'UUU'], answer: 'A',
    explanation: 'UAA, UAG and UGA are the three stop codons. AUG codes for methionine and is the usual start codon.' },
  { topic: 'Plant Physiology', difficulty: 'medium', text: 'In the Calvin cycle of C3 plants, CO2 is first fixed by which enzyme?',
    options: ['PEP carboxylase', 'Carbonic anhydrase', 'RuBisCO', 'ATP synthase'], answer: 'C',
    explanation: 'RuBisCO carboxylates ribulose-1,5-bisphosphate to give two molecules of 3-phosphoglycerate. PEP carboxylase does the initial fixation in C4 and CAM plants.' },
  { topic: 'Genetics', difficulty: 'medium', text: 'In a population in Hardy–Weinberg equilibrium, the recessive allele frequency q is 0.3. What is the expected frequency of heterozygotes?',
    options: ['0.09', '0.42', '0.21', '0.49'], answer: 'B',
    explanation: 'p = 1 − 0.3 = 0.7, so heterozygote frequency = 2pq = 2 × 0.7 × 0.3 = 0.42.' },
  { topic: 'Immunology', difficulty: 'easy', text: 'Which antibody class crosses the human placenta?',
    options: ['IgG', 'IgA', 'IgM', 'IgE'], answer: 'A',
    explanation: 'IgG is transported across the placenta by the neonatal Fc receptor (FcRn), giving the fetus passive immunity.' },
  { topic: 'Biochemistry', difficulty: 'easy', text: 'What is the net ATP yield of glycolysis per molecule of glucose?',
    options: ['4', '36', '1', '2'], answer: 'D',
    explanation: 'Glycolysis makes 4 ATP by substrate-level phosphorylation but uses 2 in the preparatory phase, for a net gain of 2 ATP (plus 2 NADH).' },
  { topic: 'Cell Biology', difficulty: 'easy', text: 'In eukaryotic cells, oxidative phosphorylation takes place in the:',
    options: ['Golgi apparatus', 'Lysosome', 'Mitochondrion', 'Nucleus'], answer: 'C',
    explanation: 'The electron transport chain and ATP synthase sit in the inner mitochondrial membrane.' },
];

async function addSampleQuestions() {
  if (!app.state.db) return;
  const exams = app.state.userExams.length ? app.state.userExams : [{ id: 'csir_net', name: 'CSIR NET' }];
  let added = 0;
  for (const { id: exam } of exams) {
    const existing = new Set((await app.dbGetFromIndex('questions', 'exam', exam)).map(q => q.text));
    for (const q of SAMPLE_QUESTIONS) {
      if (existing.has(q.text)) continue;
      await app.dbAdd('questions', { ...q, exam, confidence: 0.9 });
      await app.dbAdd('flashcards', {
        questionId: null, front: q.text,
        back: `Answer: ${q.answer}) ${q.options[q.answer.charCodeAt(0) - 65]}\n\nExplanation: ${q.explanation}`,
        topic: q.topic, nextReview: Date.now(), interval: 0, repetition: 0, ease: 2.5,
      });
      added++;
    }
    const topics = [...new Set(SAMPLE_QUESTIONS.map(q => q.topic))];
    for (const name of topics) {
      const id = `${exam}_${name}`;
      if (!(await app.dbGet('topics', id))) {
        const count = SAMPLE_QUESTIONS.filter(q => q.topic === name).length;
        const frequency = Math.round((count / SAMPLE_QUESTIONS.length) * 100);
        await app.dbPut('topics', { id, exam, name, frequency, priority: frequency >= 20 ? 'high' : 'med', mastery: 0 });
      }
    }
  }
  app.showToast(added ? `Added ${added} sample questions and flashcards. Open Practice to try them.` : 'Sample questions are already loaded.', 'success');
  if (app.state.currentView) app.showView(app.state.currentView);
}

// --- Banner ---------------------------------------------------------------

const banner = document.createElement('div');
banner.className = 'wa-banner';
banner.setAttribute('role', 'region');
banner.setAttribute('aria-label', 'Preview notes');
banner.innerHTML = `
  <p><strong>Preview build.</strong> AI features run on Claude (it asks your permission first).
  Sign-in, cloud sync and image OCR need the network, so they are off here. Data stays in this browser.</p>
  <button class="wa-btn primary" id="wa-sample-btn">Add sample questions</button>
  <button class="wa-btn" id="wa-hide-btn" aria-label="Hide preview notes">Hide</button>`;
document.body.appendChild(banner);
const pad = () => { document.body.style.paddingTop = banner.isConnected ? `${banner.offsetHeight}px` : ''; };
new ResizeObserver(pad).observe(banner);
banner.querySelector('#wa-sample-btn').onclick = addSampleQuestions;
banner.querySelector('#wa-hide-btn').onclick = () => { banner.remove(); pad(); };
