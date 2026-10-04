// 原本 (OneDrive: src/web/firebase-config.js) は API キーを含むためコピーしていない。
// 形だけを残したもの。実値はコミットしないこと。
//
// 移植先 (Next.js) では値を環境変数から読むこと:
//   process.env.NEXT_PUBLIC_FIREBASE_API_KEY など

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'REDACTED',
  authDomain: 'REDACTED',
  projectId: 'REDACTED',
  storageBucket: 'REDACTED',
  messagingSenderId: 'REDACTED',
  appId: 'REDACTED',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
