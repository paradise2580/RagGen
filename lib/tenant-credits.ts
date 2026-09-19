import type { PrismaClient } from "@/prisma/generated/tenant";

/**
 * Tenant-scoped credit helpers for server-side flows that already hold a tenant
 * Prisma client (e.g. the AI Readiness / AI Visibility scan routes).
 *
 * Mirrors the logic in `app/api/credits/consume/route.ts`: there is a single
 * `organizationCredit` row per tenant DB; spend `balance` first, then
 * `addonBalance`. Throws `InsufficientTenantCreditsError` when the combined
 * balance can't cover the amount.
 */

/** Credit cost per scan (Readiness 10, Visibility 25). */
export const READINESS_SCAN_CREDIT_COST = 10;
export const VISIBILITY_SCAN_CREDIT_COST = 25;
/** Credit cost for generating an AI Visibility action plan (Improve tab). */
export const VISIBILITY_RECS_CREDIT_COST = 3;
/** Credit cost for one video generation. */
export const VIDEO_GENERATOR_VIDEO_CREDIT_COST = 25;
/**
 * Credit cost per Kling virtual try-on image, charged on the Personalized Model
 * flow (one try-on render per uploaded model pose). Reserved up front alongside
 * the base video cost and refunded together on failure (see the create route +
 * pipeline fail()). One image gen ≈ far cheaper than a video, so this is small.
 */
export const VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST = 3;

export class InsufficientTenantCreditsError extends Error {
  constructor(public remaining: number) {
    super("INSUFFICIENT_CREDITS");
    this.name = "INSUFFICIENT_CREDITS";
  }
}

type TenantDb = Pick<PrismaClient, "$transaction" | "organizationCredit">;

/**
 * Atomically consume `amount` credits from the tenant's single credit row
 * (balance first, then addonBalance). Returns the remaining total balance.
 * Throws InsufficientTenantCreditsError if the tenant can't afford it.
 */
export async function consumeTenantCredits(db: TenantDb, amount: number): Promise<number> {
  if (amount <= 0) {
    const row = await db.organizationCredit.findFirst({ select: { balance: true, addonBalance: true } });
    return (row?.balance ?? 0) + (row?.addonBalance ?? 0);
  }

  return db.$transaction(async (tx) => {
    // The single credit row is provisioned at tenant creation
    // (lib/tenant/provision-core.ts). A missing row means zero balance.
    const row = await tx.organizationCredit.findFirst({
      select: { id: true, balance: true, addonBalance: true },
    });
    if (!row) {
      throw new InsufficientTenantCreditsError(0);
    }

    const totalAvailable = (row.balance || 0) + (row.addonBalance || 0);
    if (totalAvailable < amount) {
      throw new InsufficientTenantCreditsError(totalAvailable);
    }

    const fromBalance = Math.min(row.balance || 0, amount);
    const fromAddon = amount - fromBalance;

    const updated = await tx.organizationCredit.update({
      where: { id: row.id },
      data: {
        balance: { decrement: fromBalance },
        addonBalance: { decrement: fromAddon },
      },
      select: { balance: true, addonBalance: true },
    });

    return (updated.balance || 0) + (updated.addonBalance || 0);
  });
}

/**
 * Refund `amount` credits back to the tenant's balance (used when a scan fails
 * after credits were consumed). Best-effort — never throws.
 */
export async function refundTenantCredits(db: TenantDb, amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    const row = await db.organizationCredit.findFirst({ select: { id: true } });
    if (!row) return;
    await db.organizationCredit.update({
      where: { id: row.id },
      data: { balance: { increment: amount } },
    });
  } catch (e) {
    console.error("[tenant-credits] refund failed:", e);
  }
}
