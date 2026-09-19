// scripts/add-product.ts
//
// Add a source product (the input images generations run from) without an integration:
//
//   npx tsx scripts/add-product.ts "Blue Hoodie" https://cdn/img1.jpg https://cdn/img2.jpg
//
// This is how you feed the product picker without a storefront integration. Images may
// be any publicly fetchable URLs — the Kling step takes a URL directly.

import { PrismaClient } from "../prisma/generated/tenant";

const prisma = new PrismaClient();

async function main() {
  const [name, ...images] = process.argv.slice(2);
  if (!name || images.length === 0) {
    console.error('usage: tsx scripts/add-product.ts "<name>" <imageUrl> [imageUrl...]');
    process.exit(1);
  }

  const externalProductId = `manual-${Date.now()}`;
  const product = await prisma.productRecord.create({
    data: {
      integrationId: "standalone",
      externalProductId,
      platform: "manual",
      title: name,
      payload: { title: name, images },
    },
    select: { id: true, title: true },
  });

  console.log(`created product ${product.id} (${product.title}) with ${images.length} image(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
