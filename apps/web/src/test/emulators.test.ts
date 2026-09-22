import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

const { connectAuthEmulator, connectFirestoreEmulator } = vi.hoisted(() => ({
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  connectAuthEmulator,
}));

vi.mock("firebase/firestore", () => ({
  connectFirestoreEmulator,
}));

import { configureEmulators } from "../lib/emulators";

const fakeAuth = {} as Auth;
const fakeDb = {} as Firestore;

test("connects Auth to the emulator only when VITE_USE_EMULATORS === '1'", () => {
  configureEmulators(fakeAuth, { VITE_USE_EMULATORS: "1" });
  expect(connectAuthEmulator).toHaveBeenCalledWith(fakeAuth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  connectAuthEmulator.mockClear();
  configureEmulators(fakeAuth, { VITE_USE_EMULATORS: "0" });
  configureEmulators(fakeAuth, {});
  expect(connectAuthEmulator).not.toHaveBeenCalled();
});

test("connects Firestore on port 8080 when a database is passed and emulators are on", () => {
  connectFirestoreEmulator.mockClear();
  configureEmulators(fakeAuth, { VITE_USE_EMULATORS: "1" }, fakeDb);
  expect(connectFirestoreEmulator).toHaveBeenCalledWith(fakeDb, "127.0.0.1", 8080);
  connectFirestoreEmulator.mockClear();
  configureEmulators(fakeAuth, {}, fakeDb);
  expect(connectFirestoreEmulator).not.toHaveBeenCalled();
});
