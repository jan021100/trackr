import { json } from '@sveltejs/kit';
import { db } from '$lib/utils/firebase';
import { askGpt } from '$lib/utils/gpt';

export async function POST({ request }) {
  const { messages, uid } = await request.json();

  if (!uid) {
    return json({ error: 'Missing uid' }, { status: 400 });
  }

  const snapshot = await db.collection('users').doc(uid).collection('items').get();
  const items = snapshot.docs.map(doc => doc.data());

  try {
    const data = await askGpt(messages, items);
    return json(data);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}