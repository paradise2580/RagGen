import { resolveIdentity, sameOrigin } from "@/lib/rag-auth";
// lib/video-generator/context.ts
//
// The per-request gate every /api/video-generator/* handler runs first. It resolves the
// caller's identity and workspace, then hands the handler a ready Prisma client.
//
// The gate applies, in order:
//   - the feature kill-switch (isVideoGeneratorEnabled);
//   - the optional shared-secret API token (see auth.ts);
//   - the session + membership check (lib/rag-auth.ts) or, in local mode, the fixed
//     local identity;
//   - the workspace's Prisma client.

import { NextResponse, type NextRequest } from "next/server";
import { auth, apiTokenValid } from "@/auth";
import { isVideoGeneratorEnabled } from "@/lib/video-generator";
import {
  resolveTenantClientOr404,
  STANDALONE_TENANT_ID,
} from "@/lib/tenant/tenant-db";

export type TenantClient = Awaited<ReturnType<typeof resolveTenantClientOr404>>;

export interface VideoGeneratorContext {
  db: TenantClient;
  userId: string;
  /** Always the single standalone workspace id (scopes S3 keys). */
  tenantId?: string;
  role?: string;
}

export type VideoGeneratorGate =
  | { ok: true; ctx: VideoGeneratorContext }
  | { ok: false; response: NextResponse };

/**
 * Workspace id carried by the request. In local mode there is a single workspace, so a
 * client-supplied id is ignored (it cannot select another database — there is only
 * one). Multi-workspace routing is enforced from the session instead, in lib/rag-auth.ts.
 */
export function tenantIdFromRequest(_req: NextRequest): string | undefined {
  return STANDALONE_TENANT_ID;
}

/**
 * Resolve and authorize the request context. Use at the top of every handler:
 *
 *   const gate = await gateVideoGenerator(req);
 *   if (!gate.ok) return gate.response;
 *   const { db, userId, tenantId } = gate.ctx;
 */
export async function gateVideoGenerator(
  req: NextRequest,
  _opts: { tenantId?: string } = {},
): Promise<VideoGeneratorGate> {
  // Kill-switch: behave as if the feature doesn't exist when shipped dark.
  if (!isVideoGeneratorEnabled()) {
    return { ok: false, response: NextResponse.json({ message: "Not found" }, { status: 404 }) };
  }

  if (!apiTokenValid(req)) {
    return { ok: false, response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }

  if (req.method !== "GET" && !sameOrigin(req)) return { ok: false, response: NextResponse.json({ message: "Origin not allowed" }, { status: 403 }) };
  const identity = await resolveIdentity(req);
  if (!identity) return { ok: false, response: NextResponse.json({ message: "Unauthorized workspace" }, { status: 401 }) };
  const db = await resolveTenantClientOr404({ tenantId: identity.workspaceId });

  return {
    ok: true,
    ctx: {
      db,
      userId: identity.user.id,
      tenantId: identity.workspaceId,
      role: identity.role,
    },
  };
}

/** Small helpers for consistent JSON errors matching the SPA's parseError(). */
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}
