import { json } from '@sveltejs/kit';
import { db } from '$lib/utils/firebase';
import { askGpt } from '$lib/utils/gpt';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

export async function POST({ request }) {
  const { messages, uid } = await request.json();

  console.log('✅ Received POST /chatapi');
  console.log('📨 UID:', uid);
  console.log('📨 Messages:', messages);
  console.log('📦 DB instance:', db);

  if (!uid) {
    return json({ error: 'Missing uid' }, { status: 400 });
  }

  // 🧰 Hilfsfunktion zum sicheren Laden eines Dokuments
  const safeGetDocData = async (ref) => {
    try {
      const snap = await getDoc(ref);
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      console.warn('⚠️ Failed to load doc:', ref.path, err.message);
      return null;
    }
  };

  try {
    const userRef = doc(collection(db, 'users'), uid);

    // 👕 1. Lade Kleidungsstücke (Subcollection: items)
    const itemsRef = collection(userRef, 'items');
    const itemsSnap = await getDocs(itemsRef);
    const items = itemsSnap.docs.map(doc => doc.data());

    // 🧍 2. Lade Profildaten (z. B. profile, prefs, style)
    const profile = await safeGetDocData(doc(userRef, 'profile'));
    const prefs = await safeGetDocData(doc(userRef, 'prefs'));
    const style = await safeGetDocData(doc(userRef, 'style'));

    console.log('🧠 Items:', items);
    console.log('👤 Profile:', profile);
    console.log('⚙️ Prefs:', prefs);
    console.log('🎨 Style:', style);

    // 🤖 3. Übergib alles an GPT
    const data = await askGpt(messages, items, prefs, profile, style);

    console.log('✅ GPT response:', data);

    return json(data);
  } catch (error) {
    console.error('❌ GPT/Firestore error:', error);
    return json(
      {
        error: error?.message || 'Unknown error',
        full: JSON.stringify(error)
      },
      { status: 500 }
    );
  }
}