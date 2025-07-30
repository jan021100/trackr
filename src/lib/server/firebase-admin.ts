// src/lib/server/firebase-admin.ts
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY
} from '$env/static/private';

let credential;

if (process.env.FIREBASE_KEY_PATH && process.env.NODE_ENV !== 'production') {
  // Lokale Entwicklungsumgebung: JSON-Datei lesen
  const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_KEY_PATH, 'utf-8'));
  credential = cert(serviceAccount);
} else {
  // Vercel / Production: Daten aus .env / Vercel-Environment
  credential = cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  });
}

const firebaseAdminApp =
  getApps().length === 0
    ? initializeApp({ credential })
    : getApps()[0];

export const adminDb = getFirestore(firebaseAdminApp);