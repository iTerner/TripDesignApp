import { type Auth, connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator, type Firestore } from "firebase/firestore";

/**
 * dev.bat sets VITE_USE_EMULATORS=1 so the SDK talks to the local Auth and
 * Firestore emulators. Production builds never define this variable.
 */
export function configureEmulators(
  auth: Auth,
  env: { VITE_USE_EMULATORS?: string },
  firestore?: Firestore,
): void {
  if (env.VITE_USE_EMULATORS === "1") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    if (firestore) connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  }
}
