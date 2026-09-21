import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { configureEmulators } from "./emulators";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
configureEmulators(auth, import.meta.env);
void setPersistence(auth, browserLocalPersistence);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/** Popup on desktop, redirect on mobile (spec §5 auth gate). */
export async function signInWithGoogle(): Promise<void> {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) await signInWithRedirect(auth, provider);
  else await signInWithPopup(auth, provider);
}
