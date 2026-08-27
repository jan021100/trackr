// src/lib/server/firebase-admin.ts
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import type { Credential } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';
import { firebaseConfig } from '$lib/firebase-config';
import {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY
} from '$env/static/private';

function getCredential(): Credential {
  if (process.env.FIREBASE_KEY_PATH && process.env.NODE_ENV !== 'production') {
    // Lokale Entwicklungsumgebung: JSON-Datei lesen
    const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_KEY_PATH, 'utf-8'));
    return cert(serviceAccount);
  }

  // Vercel / Production: Daten aus .env / Vercel-Environment
  return cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  });
}

// Initialize only when a server request actually needs Firestore. SvelteKit imports
// endpoint modules during builds, when runtime credentials may not be available.
function getAdminApp(): App {
  const existingApp = getApps()[0];
  return existingApp ?? initializeApp({ credential: getCredential() });
}

export function getAdminDb() { return getFirestore(getAdminApp()); }
export function getAdminAuth() { return getAuth(getAdminApp()); }

/**
 * Verify a Firebase ID token with Admin first. Safari can occasionally restore
 * a token that Admin rejects even after the client refreshes it, so the
 * official Firebase Auth account lookup is used as a fail-closed fallback.
 */
export async function verifyFirebaseUser(token: string): Promise<string> {
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid;
  } catch (adminError) {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(10_000)
      }
    );
    if (!response.ok) throw adminError;

    const payload = await response.json() as { users?: Array<{ localId?: unknown }> };
    const uid = String(payload.users?.[0]?.localId ?? '').trim();
    if (!uid) throw adminError;
    return uid;
  }
}
