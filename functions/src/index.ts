import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config(); // ← Load .env variables

// ✅ Check before using the variable
if (!process.env.FIREBASE_KEY_PATH) {
  throw new Error('FIREBASE_KEY_PATH is not set in your .env file.');
}

// ✅ Only read the file if the path exists
const serviceAccount = JSON.parse(
  fs.readFileSync(process.env.FIREBASE_KEY_PATH as string, 'utf8')
);

// ✅ Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});