/**
 * Security rules tests. Run against the Firebase emulators:
 *   npm run test:rules
 */
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-woni',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
afterAll(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
});

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const admin = () => env.authenticatedContext('admin', { admin: true }).firestore();
const guest = () => env.unauthenticatedContext().firestore();
const book = { title: 'Lehninger', subject: 'Biochemistry', exam: 'csir_net', url: 'https://example.com/b.pdf', addedBy: 'admin' };

describe('Firestore: user data', () => {
  it('owner can read and write their profile and synced records', async () => {
    await assertSucceeds(alice().doc('users/alice').set({ userExams: [] }));
    await assertSucceeds(alice().doc('users/alice').get());
    await assertSucceeds(alice().doc('users/alice/questions/q1').set({ text: 'Q', updatedAt: 1 }));
    await assertSucceeds(alice().collection('users/alice/questions').where('updatedAt', '>', 0).get());
  });

  it('other users and guests cannot read or write it', async () => {
    await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('users/alice/questions/q1').set({ text: 'Q' }));
    await assertFails(bob().doc('users/alice').get());
    await assertFails(bob().doc('users/alice/questions/q1').get());
    await assertFails(bob().doc('users/alice/questions/q2').set({ text: 'X' }));
    await assertFails(guest().doc('users/alice/questions/q1').get());
  });
});

describe('Firestore: shared library', () => {
  it('anyone, including guests, can read books', async () => {
    await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('library_books/b1').set(book));
    await assertSucceeds(guest().doc('library_books/b1').get());
    await assertSucceeds(guest().collection('library_books').where('exam', '==', 'csir_net').get());
  });

  it('only admins can add, edit or delete books', async () => {
    await assertFails(guest().collection('library_books').add(book));
    await assertFails(alice().collection('library_books').add(book));
    await assertSucceeds(admin().doc('library_books/b1').set(book));
    await assertFails(alice().doc('library_books/b1').update({ title: 'Spam' }));
    await assertFails(alice().doc('library_books/b1').delete());
    await assertSucceeds(admin().doc('library_books/b1').update({ title: 'Lehninger 8e' }));
    await assertSucceeds(admin().doc('library_books/b1').delete());
  });
});

describe('Storage: library PDFs', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  const ref = (ctx, name = 'csir_net/book.pdf') => ctx.storage().ref(`library_books/${name}`);

  it('only admins can upload, and only PDFs', async () => {
    await assertFails(ref(env.unauthenticatedContext()).put(pdf, { contentType: 'application/pdf' }));
    await assertFails(ref(env.authenticatedContext('alice')).put(pdf, { contentType: 'application/pdf' }));
    await assertSucceeds(ref(env.authenticatedContext('admin', { admin: true })).put(pdf, { contentType: 'application/pdf' }));
    await assertFails(ref(env.authenticatedContext('admin', { admin: true }), 'csir_net/x.html').put(pdf, { contentType: 'text/html' }));
  });

  it('anyone can download', async () => {
    await env.withSecurityRulesDisabled(ctx => ref(ctx).put(pdf, { contentType: 'application/pdf' }));
    await assertSucceeds(ref(env.unauthenticatedContext()).getMetadata());
  });
});
