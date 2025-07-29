// src/routes/api/chat.ts
import { OPENAI_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Admin SDK nur einmal initialisieren
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') // 🔥 notwendig!
    })
  });
}

const db = getFirestore();

export async function POST({ request }) {
  const { messages, uid } = await request.json();

  if (!uid) {
    return json({ error: 'Missing uid' }, { status: 400 });
  }

  // Kleidungsdaten laden
  const snapshot = await db.collection('users').doc(uid).collection('items').get();
  const items = snapshot.docs.map(doc => doc.data());

  // System Prompt erweitern
  const systemPrompt = {
    role: 'system',
    content: `Du bist ein freundlicher Modeassistent. Antworte kumpelhaft, kurz, hilfreich. Du kennst folgende Kleidungsstücke des Nutzers:\n\n${JSON.stringify(items, null, 2)}`
  };

  const fullMessages = [systemPrompt, ...messages];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: fullMessages,
    }),
  });

  const data = await res.json();
  return json(data);
}