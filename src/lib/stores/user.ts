import { writable } from 'svelte/store';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '$lib/firebase';

export const user = writable<any | null>(null);
export const userReady = writable(false); // 🔄 neu

onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    const userRef = doc(db, 'users', firebaseUser.uid);
    const snap = await getDoc(userRef);
    const profile = snap.exists() ? snap.data() : {};

    user.set({
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName ?? profile.name ?? '', // optional fallback
      photoURL: firebaseUser.photoURL ?? profile.photoURL ?? '',   // optional fallback
      ...profile
    });
  } else {
    user.set(null);
  }

  userReady.set(true); // ✅ WICHTIG: jetzt ist Auth abgeschlossen
});