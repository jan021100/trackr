import { json } from '@sveltejs/kit';
import { db } from '$lib/utils/firebase';
import { askGpt } from '$lib/utils/gpt';
import { collection, doc, getDocs } from 'firebase/firestore';

export async function POST({ request }) {
  const { messages, uid } = await request.json();

  console.log('✅ Received POST /chatapi');
  console.log('📨 UID:', uid);
  console.log('📨 Messages:', messages);
  console.log('📦 DB instance:', db);

  if (!uid) {
    return json({ error: 'Missing uid' }, { status: 400 });
  }

  try {
    // Firestore collection path: users/{uid}/items
    const userDocRef = doc(collection(db, 'users'), uid);
    const itemsRef = collection(userDocRef, 'items');

    console.log('📁 Firestore path:', `users/${uid}/items`);

    const snapshot = await getDocs(itemsRef);
    const items = snapshot.docs.map(doc => doc.data());

    console.log('🧠 Items for GPT:', items);

    const data = await askGpt(messages, items);

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