// src/lib/utils/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Deine Firebase-Konfiguration
const firebaseConfig = {
  apiKey: 'AIzaSyDj_tEfUL1MEW1A6cEu6-Kwp3BGtCoJ0aA',
  authDomain: 'trackr-9165f.firebaseapp.com',
  projectId: 'trackr-9165f',
  storageBucket: 'trackr-9165f.appspot.com',
  messagingSenderId: '90257714543',
  appId: '1:90257714543:web:f08cf691bf012d947d35a',
  measurementId: 'G-VX2PHDZ569'
};

// Initialisiere App nur einmal
const app = initializeApp(firebaseConfig);

// Exporte
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Optional: Analytics (nur im Browser laden, nicht auf Server)
if (typeof window !== 'undefined') {
  import('firebase/analytics').then(({ getAnalytics, isSupported }) => {
    isSupported().then((supported) => {
      if (supported) {
        getAnalytics(app);
      }
    });
  });
}