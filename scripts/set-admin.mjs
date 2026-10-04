/**
 * Grant or revoke the `admin` custom claim that lets an account upload
 * books to the shared library.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=service-account.json \
 *     node scripts/set-admin.mjs you@example.com          # grant
 *     node scripts/set-admin.mjs you@example.com --revoke # revoke
 *
 * Get service-account.json from Firebase console → Project settings →
 * Service accounts → Generate new private key. Never commit it.
 * The user must sign out and back in (or wait up to an hour) for the
 * new claim to reach their ID token.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error('Usage: node scripts/set-admin.mjs <email> [--revoke]');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
const admin = flag !== '--revoke';
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin });
console.log(`${admin ? 'Granted' : 'Revoked'} admin for ${email} (uid ${user.uid}).`);
