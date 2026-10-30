/**
 * Woni — Firebase access (modular SDK).
 *
 * Auth is loaded with the app (it decides what the first screen is).
 * Firestore and Storage are loaded on first use, so guests who never sync
 * or browse cloud books don't download them.
 */
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

/**
 * Firebase web config. Override any value with a VITE_FIREBASE_* variable in
 * .env (see .env.example). The appId default is the project's Android app;
 * register a Web app in the Firebase console and set VITE_FIREBASE_APP_ID to
 * its id so web-only services (Analytics, App Check) work.
 */
const env = import.meta.env || {};
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyBCc6JdOtYhgvINHgdNHyIMVBw_8v1INgk',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'woni-f6a2a.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'woni-f6a2a',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'woni-f6a2a.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '802707408926',
  appId: env.VITE_FIREBASE_APP_ID || '1:802707408926:android:f561524d07bee95524c60f',
};

export function firebaseApp() {
  return getApps()[0] ?? initializeApp(firebaseConfig);
}

export function firebaseAuth() {
  return getAuth(firebaseApp());
}

let firestorePromise;
/**
 * Firestore functions plus the `db` instance, e.g.
 *   const { db, doc, getDoc } = await loadFirestore();
 */
export function loadFirestore() {
  firestorePromise ??= import('firebase/firestore').then(fs => ({
    ...fs,
    // Locally-generated records can contain undefined fields (e.g. a missing
    // explanation); Firestore rejects those unless told to drop them.
    db: fs.initializeFirestore(firebaseApp(), { ignoreUndefinedProperties: true }),
  }));
  return firestorePromise;
}

let storagePromise;
/** Storage functions plus the `storage` instance. */
export function loadStorage() {
  storagePromise ??= import('firebase/storage').then(st => ({
    ...st,
    storage: st.getStorage(firebaseApp()),
  }));
  return storagePromise;
}
