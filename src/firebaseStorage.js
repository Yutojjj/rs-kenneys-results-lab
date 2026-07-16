import { initializeApp } from "firebase/app";
import { doc, getDoc, getFirestore, onSnapshot, setDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const BOARD_ID = import.meta.env.VITE_FIREBASE_BOARD_ID || "rs-kenneys-results-lab";

let app;
let storage;
let db;

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every(Boolean);
}

export async function uploadMemberImage(blob, memberName) {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured.");
  }

  ensureFirebase();

  const safeName = encodeURIComponent(memberName).replace(/%/g, "");
  const imageRef = ref(storage, `member-images/${safeName}-${Date.now()}.jpg`);
  await uploadBytes(imageRef, blob, { contentType: "image/jpeg" });
  return getDownloadURL(imageRef);
}

export async function loadBoardState() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured.");
  }

  ensureFirebase();
  const snapshot = await getDoc(doc(db, "boards", BOARD_ID));
  if (!snapshot.exists()) return null;
  return hydrateBoardState(snapshot.data());
}

export function subscribeBoardState(onState, onError) {
  if (!isFirebaseConfigured()) return () => {};
  ensureFirebase();
  return onSnapshot(
    doc(db, "boards", BOARD_ID),
    async (snapshot) => {
      if (!snapshot.exists()) return;
      try {
        onState(await hydrateBoardState(snapshot.data()));
      } catch (error) {
        onError?.(error);
      }
    },
    (error) => onError?.(error)
  );
}

async function hydrateBoardState(boardState) {
  const chunks = [];
  for (let index = 0; index < (boardState.recordChunkCount || 0); index += 1) {
    const chunkSnapshot = await getDoc(doc(db, "boards", BOARD_ID, "recordChunks", `chunk-${index}`));
    if (chunkSnapshot.exists()) {
      chunks.push(...(chunkSnapshot.data().records || []));
    }
  }

  return { ...boardState, recentResults: chunks };
}

export async function saveBoardState(state) {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured.");
  }

  ensureFirebase();
  const records = state.recentResults || [];
  const chunkSize = 300;
  const recordChunkCount = Math.ceil(records.length / chunkSize);
  const { recentResults, ...boardState } = state;

  for (let index = 0; index < recordChunkCount; index += 1) {
    await setDoc(doc(db, "boards", BOARD_ID, "recordChunks", `chunk-${index}`), {
      records: records.slice(index * chunkSize, (index + 1) * chunkSize)
    });
  }

  await setDoc(doc(db, "boards", BOARD_ID), {
    ...boardState,
    recordChunkCount,
    cloudUpdatedAt: new Date().toISOString()
  }, { merge: true });
}

function ensureFirebase() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    storage = getStorage(app);
    db = getFirestore(app);
  }
}
