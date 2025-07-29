import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { auth, db } from './firebase';

export async function migrateItemsToUser() {
  const user = auth.currentUser;
  if (!user) throw new Error('Nicht eingeloggt');

  // Hole alle Items aus der alten, globalen Sammlung
  const snapshot = await getDocs(collection(db, 'items'));

  for (const itemDoc of snapshot.docs) {
    const data = itemDoc.data();
    const newRef = doc(db, 'users', user.uid, 'items', itemDoc.id);
    await setDoc(newRef, data);
  }
}