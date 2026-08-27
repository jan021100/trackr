// src/lib/firebase.ts

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { firebaseConfig } from '$lib/firebase-config';

// Initialize app (only once)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Analytics is useful in deployed builds, but enabling it on localhost creates
// a Firebase Installation and adds noisy 403s when the production API key is
// restricted to deployed domains.
if (typeof window !== 'undefined' && import.meta.env.PROD) {
  isSupported().then((supported) => {
    if (supported) getAnalytics(app);
  });
}

// Exports
export const db = getFirestore(app);
export const auth = getAuth(app);
