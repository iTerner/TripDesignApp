import type { Auth } from "firebase/auth";

const { connectAuthEmulator } = vi.hoisted(() => ({
  connectAuthEmulator: vi.fn(),
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  connectAuthEmulator,
}));

import { configureEmulators } from "../lib/emulators";

const fakeAuth = {} as Auth;

test("connects Auth to the emulator only when VITE_USE_EMULATORS === '1'", () => {
  configureEmulators(fakeAuth, { VITE_USE_EMULATORS: "1" });
  expect(connectAuthEmulator).toHaveBeenCalledWith(fakeAuth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectAuthEmulator.mockClear();
  configureEmulators(fakeAuth, { VITE_USE_EMULATORS: "0" });
  configureEmulators(fakeAuth, {});
  expect(connectAuthEmulator).not.toHaveBeenCalled();
});
