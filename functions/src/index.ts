import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

let credential: admin.credential.Credential;

if (process.env.FIREBASE_KEY_PATH && fs.existsSync(process.env.FIREBASE_KEY_PATH)) {
  // 🖥 Lokal: Service-Account-Datei laden
  const serviceAccount = JSON.parse(
    fs.readFileSync(process.env.FIREBASE_KEY_PATH, 'utf8')
  );
  credential = admin.credential.cert(serviceAccount);
} else {
  // ☁️ Vercel: Daten aus Umgebungsvariablen laden
  if (
    !process.env.FIREBASE_PRIVATE_KEY ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PROJECT_ID
  ) {
    throw new Error('Missing Firebase credentials in environment variables.');
  }

  credential = admin.credential.cert({
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

// ✅ Firebase initialisieren (einmal pro Instanz)
if (!admin.apps.length) {
  admin.initializeApp({
    credential,
  });
}

export default admin;