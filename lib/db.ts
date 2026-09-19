// lib/db.ts
//
// Prisma singleton for the primary database (TENANT_DATABASE_URL). Additional
// workspaces are routed to their own database by lib/tenant/tenant-db.ts; this client
// serves the primary workspace and the identity directory.

import { PrismaClient } from "@/prisma/generated/tenant";
import { resolveTenantDatabaseUrl } from "@/lib/db-url.cjs";

const g = global as unknown as { __VG_PRISMA__?: PrismaClient };

// The connection URL is composed here rather than read straight from TENANT_DATABASE_URL:
// the password is kept on its own in DB_PASSWORD and spliced in (see lib/db-url.cjs). Passing
// it explicitly means this client is correct even if nothing pre-populated the environment.
export const prisma: PrismaClient =
  g.__VG_PRISMA__ ??
  new PrismaClient({ log: ["warn", "error"], datasourceUrl: resolveTenantDatabaseUrl() });

if (process.env.NODE_ENV !== "production") g.__VG_PRISMA__ = prisma;

export default prisma;
