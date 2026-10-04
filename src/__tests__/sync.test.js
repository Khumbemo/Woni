/**
 * Cloud sync between two simulated devices, using an in-memory stand-in for
 * Firestore and IndexedDB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncMixin } from '../sync.js';
import { dbMixin } from '../db.js';
import { SYNC_STORES } from '../utils.js';

// --- Fakes -----------------------------------------------------------------

function fakeFirestore() {
  const docs = new Map(); // path -> data
  const docRef = path => ({
    path,
    async get() { return { exists: docs.has(path), data: () => structuredClone(docs.get(path)) }; },
    async set(data) { docs.set(path, structuredClone(data)); },
    collection: name => colRef(`${path}/${name}`),
  });
  const colRef = path => {
    const list = () => [...docs].filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
      .map(([, d]) => ({ data: () => structuredClone(d) }));
    return {
      doc: id => docRef(`${path}/${id}`),
      async get() { return { docs: list() }; },
      where(field, op, value) {
        if (op !== '>') throw new Error('fake only supports >');
        return { get: async () => ({ docs: list().filter(d => d.data()[field] > value) }) };
      },
    };
  };
  return {
    docs,
    collection: name => colRef(name),
    batch() {
      const ops = [];
      return { set: (ref, data) => ops.push([ref, data]), commit: async () => { for (const [r, d] of ops) await r.set(d); } };
    },
  };
}

function fakeIdb() {
  const stores = {};
  const store = name => (stores[name] ??= { rows: new Map(), next: 1 });
  return {
    stores,
    async getAll(name) { return [...store(name).rows.values()].map(r => structuredClone(r)); },
    async put(name, data) {
      const s = store(name);
      const rec = structuredClone(data);
      if (rec.id == null) rec.id = s.next++;
      else if (typeof rec.id === 'number') s.next = Math.max(s.next, rec.id + 1);
      s.rows.set(rec.id, rec);
      return rec.id;
    },
    async add(name, data) {
      const s = store(name);
      if (data.id != null && s.rows.has(data.id)) throw new Error('ConstraintError');
      return this.put(name, data);
    },
    async get(name, key) { return structuredClone(store(name).rows.get(key)); },
    async clear(name) { store(name).rows.clear(); },
  };
}

function makeDevice(firestore) {
  const toasts = [];
  return {
    ...dbMixin,
    ...syncMixin,
    state: { db: fakeIdb(), user: { uid: 'u1' }, userExams: [{ id: 'csir_net', name: 'CSIR NET' }], currentView: 'dashboard' },
    getDb: async () => firestore,
    showToast: (m, t) => toasts.push([t, m]),
    showView: () => {},
    syncLibExam: () => {},
    updateActiveExamBadge: () => {},
    toasts,
  };
}

// --- Tests -------------------------------------------------------------------

let storage;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
  });
  vi.stubGlobal('document', { querySelector: () => null });
});

describe('cloud sync', () => {
  it('stores one Firestore document per record', async () => {
    const fs = fakeFirestore();
    const a = makeDevice(fs);
    await a.dbAdd('questions', { exam: 'csir_net', text: 'Q1', options: ['x', 'y'], answer: 'A' });
    await a.dbAdd('questions', { exam: 'csir_net', text: 'Q2', options: ['x', 'y'], answer: 'B' });
    await a.dbPut('topics', { id: 'csir_net_Cell / Molecular', exam: 'csir_net', name: 'Cell / Molecular', mastery: 10 });
    await a.syncWithCloud();

    const paths = [...fs.docs.keys()].sort();
    expect(paths.filter(p => p.startsWith('users/u1/questions/'))).toHaveLength(2);
    expect(paths).toContain('users/u1/topics/topics:csir_net_Cell%20%2F%20Molecular');
    // Device-specific auto-increment ids never reach the cloud.
    for (const p of paths.filter(p => p.includes('/questions/'))) expect(fs.docs.get(p).id).toBeUndefined();
    expect(a.toasts.at(-1)).toEqual(['success', 'Sync complete: 3 uploaded, 0 downloaded.']);
  });

  it('merges two devices without duplicates; newest edit wins', async () => {
    const fs = fakeFirestore();
    const a = makeDevice(fs);
    const b = makeDevice(fs);

    await a.dbAdd('questions', { exam: 'csir_net', text: 'Q1', options: ['x', 'y'], answer: 'A' });
    await a.syncWithCloud();

    // Device B has its own local question with the same auto-increment key (1).
    await b.dbAdd('questions', { exam: 'csir_net', text: 'B-only', options: ['x', 'y'], answer: 'A' });
    storage.clear(); // B is a different device: its own lastSync
    await b.syncWithCloud();
    const bTexts = (await b.dbGetAll('questions')).map(q => q.text).sort();
    expect(bTexts).toEqual(['B-only', 'Q1']);

    // B edits Q1 later; A picks the edit up.
    await new Promise(r => setTimeout(r, 5));
    const q1 = (await b.dbGetAll('questions')).find(q => q.text === 'Q1');
    q1.answer = 'B';
    await b.dbPut('questions', q1);
    await b.syncWithCloud();

    storage.clear();
    await a.syncWithCloud();
    const aQs = await a.dbGetAll('questions');
    expect(aQs.map(q => q.text).sort()).toEqual(['B-only', 'Q1']);
    expect(aQs.find(q => q.text === 'Q1').answer).toBe('B');
    expect(fs.docs.size).toBe(1 + 2); // profile doc + 2 questions
  });

  it('restores the old single-document backup into an empty device once', async () => {
    const fs = fakeFirestore();
    await fs.collection('users').doc('u1').set({
      userExams: [{ id: 'gate_ls', name: 'GATE' }],
      questions: [{ id: 7, exam: 'gate_ls', text: 'Legacy Q', options: ['a', 'b'], answer: 'A' }],
      updatedAt: 123,
    });
    const a = makeDevice(fs);
    a.state.userExams = [];
    await a.syncWithCloud();

    expect((await a.dbGetAll('questions')).map(q => q.text)).toEqual(['Legacy Q']);
    expect(a.state.userExams).toEqual([{ id: 'gate_ls', name: 'GATE' }]);
    const profile = fs.docs.get('users/u1');
    expect(profile.questions).toBeUndefined(); // large legacy arrays removed
    expect(Object.keys(SYNC_STORES).some(s => Array.isArray(profile[s]))).toBe(false);
  });
});
