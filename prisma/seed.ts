// prisma/seed.ts — `npm run db:seed`
//
// Bootstrap:
//   1. the single OrganizationCredit row generations debit (nothing else creates it, and
//      a missing row means "0 credits" — i.e. every generation would 402);
//   2. one demo product so the studio's picker isn't empty out of the box.
//
// Idempotent: re-running tops credits back up to CREDITS and leaves the demo product alone.

import { PrismaClient } from "./generated/tenant";

const prisma = new PrismaClient();

const CREDITS = Number(process.env.SEED_CREDITS ?? 1000);

const DEMO_IMAGE =
  process.env.SEED_PRODUCT_IMAGE ??
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=2000";

async function main() {
  const credit = await prisma.organizationCredit.findFirst({ select: { id: true } });
  if (credit) {
    await prisma.organizationCredit.update({
      where: { id: credit.id },
      data: { balance: CREDITS },
    });
    console.log(`[seed] credits reset to ${CREDITS}`);
  } else {
    await prisma.organizationCredit.create({
      data: {
        tenantId: process.env.VIDEO_GENERATOR_TENANT_ID || "standalone",
        balance: CREDITS,
        isTrial: false,
      },
    });
    console.log(`[seed] credit row created with ${CREDITS}`);
  }

  const integrationId = "standalone";
  const externalProductId = "demo-1";
  const existing = await prisma.productRecord.findUnique({
    where: { integrationId_externalProductId: { integrationId, externalProductId } },
    select: { id: true },
  });
  if (existing) {
    console.log(`[seed] demo product already present (${existing.id})`);
  } else {
    const p = await prisma.productRecord.create({
      data: {
        integrationId,
        externalProductId,
        platform: "manual",
        title: "Demo Sneaker",
        // "manual" platform payload: images is a plain string[] (see
        // lib/video-generator/product-images.ts).
        payload: {
          title: "Demo Sneaker",
          description: "A demo product so the studio has something to generate from.",
          vendor: "Demo Brand",
          images: [DEMO_IMAGE],
        },
      },
      select: { id: true },
    });
    console.log(`[seed] demo product created (${p.id})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
