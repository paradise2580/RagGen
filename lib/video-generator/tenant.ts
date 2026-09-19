// lib/video-generator/tenant.ts
//
// Workspace resolution for local mode, where there is exactly one workspace and the
// answer is constant. Kept as a function so the session endpoint and the gate have a
// single call site to swap when multi-workspace routing applies (see lib/rag-auth.ts).

import { STANDALONE_TENANT_ID } from "@/lib/tenant/tenant-db";

export type VideoGeneratorWorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export async function resolveVideoGeneratorTenant(
  _userId: string,
  _userRole?: string,
): Promise<{ tenantId: string; role: VideoGeneratorWorkspaceRole } | null> {
  return { tenantId: STANDALONE_TENANT_ID, role: "OWNER" };
}
