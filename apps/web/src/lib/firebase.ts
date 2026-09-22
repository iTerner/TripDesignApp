import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  setPersistence,
  signInWithRedirect,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { configureEmulators } from "./emulators";

/**
 * The helper at /__/auth/handler must be the same site as the page.
 * Chrome will not let a firebaseapp.com helper finish a sign-in that started
 * on web.app, and the helper page stays blank. Each hosting hostname uses itself.
 */
const HOSTING_HOSTS = new Set(["tripdesignai.web.app", "tripdesignai.firebaseapp.com"]);

function resolveAuthDomain(): string {
  const host = window.location.hostname;
  if (HOSTING_HOSTS.has(host)) return host;
  return import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
}

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: resolveAuthDomain(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
configureEmulators(auth, import.meta.env, db);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/**
 * Popup sign-in lands on a blank /__/auth/handler and never returns: Google's
 * login page drops window.opener, and the helper has nobody to message.
 * A full-page redirect on the same host completes and comes back here.
 */
const redirectReady = setPersistence(auth, browserLocalPersistence)
  .then(() => getRedirectResult(auth))
  .catch((error: unknown) => {
    console.error("Google redirect sign-in failed", error);
  });

export async function signInWithGoogle(): Promise<void> {
  await redirectReady;
  await signInWithRedirect(auth, provider);
}
