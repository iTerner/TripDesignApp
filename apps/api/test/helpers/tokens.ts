import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
  UnsecuredJWT,
} from "jose";

export const TEST_PROJECT = "test-project";

/**
 * Frozen instant used by auth tests (`new Date("2026-09-20T12:00:00Z")`).
 * Default `auth_time` must be valid at that clock; `Date.now()` is not.
 */
const TEST_NOW_SEC = Math.floor(Date.parse("2026-09-20T12:00:00Z") / 1000);

export interface TestJwks {
  getKey: JWTVerifyGetKey;
  sign(claims?: Record<string, unknown>, opts?: { expiresIn?: string }): Promise<string>;
  /** Signed with a key that is NOT in the JWKS — must fail verification. */
  signWithForeignKey(claims?: Record<string, unknown>): Promise<string>;
  /** `alg: "none"` token (what the Firebase Auth emulator issues) — must fail unless emulator mode is on. */
  unsecured(claims?: Record<string, unknown>): Promise<string>;
  /** HS256 token signed with a symmetric secret — must always fail (algorithm confusion). */
  signHs256(claims?: Record<string, unknown>): Promise<string>;
}

export async function makeTestJwks(): Promise<TestJwks> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-kid";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const base = (claims: Record<string, unknown>) => ({
    iss: `https://securetoken.google.com/${TEST_PROJECT}`,
    aud: TEST_PROJECT,
    sub: "user-1",
    email: "u@example.com",
    email_verified: true,
    auth_time: TEST_NOW_SEC - 60,
    ...claims,
  });
  const signWith = (key: CryptoKey, claims: Record<string, unknown>, expiresIn: string) => {
    const jwt = new SignJWT(base(claims))
      .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
      .setIssuedAt();
    // An explicit numeric exp (the expired-token case) must survive; setExpirationTime would overwrite it.
    if (typeof claims.exp !== "number") jwt.setExpirationTime(expiresIn);
    return jwt.sign(key);
  };
  return {
    getKey,
    sign: (claims = {}, opts = {}) => signWith(privateKey, claims, opts.expiresIn ?? "1h"),
    signWithForeignKey: (claims = {}) => signWith(foreign.privateKey, claims, "1h"),
    unsecured: async (claims = {}) =>
      new UnsecuredJWT(base(claims)).setIssuedAt().setExpirationTime("1h").encode(),
    signHs256: async (claims = {}) =>
      new SignJWT(base(claims))
        .setProtectedHeader({ alg: "HS256", kid: "test-kid" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("not-a-secret-anyone-can-guess")),
  };
}
