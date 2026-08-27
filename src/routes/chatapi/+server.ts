import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin';
import { verifyFirebaseUser } from '$lib/server/firebase-admin';
import { askGpt } from '$lib/utils/gpt';

export async function POST({ request }) {
	const authorization = request.headers.get('authorization') ?? '';
	const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
	if (!token) return json({ error: 'Sign in to use this feature.' }, { status: 401 });

	let uid = '';
	try { uid = await verifyFirebaseUser(token); }
	catch { return json({ error: 'Your session could not be verified.' }, { status: 401 }); }

	const { messages } = await request.json() as { messages?: unknown };
	if (!Array.isArray(messages) || messages.length > 50 || JSON.stringify(messages).length > 50_000) {
		return json({ error: 'Invalid message request.' }, { status: 400 });
	}

	try {
		const adminDb = getAdminDb();
		const itemsSnap = await adminDb.collection('users').doc(uid).collection('items').get();
		const prefsSnap = await adminDb.collection('users').doc(uid).collection('prefs').get();
		const userSnap = await adminDb.collection('users').doc(uid).get();

		const items = itemsSnap.docs.map(doc => doc.data());
		const prefs = prefsSnap.docs.map(doc => doc.data());
		const profile = userSnap.exists ? userSnap.data() : null;

		const data = await askGpt(messages, { items, prefs, profile });
		return json(data);
	} catch (error: unknown) {
		console.error('❌ GPT/Firestore error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
}
