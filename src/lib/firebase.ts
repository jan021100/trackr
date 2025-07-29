// src/lib/firebase.ts

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from 'firebase/storage';


// Firebase-Konfiguration
const firebaseConfig = {
  apiKey: "AIzaSyDj_tEFuIMMEW1A6CEu6G-Kwp3BGTcOJaA",
  authDomain: "trackr-9165f.firebaseapp.com",
  projectId: "trackr-9165f",
  storageBucket: "trackr-9165f.appspot.com",
  messagingSenderId: "902577114543",
  appId: "1:902577114543:web:f08cf691bf012d947d335a",
  measurementId: "G-VX2PHDZS69"
};

// Initialisiere App nur einmal
const app = initializeApp(firebaseConfig);

// Exporte
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app); // <- app ist dein Firebase-App-Objekt

// Optional: Analytics nur im Browser laden
if (typeof window !== "undefined") {
  import("firebase/analytics").then(({ getAnalytics, isSupported }) => {
    isSupported().then((supported) => {
      if (supported) {
        getAnalytics(app);
      }
    });
  });
}