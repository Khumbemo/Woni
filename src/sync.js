/**
 * Woni — Sync & Export Module
 *
 * Cloud sync stores one Firestore document per record under
 * users/{uid}/{store}/{syncId}, so no single document approaches Firestore's
 * 1 MiB limit. Library files go to Cloud Storage (users/{uid}/library/{syncId})
 * and their Firestore document keeps only the metadata.
 *
 * Every local write stamps `syncId` and `updatedAt` (see db.js). A sync
 * uploads local changes since the last sync, downloads cloud changes, and the
 * newer `updatedAt` wins when both sides changed. Deletions travel as
 * tombstones ({ deleted: true }).
 *
 * Clocks: each sync measures this device's offset from Firebase's server
 * clock, and cloud timestamps are kept in server time. A device whose clock
 * is wrong therefore can't win (or lose) conflicts it shouldn't.
 */
import { SYNC_STORES, makeSyncId, planSync, arrayBufferToBase64, base64ToArrayBuffer } from './utils.js';

const BATCH_LIMIT = 400;          // Firestore allows 500 writes per batch
const OVERLAP_MS = 2 * 60000;     // re-check a little overlap so nothing slips between syncs
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const BACKUP_STORES = ['papers', 'questions', 'flashcards', 'progress', 'topics', 'mock_tests', 'chat_history', 'library'];
const TOMBSTONE_KEY = 'woni_tombstones';

/** Returns a reason the object isn't a Woni backup, or null if it looks valid. */
export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'This file is not a Woni backup.';
  const present = BACKUP_STORES.filter(s => s in data);
  if (present.length === 0) return 'This file is not a Woni backup (no study data found).';
  for (const s of present) {
    if (!Array.isArray(data[s])) return `This backup is damaged: "${s}" is not a list.`;
    if (data[s].some(item => !item || typeof item !== 'object' || Array.isArray(item))) return `This backup is damaged: "${s}" contains invalid records.`;
  }
  if ((data.chat_history || []).some(c => typeof c.exam !== 'string')) return 'This backup is damaged: a chat has no exam.';
  if ((data.library || []).some(b => typeof b.dataBase64 !== 'string')) return 'This backup is damaged: a library book has no file.';
  if ('userExams' in data && !Array.isArray(data.userExams)) return 'This backup is damaged: "userExams" is not a list.';
  return null;
}

/** A library book's bytes, whatever format it was stored in (old versions saved data: URLs). */
export function bookBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') {
    const comma = data.indexOf(',');
    try {
      return new Uint8Array(base64ToArrayBuffer(data.startsWith('data:') ? data.slice(comma + 1) : data));
    } catch {
      return new Uint8Array(0);
    }
  }
  return new Uint8Array(0);
}

export const syncMixin = {
  /** This device's clock (overridable in tests). */
  now() {
    return Date.now();
  },

  /** Deleted records not yet uploaded: { store: { syncId: deletedAt } }. */
  _tombstones() {
    try {
      const t = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '{}');
      return t && typeof t === 'object' && !Array.isArray(t) ? t : {};
    } catch {
      return {};
    }
  },

  /** Remember that these records were deleted, so the next sync deletes them everywhere. */
  recordDeletions(store, syncIds) {
    if (!SYNC_STORES[store] || syncIds.length === 0) return;
    const t = this._tombstones();
    t[store] ??= {};
    const now = this.now();
    for (const id of syncIds) t[store][id] = now;
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(t));
  },

  _lastSyncKey() {
    // v2: the value is in server time (see clock note above).
    return `woni_last_sync_v2_${this.state.user.uid}`;
  },

  /** Give records written before sync existed a syncId/updatedAt, without bumping existing ones. */
  async _ensureSyncFields(store) {
    const records = await this.dbGetAll(store);
    for (const r of records) {
      if (r.syncId && r.updatedAt) continue;
      r.syncId ||= makeSyncId(store, r);
      r.updatedAt ||= this.now();
      await this.state.db.put(store, r);
    }
    return records;
  },

  /** Cloud copy of a record: plain JSON, no device-specific keys or file bytes; `skew` converts to server time. */
  _toCloud(store, record, skew) {
    const { data: _bytes, ...rest } = record;
    const copy = JSON.parse(JSON.stringify(SYNC_STORES[store].binary ? rest : record));
    if (SYNC_STORES[store].autoKey) delete copy.id;
    copy.updatedAt = Math.round(record.updatedAt + skew);
    return copy;
  },

  /** Write a downloaded record locally (time converted back to this device's clock). */
  async _applyCloudRecord(store, record, localBySyncId, skew, st, uid) {
    const existing = localBySyncId.get(record.syncId);
    if (record.deleted) {
      // Deleted on another device (or by an import there).
      if (existing) await this.state.db.delete(store, existing.id ?? existing[SYNC_STORES[store].key]);
      return;
    }
    const data = { ...record, updatedAt: Math.round(record.updatedAt - skew) };
    if (SYNC_STORES[store].autoKey) {
      if (existing) data.id = existing.id;
      else delete data.id;
    }
    if (SYNC_STORES[store].binary) {
      try {
        data.data = await st.getBytes(st.ref(st.storage, `users/${uid}/library/${record.syncId}`), MAX_FILE_BYTES);
      } catch (e) {
        // The file is missing or unreadable: keep whatever this device has and try again next sync.
        console.warn('Could not download library file', record.syncId, e);
        return false;
      }
    }
    await this.state.db.put(store, data);
    return true;
  },

  /** One-time import of the old single-document backup format. */
  async _migrateLegacyProfile(profile) {
    const legacyStores = Object.keys(SYNC_STORES).filter(s => Array.isArray(profile[s]));
    if (legacyStores.length === 0) return 0;
    let imported = 0;
    for (const store of legacyStores) {
      // Only fill empty stores: the old format has no ids to de-duplicate against.
      if ((await this.dbGetAll(store)).length > 0) continue;
      for (const item of profile[store]) {
        const data = { ...item };
        if (SYNC_STORES[store].autoKey) delete data.id;
        await this.dbAdd(store, data);
        imported++;
      }
    }
    return imported;
  },

  /**
   * Write the profile and read back the server's timestamp to learn how far
   * this device's clock is off. Returns { profile, skew } (skew = server − device, ms).
   */
  async _syncProfile(fs, userRef) {
    const profileSnap = await fs.getDoc(userRef);
    const profile = profileSnap.exists() ? profileSnap.data() : {};
    const migrated = await this._migrateLegacyProfile(profile);

    const localExamsAt = Number(localStorage.getItem('woni_exams_updated')) || 0;
    const cloudExamsNewer = (profile.examsUpdatedAt || 0) > localExamsAt || this.state.userExams.length === 0;
    if (Array.isArray(profile.userExams) && profile.userExams.length && cloudExamsNewer) {
      this.state.userExams = profile.userExams;
      this.state.activeExam = profile.userExams[0];
      localStorage.setItem('woni_user_exams', JSON.stringify(profile.userExams));
      localStorage.setItem('woni_exams_updated', String(profile.examsUpdatedAt));
      localStorage.setItem('woni_setup_done', 'true');
      this.syncLibExam();
      this.updateActiveExamBadge();
    }

    const sentAt = this.now();
    // A full set (no merge) also drops the old format's large arrays.
    await fs.setDoc(userRef, {
      userExams: this.state.userExams,
      examsUpdatedAt: Number(localStorage.getItem('woni_exams_updated')) || 0,
      syncVersion: 3,
      lastSyncAt: fs.serverTimestamp(),
    });
    const after = await fs.getDoc(userRef);
    const receivedAt = this.now();
    const serverMs = after.data()?.lastSyncAt?.toMillis?.();
    const skew = Number.isFinite(serverMs) ? serverMs - (sentAt + receivedAt) / 2 : 0;
    return { migrated, skew };
  },

  async syncWithCloud() {
    if (!this.state.user) return;
    const btn = document.querySelector('#sync-now-container .btn');
    const originalText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }

    try {
      const fs = await this.getDb();
      const uid = this.state.user.uid;
      const userRef = fs.doc(fs.db, 'users', uid);
      const { migrated, skew } = await this._syncProfile(fs, userRef);
      const startedAtServer = this.now() + skew;
      const lastSync = Number(localStorage.getItem(this._lastSyncKey())) || 0;
      const since = lastSync ? lastSync - OVERLAP_MS : 0;
      let st = null;

      let pushed = 0, pulled = 0, skipped = 0, failed = 0;
      const uploadedTombstones = {};
      for (const store of Object.keys(SYNC_STORES)) {
        const local = await this._ensureSyncFields(store);
        // Compare in server time. Local deletions take part as "deleted" records (tombstones).
        const localServer = local.map(r => ({ ...r, updatedAt: r.updatedAt + skew }));
        const tombs = Object.entries(this._tombstones()[store] || {})
          .map(([syncId, deletedAt]) => ({ syncId, updatedAt: deletedAt + skew, deleted: true }));
        const col = fs.collection(fs.db, 'users', uid, store);
        const snap = await fs.getDocs(since ? fs.query(col, fs.where('updatedAt', '>', since)) : col);
        const cloud = snap.docs.map(d => d.data());
        let { push, pull } = planSync([...localServer, ...tombs], cloud, since);
        if (SYNC_STORES[store].binary) {
          const tooBig = push.filter(r => !r.deleted && bookBytes(r.data).byteLength > MAX_FILE_BYTES);
          skipped += tooBig.length;
          push = push.filter(r => !tooBig.includes(r));
        }
        if (push.length === 0 && pull.length === 0) continue;

        if (SYNC_STORES[store].binary) st ??= await this.getStorage();
        if (SYNC_STORES[store].binary) {
          // Files first: a document must never point at a file that isn't there.
          for (const r of push) {
            const fileRef = st.ref(st.storage, `users/${uid}/library/${r.syncId}`);
            if (r.deleted) await st.deleteObject(fileRef).catch(() => {});
            else await st.uploadBytes(fileRef, bookBytes(r.data), { contentType: r.type || 'application/octet-stream' });
          }
        }
        for (let i = 0; i < push.length; i += BATCH_LIMIT) {
          const batch = fs.writeBatch(fs.db);
          for (const r of push.slice(i, i + BATCH_LIMIT)) {
            // `r` is already in server time (see localServer / tombs above).
            const cloudCopy = r.deleted
              ? { syncId: r.syncId, updatedAt: Math.round(r.updatedAt), deleted: true }
              : this._toCloud(store, r, 0);
            batch.set(fs.doc(col, r.syncId), cloudCopy);
          }
          await batch.commit();
        }
        const localBySyncId = new Map(local.map(r => [r.syncId, r]));
        for (const r of pull) {
          if (await this._applyCloudRecord(store, r, localBySyncId, skew, st, uid) === false) failed++;
          else pulled++;
        }
        pushed += push.length;
        uploadedTombstones[store] = new Set(push.filter(r => r.deleted).map(r => r.syncId));
      }

      // Tombstones that reached the cloud no longer need to be kept locally.
      const remaining = this._tombstones();
      for (const [store, ids] of Object.entries(uploadedTombstones)) {
        for (const id of ids) delete remaining[store]?.[id];
      }
      localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(remaining));
      // A file that failed to download must be fetched again next time, so keep the old checkpoint.
      if (!failed) localStorage.setItem(this._lastSyncKey(), String(Math.round(startedAtServer)));
      const parts = [`${pushed} uploaded`, `${pulled} downloaded`];
      if (migrated) parts.push(`${migrated} restored from old backup`);
      if (skipped) parts.push(`${skipped} library file${skipped > 1 ? 's' : ''} over 50 MB kept on this device only`);
      if (failed) parts.push(`${failed} library file${failed > 1 ? 's' : ''} could not be downloaded (will retry)`);
      if (Math.abs(skew) > 5 * 60000) parts.push(`this device's clock is ${Math.round(Math.abs(skew) / 60000)} min ${skew > 0 ? 'behind' : 'ahead'}; adjusted automatically`);
      this.showToast(`Sync complete: ${parts.join(', ')}.`, 'success');
      if (pulled || migrated) this.showView(this.state.currentView);
    } catch (e) {
      console.error('Sync failed', e);
      this.showToast('Sync failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  },

  // --- Data Export / Import ---
  async exportData() {
    const library = (await this.dbGetAll('library')).map(({ data, ...book }) => ({
      ...book,
      dataBase64: arrayBufferToBase64(bookBytes(data).slice().buffer),
    }));
    const data = {
      userExams: this.state.userExams,
      papers: await this.dbGetAll('papers'),
      questions: await this.dbGetAll('questions'),
      flashcards: await this.dbGetAll('flashcards'),
      progress: await this.dbGetAll('progress'),
      topics: await this.dbGetAll('topics'),
      mock_tests: await this.dbGetAll('mock_tests'),
      chat_history: await this.dbGetAll('chat_history'),
      library,
      version: 2,
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.saveFile(`woni_backup_${new Date().toISOString().slice(0, 10)}.json`, blob);
  },

  async importData(event) {
    const file = event.target.files[0];
    // Reset so choosing the same file again still fires 'change'.
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Check the file before touching anything: a wrong file must not wipe the user's data.
      const problem = validateBackup(data);
      if (problem) throw new Error(problem);
      if (await this.confirmAction('Importing data will overwrite existing records. Continue?')) {
        // Older backups (version 1) have no chats or books: keep the ones on this device.
        const stores = BACKUP_STORES.filter(s => s in data);
        const before = {};
        for (const store of stores) {
          before[store] = new Set((await this.dbGetAll(store)).map(r => r.syncId).filter(Boolean));
        }
        // One transaction across all stores: either everything is replaced or nothing is.
        const tx = this.state.db.transaction(stores, 'readwrite');
        for (const store of stores) {
          const os = tx.objectStore(store);
          await os.clear();
          for (const item of data[store] || []) {
            let record = { ...item };
            if (store === 'library') {
              const { dataBase64, ...book } = record;
              record = { ...book, data: base64ToArrayBuffer(dataBase64) };
            }
            await os.put(this._stampForSync(store, record));
          }
        }
        await tx.done;
        // Records the import removed must also disappear from the cloud and other devices.
        for (const store of stores) {
          const kept = new Set((data[store] || []).map(r => r.syncId).filter(Boolean));
          this.recordDeletions(store, [...before[store]].filter(id => !kept.has(id)));
        }
        if (data.userExams) {
          this.state.userExams = data.userExams;
          localStorage.setItem('woni_user_exams', JSON.stringify(data.userExams));
          localStorage.setItem('woni_exams_updated', String(this.now()));
        }
        this.showToast('Data imported successfully!', 'success');
        setTimeout(() => location.reload(), 1500);
      }
    } catch (e) {
      this.showToast('Import failed: ' + e.message, 'error');
    }
  },

  async clearAllData() {
    if (!(await this.confirmAction('DANGER: This will delete ALL your study data, papers, and progress on this device. If you sync to the cloud, your cloud copy is kept and returns on the next sync. Continue?'))) return;
    // Close our own connection first, otherwise the delete is blocked until the page unloads.
    this.state.db?.close();
    this.state.db = null;
    await new Promise(resolve => {
      const req = indexedDB.deleteDatabase('woni_db');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    localStorage.clear();
    location.reload();
  }
};
