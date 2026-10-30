/**
 * Cloud sync between simulated devices, using in-memory stand-ins for the
 * modular Firestore/Storage APIs and IndexedDB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncMixin, validateBackup, bookBytes } from '../sync.js';
import { dbMixin } from '../db.js';
import { SYNC_STORES } from '../utils.js';

// --- Fakes -----------------------------------------------------------------

const SERVER_TS = { __serverTimestamp: true };

function fakeFirestore() {
  const docs = new Map(); // path -> data
  const db = { kind: 'db' };
  const join = (parent, segs) => (parent === db ? '' : parent.path + '/') + segs.join('/');
  const store = data => {
    const copy = structuredClone(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === SERVER_TS ? { __ts: Date.now() } : v])));
    return copy;
  };
  const hydrate = data => data && Object.fromEntries(Object.entries(structuredClone(data))
    .map(([k, v]) => [k, v && typeof v === 'object' && '__ts' in v ? { toMillis: () => v.__ts } : v]));
  const list = path => [...docs].filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
    .map(([, d]) => ({ data: () => hydrate(d) }));
  return {
    db, docs,
    doc: (parent, ...segs) => ({ kind: 'doc', path: join(parent, segs) }),
    collection: (parent, ...segs) => ({ kind: 'col', path: join(parent, segs) }),
    getDoc: async ref => ({ exists: () => docs.has(ref.path), data: () => hydrate(docs.get(ref.path)) }),
    setDoc: async (ref, data) => { docs.set(ref.path, store(data)); },
    getDocs: async q => ({ docs: q.kind === 'query' ? list(q.col.path).filter(d => q.test(d.data())) : list(q.path) }),
    query: (col, test) => ({ kind: 'query', col, test }),
    where: (field, op, value) => {
      if (op !== '>') throw new Error('fake only supports >');
      return d => d[field] > value;
    },
    writeBatch: () => {
      const ops = [];
      return { set: (ref, data) => ops.push([ref, data]), commit: async () => { for (const [r, d] of ops) docs.set(r.path, store(d)); } };
    },
    serverTimestamp: () => SERVER_TS,
  };
}

function fakeStorage() {
  const files = new Map();
  return {
    files,
    storage: {},
    ref: (_s, path) => ({ path }),
    uploadBytes: async (ref, bytes) => { files.set(ref.path, new Uint8Array(bytes).slice()); },
    getBytes: async ref => {
      if (!files.has(ref.path)) throw new Error('storage/object-not-found');
      return files.get(ref.path).slice().buffer;
    },
    deleteObject: async ref => { files.delete(ref.path); },
  };
}

function fakeIdb() {
  const stores = {};
  const keyPath = name => (name === 'chat_history' ? 'exam' : 'id');
  const store = name => (stores[name] ??= { rows: new Map(), next: 1 });
  return {
    stores,
    async getAll(name) { return [...store(name).rows.values()].map(r => structuredClone(r)); },
    async put(name, data) {
      const s = store(name);
      const rec = structuredClone(data);
      const kp = keyPath(name);
      if (rec[kp] == null) rec[kp] = s.next++;
      else if (typeof rec[kp] === 'number') s.next = Math.max(s.next, rec[kp] + 1);
      s.rows.set(rec[kp], rec);
      return rec[kp];
    },
    async add(name, data) {
      const kp = keyPath(name);
      if (data[kp] != null && store(name).rows.has(data[kp])) throw new Error('ConstraintError');
      return this.put(name, data);
    },
    async get(name, key) { return structuredClone(store(name).rows.get(key)); },
    async clear(name) { store(name).rows.clear(); },
    async delete(name, key) { store(name).rows.delete(key); },
    transaction() {
      const self = this;
      return {
        objectStore: name => ({ clear: () => self.clear(name), put: data => self.put(name, data) }),
        done: Promise.resolve(),
      };
    },
  };
}

/** A device with its own IndexedDB, localStorage and (optionally wrong) clock. */
function makeDevice(fs, st, clockOffsetMs = 0) {
  const toasts = [];
  const local = new Map();
  return {
    ...dbMixin,
    ...syncMixin,
    now: () => Date.now() + clockOffsetMs,
    state: { db: fakeIdb(), user: { uid: 'u1' }, userExams: [{ id: 'csir_net', name: 'CSIR NET' }], currentView: 'dashboard' },
    getDb: async () => fs,
    getStorage: async () => st,
    confirmAction: async () => true,
    showToast: (m, t) => toasts.push([t, m]),
    showView: () => {},
    syncLibExam: () => {},
    updateActiveExamBadge: () => {},
    saveFile: () => {},
    toasts,
    localStore: local,
  };
}

/** Run `fn` with `device`'s own localStorage (each device keeps its own). */
async function on(device, fn) {
  vi.stubGlobal('localStorage', {
    getItem: k => (device.localStore.has(k) ? device.localStore.get(k) : null),
    setItem: (k, v) => device.localStore.set(k, String(v)),
    removeItem: k => device.localStore.delete(k),
  });
  return fn();
}

const tick = () => new Promise(r => setTimeout(r, 5));
const Q = (text, extra = {}) => ({ exam: 'csir_net', text, options: ['x', 'y'], answer: 'A', ...extra });

beforeEach(() => {
  vi.stubGlobal('document', { querySelector: () => null });
});

// --- Tests -------------------------------------------------------------------

describe('cloud sync', () => {
  it('stores one Firestore document per record, without device-specific ids', async () => {
    const fs = fakeFirestore();
    const a = makeDevice(fs, fakeStorage());
    await on(a, async () => {
      await a.dbAdd('questions', Q('Q1'));
      await a.dbAdd('questions', Q('Q2'));
      await a.dbPut('topics', { id: 'csir_net_Cell / Molecular', exam: 'csir_net', name: 'Cell / Molecular', mastery: 10 });
      await a.syncWithCloud();
    });
    const paths = [...fs.docs.keys()].sort();
    expect(paths.filter(p => p.startsWith('users/u1/questions/'))).toHaveLength(2);
    expect(paths).toContain('users/u1/topics/topics:csir_net_Cell%20%2F%20Molecular');
    for (const p of paths.filter(p => p.includes('/questions/'))) expect(fs.docs.get(p).id).toBeUndefined();
    expect(a.toasts.at(-1)).toEqual(['success', 'Sync complete: 3 uploaded, 0 downloaded.']);
  });

  it('merges two devices without duplicates; newest edit wins', async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const a = makeDevice(fs, st);
    const b = makeDevice(fs, st);
    await on(a, async () => { await a.dbAdd('questions', Q('Q1')); await a.syncWithCloud(); });
    await on(b, async () => {
      await b.dbAdd('questions', Q('B-only')); // same local auto-increment key (1) as A's Q1
      await b.syncWithCloud();
      expect((await b.dbGetAll('questions')).map(q => q.text).sort()).toEqual(['B-only', 'Q1']);
      await tick();
      const q1 = (await b.dbGetAll('questions')).find(q => q.text === 'Q1');
      q1.answer = 'B';
      await b.dbPut('questions', q1);
      await b.syncWithCloud();
    });
    await on(a, async () => {
      await a.syncWithCloud();
      const qs = await a.dbGetAll('questions');
      expect(qs.map(q => q.text).sort()).toEqual(['B-only', 'Q1']);
      expect(qs.find(q => q.text === 'Q1').answer).toBe('B');
    });
    expect([...fs.docs.keys()].filter(p => p.includes('/questions/'))).toHaveLength(2);
  });

  it("a device whose clock is hours ahead doesn't win conflicts it shouldn't", async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const fast = makeDevice(fs, st, 2 * 60 * 60 * 1000); // clock 2 hours ahead
    const right = makeDevice(fs, st);
    await on(fast, async () => { await fast.dbAdd('questions', Q('Q1', { answer: 'A' })); await fast.syncWithCloud(); });
    await tick();
    // The correct-clock device edits it later in real time.
    await on(right, async () => {
      await right.syncWithCloud();
      const q = (await right.dbGetAll('questions'))[0];
      q.answer = 'B';
      await right.dbPut('questions', q);
      await right.syncWithCloud();
      expect((await right.dbGetAll('questions'))[0].answer).toBe('B');
    });
    await on(fast, async () => {
      await fast.syncWithCloud();
      expect((await fast.dbGetAll('questions'))[0].answer).toBe('B');
      expect(fast.toasts.at(-1)[1]).toMatch(/clock is 120 min ahead; adjusted automatically/);
    });
  });

  it('restores the old single-document backup into an empty device once', async () => {
    const fs = fakeFirestore();
    await fs.setDoc(fs.doc(fs.db, 'users', 'u1'), {
      userExams: [{ id: 'gate_ls', name: 'GATE' }],
      questions: [{ id: 7, exam: 'gate_ls', text: 'Legacy Q', options: ['a', 'b'], answer: 'A' }],
      updatedAt: 123,
    });
    const a = makeDevice(fs, fakeStorage());
    a.state.userExams = [];
    await on(a, () => a.syncWithCloud());
    await on(a, async () => expect((await a.dbGetAll('questions')).map(q => q.text)).toEqual(['Legacy Q']));
    expect(a.state.userExams).toEqual([{ id: 'gate_ls', name: 'GATE' }]);
    const profile = fs.docs.get('users/u1');
    expect(Object.keys(SYNC_STORES).some(s => Array.isArray(profile[s]))).toBe(false);
  });

  it('syncs Study Assistant chats (one per exam)', async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const a = makeDevice(fs, st);
    const b = makeDevice(fs, st);
    await on(a, async () => {
      await a.dbPut('chat_history', { exam: 'csir_net', messages: [{ role: 'user', content: 'What is ATP?' }] });
      await a.syncWithCloud();
    });
    await on(b, async () => {
      await b.syncWithCloud();
      expect((await b.dbGet('chat_history', 'csir_net')).messages[0].content).toBe('What is ATP?');
    });
  });

  it('syncs library books through Cloud Storage, and deleting one removes the file', async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const a = makeDevice(fs, st);
    const b = makeDevice(fs, st);
    const bytes = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
    await on(a, async () => {
      await a.dbAdd('library', { name: 'notes.pdf', exam: 'csir_net', subject: 'Genetics', type: 'application/pdf', data: bytes.buffer.slice(0) });
      await a.syncWithCloud();
    });
    const docPath = [...fs.docs.keys()].find(p => p.startsWith('users/u1/library/'));
    expect(fs.docs.get(docPath).data).toBeUndefined(); // metadata only in Firestore
    expect(st.files.size).toBe(1);

    await on(b, async () => {
      await b.syncWithCloud();
      const [book] = await b.dbGetAll('library');
      expect(book.name).toBe('notes.pdf');
      expect([...new Uint8Array(book.data)]).toEqual([...bytes]);
      await tick();
      await b.dbDelete('library', book.id);
      await b.syncWithCloud();
    });
    expect(st.files.size).toBe(0);
    await on(a, async () => {
      await a.syncWithCloud();
      expect(await a.dbGetAll('library')).toEqual([]);
    });
  });
});

describe('library edge cases', () => {
  it('reads book bytes in every stored format', () => {
    expect([...bookBytes(new Uint8Array([1, 2]).buffer)]).toEqual([1, 2]);
    expect([...bookBytes(new Uint8Array([9, 1, 2, 9]).subarray(1, 3))]).toEqual([1, 2]);
    expect([...bookBytes('data:application/pdf;base64,AQI=')]).toEqual([1, 2]);
    expect(bookBytes(undefined).byteLength).toBe(0);
    expect(bookBytes('data:,%%%not base64').byteLength).toBe(0);
  });

  it('uploads an old data-URL book as real bytes', async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const a = makeDevice(fs, st);
    await on(a, async () => {
      await a.dbAdd('library', { name: 'old.pdf', exam: 'csir_net', subject: 'S', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERg==' });
      await a.syncWithCloud();
    });
    expect([...[...st.files.values()][0]]).toEqual([37, 80, 68, 70]);
  });

  it('keeps going when a cloud file is missing, and retries it next sync', async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const a = makeDevice(fs, st);
    await on(a, async () => {
      await a.dbAdd('library', { name: 'b.pdf', exam: 'csir_net', subject: 'S', type: 'application/pdf', data: new Uint8Array([1]).buffer });
      await a.dbAdd('questions', Q('Q1'));
      await a.syncWithCloud();
    });
    const saved = new Map(st.files);
    st.files.clear();
    const b = makeDevice(fs, st);
    await on(b, async () => {
      await b.syncWithCloud();
      expect((await b.dbGetAll('questions')).map(q => q.text)).toEqual(['Q1']);
      expect(await b.dbGetAll('library')).toEqual([]);
      expect(b.toasts.at(-1)[1]).toMatch(/1 library file could not be downloaded/);
      for (const [k, v] of saved) st.files.set(k, v);
      await b.syncWithCloud();
      expect((await b.dbGetAll('library')).map(x => x.name)).toEqual(['b.pdf']);
    });
  });
});

describe('deletions', () => {
  it('a deletion on one device removes the record on the other', async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const a = makeDevice(fs, st);
    const b = makeDevice(fs, st);
    await on(a, async () => {
      await a.dbAdd('questions', Q('Keep'));
      await a.dbAdd('questions', Q('Remove'));
      await a.syncWithCloud();
    });
    await on(b, async () => {
      await b.syncWithCloud();
      expect((await b.dbGetAll('questions')).map(q => q.text).sort()).toEqual(['Keep', 'Remove']);
    });
    await tick(); // the deletion happens after the record was created
    await on(a, async () => {
      const victim = (await a.dbGetAll('questions')).find(q => q.text === 'Remove');
      await a.dbDelete('questions', victim.id); // records a tombstone
      await a.syncWithCloud();
      expect(JSON.parse(a.localStore.get('woni_tombstones')).questions).toEqual({});
    });
    await on(b, async () => {
      await b.syncWithCloud();
      expect((await b.dbGetAll('questions')).map(q => q.text)).toEqual(['Keep']);
    });
  });

  it('importing a backup replaces cloud data instead of being undone by the next sync', async () => {
    const fs = fakeFirestore();
    const st = fakeStorage();
    const a = makeDevice(fs, st);
    await on(a, async () => {
      await a.dbAdd('questions', Q('Old'));
      await a.syncWithCloud();
      const backup = { questions: [Q('From backup')] };
      vi.stubGlobal('location', { reload: () => {} });
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      await a.importData({ target: { files: [{ text: async () => JSON.stringify(backup) }], value: '' } });
      vi.useRealTimers();
      await a.syncWithCloud();
    });
    const fresh = makeDevice(fs, st);
    await on(fresh, async () => {
      await fresh.syncWithCloud();
      expect((await fresh.dbGetAll('questions')).map(q => q.text)).toEqual(['From backup']);
    });
  });
});

describe('backup files', () => {
  it('export → import round-trips library files and chats', async () => {
    const a = makeDevice(fakeFirestore(), fakeStorage());
    let exported;
    a.saveFile = async (_name, blob) => { exported = await blob.text(); };
    await on(a, async () => {
      await a.dbAdd('questions', Q('Q1'));
      await a.dbPut('chat_history', { exam: 'csir_net', messages: [{ role: 'user', content: 'hi' }] });
      await a.dbAdd('library', { name: 'b.pdf', exam: 'csir_net', subject: 'S', type: 'application/pdf', data: new Uint8Array([1, 2, 255]).buffer });
      await a.exportData();
    });
    const parsed = JSON.parse(exported);
    expect(parsed.version).toBe(2);
    expect(parsed.library[0].data).toBeUndefined();
    expect(typeof parsed.library[0].dataBase64).toBe('string');

    const b = makeDevice(fakeFirestore(), fakeStorage());
    vi.stubGlobal('location', { reload: () => {} });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await on(b, () => b.importData({ target: { files: [{ text: async () => exported }], value: '' } }));
    vi.useRealTimers();
    await on(b, async () => {
      const [book] = await b.dbGetAll('library');
      expect([...new Uint8Array(book.data)]).toEqual([1, 2, 255]);
      expect((await b.dbGet('chat_history', 'csir_net')).messages[0].content).toBe('hi');
      expect((await b.dbGetAll('questions')).map(q => q.text)).toEqual(['Q1']);
    });
  });

  it('rejects files that are not Woni backups before touching any data', () => {
    expect(validateBackup([])).toMatch(/not a Woni backup/);
    expect(validateBackup({ hello: 1 })).toMatch(/not a Woni backup/);
    expect(validateBackup({ questions: 'nope' })).toMatch(/damaged/);
    expect(validateBackup({ questions: [null] })).toMatch(/damaged/);
    expect(validateBackup({ library: [{ name: 'x' }] })).toMatch(/no file/);
    expect(validateBackup({ questions: [], userExams: [] })).toBeNull();
  });
});
