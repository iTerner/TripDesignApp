import { type Auth, connectAuthEmulator } from "firebase/auth";

/**
 * dev.bat sets VITE_USE_EMULATORS=1 so the SDK talks to the local Auth emulator
 * (and, once the web app uses the Firestore SDK in later phases, connectFirestoreEmulator
 * is added here too). Production builds never define this variable.
 */
export function configureEmulators(auth: Auth, env: { VITE_USE_EMULATORS?: string }): void {
  if (env.VITE_USE_EMULATORS === "1") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
}
