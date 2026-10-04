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

const BATCH_LIMIT = 400;          // Firestore allows 500 writes per batch
const CLOCK_SKEW_MS = 5 * 60000;  // re-check a few minutes of overlap between devices

export const syncMixin = {
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
    const data = { ...record };
    if (SYNC_STORES[store].autoKey) {
      const existing = localBySyncId.get(record.syncId);
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
      for (const store of Object.keys(SYNC_STORES)) {
        const local = await this._ensureSyncFields(store);
        const col = userRef.collection(store);
        const since = lastSync ? lastSync - CLOCK_SKEW_MS : 0;
        const snap = since ? await col.where('updatedAt', '>', since).get() : await col.get();
        const cloud = snap.docs.map(d => d.data());
        const { push, pull } = planSync(local, cloud, since);

        for (let i = 0; i < push.length; i += BATCH_LIMIT) {
          const batch = db.batch();
          for (const r of push.slice(i, i + BATCH_LIMIT)) batch.set(col.doc(r.syncId), this._toCloud(store, r));
          await batch.commit();
        }
        const localBySyncId = new Map(local.map(r => [r.syncId, r]));
        for (const r of pull) await this._applyCloudRecord(store, r, localBySyncId);
        pushed += push.length;
        pulled += pull.length;
      }

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
      if (await this.confirmAction('Importing data will overwrite existing records. Continue?')) {
        const stores = ['papers', 'questions', 'flashcards', 'progress', 'topics', 'mock_tests'];
        for (const store of stores) {
          await this.state.db.clear(store);
          if (data[store]) {
            for (const item of data[store]) {
              await this.dbAdd(store, item);
            }
          }
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
    if (await this.confirmAction('DANGER: This will delete ALL your study data, papers, and progress. Continue?')) {
      localStorage.clear();
      indexedDB.deleteDatabase('woni_db');
      location.reload();
    }
  }
};
