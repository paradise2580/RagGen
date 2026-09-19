// auth.ts
//
// Local-mode auth shim. When RAG_AUTH_MODE is not "required", the app runs
// single-workspace and single-identity, so `auth()` returns a fixed local identity
// instead of consulting a session store. Real multi-user login lives in lib/rag-auth.ts
// and takes over when RAG_AUTH_MODE=required.
//
// Optional shared-secret gate: set VIDEO_GENERATOR_API_TOKEN and every request must carry
// it as `Authorization: Bearer <token>` or `x-api-token: <token>`. Leave it unset for local
// use (nothing to log into). This is the ONLY access control here — if you expose this app
// publicly, set the token (and/or put it behind your own proxy auth).

export interface StandaloneUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface StandaloneSession {
  user: StandaloneUser;
}

export async function auth(): Promise<StandaloneSession> {
  return {
    user: {
      id: process.env.VIDEO_GENERATOR_USER_ID || "local-user",
      email: process.env.VIDEO_GENERATOR_USER_EMAIL || "local@example.invalid",
      name: process.env.VIDEO_GENERATOR_USER_NAME || "Local User",
      // OWNER-equivalent: the standalone operator always has full access.
      role: "USER",
    },
  };
}

/** True when an API token is configured (requests must then present it). */
export function apiTokenRequired(): boolean {
  return !!process.env.VIDEO_GENERATOR_API_TOKEN;
}

/** Verify the optional shared secret on an incoming request. */
export function apiTokenValid(req: Request): boolean {
  const expected = process.env.VIDEO_GENERATOR_API_TOKEN;
  if (!expected) return true;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const header = req.headers.get("x-api-token")?.trim();
  return bearer === expected || header === expected;
}

export default auth;
