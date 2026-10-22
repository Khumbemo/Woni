/**
 * Woni — Sync & Export Module
 *
 * Cloud sync stores one Firestore document per record under
 * users/{uid}/{store}/{syncId}, so no single document approaches Firestore's
 * 1 MiB limit. Every local write stamps `syncId` and `updatedAt` (see db.js);
 * a sync uploads local changes since the last sync, downloads cloud changes,
 * and the newer `updatedAt` wins when both sides changed.
 * Deletions are not synced (the app only deletes via Reset / Import).
 */
import { SYNC_STORES, makeSyncId, planSync } from './utils.js';

const BATCH_LIMIT = 400;
const BACKUP_STORES = ['papers', 'questions', 'flashcards', 'progress', 'topics', 'mock_tests'];

/** Returns a reason the object isn't a Woni backup, or null if it looks valid. */
export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'This file is not a Woni backup.';
  const present = BACKUP_STORES.filter(s => s in data);
  if (present.length === 0) return 'This file is not a Woni backup (no study data found).';
  for (const s of present) {
    if (!Array.isArray(data[s])) return `This backup is damaged: "${s}" is not a list.`;
    if (data[s].some(item => !item || typeof item !== 'object' || Array.isArray(item))) return `This backup is damaged: "${s}" contains invalid records.`;
  }
  if ('userExams' in data && !Array.isArray(data.userExams)) return 'This backup is damaged: "userExams" is not a list.';
  return null;
}          // Firestore allows 500 writes per batch
const CLOCK_SKEW_MS = 5 * 60000;  // re-check a few minutes of overlap between devices

const TOMBSTONE_KEY = 'woni_tombstones';

export const syncMixin = {
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
    const now = Date.now();
    for (const id of syncIds) t[store][id] = now;
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(t));
  },

  _lastSyncKey() {
    return `woni_last_sync_${this.state.user.uid}`;
  },

  /** Give records written before sync existed a syncId/updatedAt, without bumping existing ones. */
  async _ensureSyncFields(store) {
    const records = await this.dbGetAll(store);
    for (const r of records) {
      if (r.syncId && r.updatedAt) continue;
      r.syncId ||= makeSyncId(store, r);
      r.updatedAt ||= Date.now();
      await this.state.db.put(store, r);
    }
    return records;
  },

  /** Cloud copy of a record: plain JSON, without device-specific auto-increment keys. */
  _toCloud(store, record) {
    const copy = JSON.parse(JSON.stringify(record));
    if (SYNC_STORES[store].autoKey) delete copy.id;
    return copy;
  },

  /** Write a downloaded record locally, keeping its cloud updatedAt so it isn't re-uploaded as new. */
  async _applyCloudRecord(store, record, localBySyncId) {
    const existing = localBySyncId.get(record.syncId);
    if (record.deleted) {
      // Deleted on another device (or by an import there).
      if (existing) await this.state.db.delete(store, existing.id);
      return;
    }
    const data = { ...record };
    if (SYNC_STORES[store].autoKey) {
      if (existing) data.id = existing.id;
      else delete data.id;
    }
    await this.state.db.put(store, data);
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

  async syncWithCloud() {
    if (!this.state.user) return;
    const btn = document.querySelector('#sync-now-container .btn');
    const originalText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }

    try {
      const db = await this.getDb();
      const userRef = db.collection('users').doc(this.state.user.uid);
      const startedAt = Date.now();
      const lastSync = Number(localStorage.getItem(this._lastSyncKey())) || 0;

      // Profile: target exams (small), plus migration from the old format.
      const profileSnap = await userRef.get();
      const profile = profileSnap.exists ? profileSnap.data() : {};
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
      // Overwrites the old single document, dropping its large legacy arrays.
      await userRef.set({
        userExams: this.state.userExams,
        examsUpdatedAt: Number(localStorage.getItem('woni_exams_updated')) || 0,
        syncVersion: 2,
      });

      let pushed = 0, pulled = 0;
      const uploadedTombstones = {};
      for (const store of Object.keys(SYNC_STORES)) {
        const local = await this._ensureSyncFields(store);
        // Local deletions take part in the merge as "deleted" records (tombstones).
        const tombs = Object.entries(this._tombstones()[store] || {})
          .map(([syncId, updatedAt]) => ({ syncId, updatedAt, deleted: true }));
        const col = userRef.collection(store);
        const since = lastSync ? lastSync - CLOCK_SKEW_MS : 0;
        const snap = since ? await col.where('updatedAt', '>', since).get() : await col.get();
        const cloud = snap.docs.map(d => d.data());
        const { push, pull } = planSync([...local, ...tombs], cloud, since);

        for (let i = 0; i < push.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          for (const r of push.slice(i, i + BATCH_LIMIT)) batch.set(col.doc(r.syncId), this._toCloud(store, r));
          await batch.commit();
        }
        const localBySyncId = new Map(local.map(r => [r.syncId, r]));
        for (const r of pull) await this._applyCloudRecord(store, r, localBySyncId);
        pushed += push.length;
        pulled += pull.length;
        uploadedTombstones[store] = new Set(push.filter(r => r.deleted).map(r => r.syncId));
      }

      // Tombstones that reached the cloud no longer need to be kept locally.
      const remaining = this._tombstones();
      for (const [store, ids] of Object.entries(uploadedTombstones)) {
        for (const id of ids) delete remaining[store]?.[id];
      }
      localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(remaining));
      localStorage.setItem(this._lastSyncKey(), String(startedAt));
      const parts = [`${pushed} uploaded`, `${pulled} downloaded`];
      if (migrated) parts.push(`${migrated} restored from old backup`);
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
    const data = {
      userExams: this.state.userExams,
      papers: await this.dbGetAll('papers'),
      questions: await this.dbGetAll('questions'),
      flashcards: await this.dbGetAll('flashcards'),
      progress: await this.dbGetAll('progress'),
      topics: await this.dbGetAll('topics'),
      mock_tests: await this.dbGetAll('mock_tests'),
      version: 1,
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
        const before = {};
        for (const store of BACKUP_STORES) {
          before[store] = new Set((await this.dbGetAll(store)).map(r => r.syncId).filter(Boolean));
        }
        // One transaction across all stores: either everything is replaced or nothing is.
        const tx = this.state.db.transaction(BACKUP_STORES, 'readwrite');
        for (const store of BACKUP_STORES) {
          const os = tx.objectStore(store);
          await os.clear();
          for (const item of data[store] || []) {
            await os.put(this._stampForSync(store, { ...item }));
          }
        }
        await tx.done;
        // Records the import removed must also disappear from the cloud and other devices.
        for (const store of BACKUP_STORES) {
          const kept = new Set((data[store] || []).map(r => r.syncId).filter(Boolean));
          this.recordDeletions(store, [...before[store]].filter(id => !kept.has(id)));
        }
        if (data.userExams) {
          this.state.userExams = data.userExams;
          localStorage.setItem('woni_user_exams', JSON.stringify(data.userExams));
          localStorage.setItem('woni_exams_updated', String(Date.now()));
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
