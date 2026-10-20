import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyAKgj9SY8sz6ESJWKr1SnKhp9CmaB_ls3o",
  authDomain: "kashishji.firebaseapp.com",
  projectId: "kashishji",
  storageBucket: "kashishji.firebasestorage.app",
  messagingSenderId: "1054034943951",
  appId: "1:1054034943951:web:cc9657fde35cf3983efcba",
  measurementId: "G-K6QQ1PPXJF"
};

export const ADMIN_EMAIL = "jayshankar431@gmail.com";

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Analytics safely in browser environments
export const analyticsPromise = typeof window !== "undefined"
  ? isSupported().then((yes) => (yes ? getAnalytics(app) : null)).catch(() => null)
  : Promise.resolve(null);

// Initialize Firebase Authentication & Firestore (100% Free Spark Tier - No Storage Needed)
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);


