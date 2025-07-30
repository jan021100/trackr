import { json } from '@sveltejs/kit';
import { db } from '$lib/utils/firebase';
import { askGpt } from '$lib/utils/gpt';
import { collection, doc, getDocs } from 'firebase/firestore';

export async function POST({ request }) {
  const { messages, uid } = await request.json();

  if (!uid) {
    return json({ error: 'Missing uid' }, { status: 400 });
  }

  try {
    const itemsRef = collection(doc(collection(db, 'users'), uid), 'items');
    const snapshot = await getDocs(itemsRef);
    const items = snapshot.docs.map(doc => doc.data());

    const data = await askGpt(messages, items);
    return json(data);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}