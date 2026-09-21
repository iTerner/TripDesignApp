/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_API_URL: string;
  /** "1" → connect the Firebase SDK to local emulators (set by dev.bat). */
  readonly VITE_USE_EMULATORS?: string;
}
