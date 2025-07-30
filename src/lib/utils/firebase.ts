// src/lib/utils/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Firebase-Konfiguration
const firebaseConfig = {
  apiKey: "AIzaSyDj_tEFu1MMEv1A6CuE6o-Kwp3BGtcOjAA",
  authDomain: "trackr-9165f.firebaseapp.com",
  projectId: "trackr-9165f",
  storageBucket: "trackr-9165f.appspot.com",
  messagingSenderId: "902572114543",
  appId: "1:902572114543:web:f08cf691bf012d947d35a",
  measurementId: "G-VX2PHDZ69"
};

// App nur einmal initialisieren
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Exporte
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);