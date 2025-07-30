import { json } from '@sveltejs/kit';
import { adminDb } from '$lib/server/firebase-admin';
import { askGpt } from '$lib/utils/gpt';

export async function POST({ request }) {
	const { messages, uid } = await request.json();

	console.log('✅ Received POST /chatapi');
	console.log('📨 UID:', uid);
	console.log('📨 Messages:', messages);

	if (!uid) {
		return json({ error: 'Missing uid' }, { status: 400 });
	}

	try {
		const itemsSnap = await adminDb.collection('users').doc(uid).collection('items').get();
		const prefsSnap = await adminDb.collection('users').doc(uid).collection('prefs').get();
		const userSnap = await adminDb.collection('users').doc(uid).get();

		const items = itemsSnap.docs.map(doc => doc.data());
		const prefs = prefsSnap.docs.map(doc => doc.data());
		const profile = userSnap.exists ? userSnap.data() : null;

		console.log('🧠 Items for GPT:', items);
		console.log('⚙️ Prefs for GPT:', prefs);
		console.log('👤 Profile for GPT:', profile);

		const data = await askGpt(messages, { items, prefs, profile });

		console.log('✅ GPT response:', data);

		return json(data);
	} catch (error) {
		console.error('❌ GPT/Firestore error:', error);
		return json({ error: error?.message || 'Unknown error' }, { status: 500 });
	}
}