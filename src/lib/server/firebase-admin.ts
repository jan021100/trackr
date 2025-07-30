// src/lib/server/firebase-admin.ts
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import {
	FIREBASE_KEY_PATH,
	FIREBASE_PROJECT_ID,
	FIREBASE_CLIENT_EMAIL,
	FIREBASE_PRIVATE_KEY
} from '$env/static/private';

let firebaseAdminApp;

if (!getApps().length) {
	if (FIREBASE_KEY_PATH) {
		// ✅ Lokale Initialisierung über JSON-Datei
		const serviceAccount = JSON.parse(readFileSync(FIREBASE_KEY_PATH, 'utf8'));
		firebaseAdminApp = initializeApp({
			credential: cert(serviceAccount)
		});
	} else {
		// ✅ Server (z. B. Vercel) Initialisierung über Umgebungsvariablen
		firebaseAdminApp = initializeApp({
			credential: cert({
				projectId: FIREBASE_PROJECT_ID,
				clientEmail: FIREBASE_CLIENT_EMAIL,
				privateKey: FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
			})
		});
	} 
} else {
	firebaseAdminApp = getApps()[0];
}

export const adminDb = getFirestore(firebaseAdminApp);