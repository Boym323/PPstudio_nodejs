import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public";
process.env.NEXT_PUBLIC_APP_URL ??= "https://example.com";
process.env.ADMIN_SESSION_SECRET ??= "test-secret-value-with-at-least-32-chars";
process.env.ADMIN_OWNER_EMAIL ??= "owner@example.com";
process.env.EMAIL_DELIVERY_MODE ??= "log";

const dbTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

dbTest("souběžné přidání dvou médií do galerie zachová obě vazby s unikátním pořadím", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { createServiceGalleryMediaWithRetry } = await import("./service-media-mutations");
  const suffix = randomUUID();
  const category = await prisma.serviceCategory.create({ data: { name: "Audit galerie", slug: `gallery-${suffix}` } });
  const service = await prisma.service.create({
    data: { categoryId: category.id, name: "Audit galerie", slug: `gallery-${suffix}`, durationMinutes: 60 },
  });
  const assets = await Promise.all([0, 1].map((index) => prisma.mediaAsset.create({
    data: {
      originalFilename: `${suffix}-${index}.jpg`, fileName: `${suffix}-${index}.jpg`,
      mimeType: "image/jpeg", extension: "jpg", size: 1,
      storagePath: `test/gallery-${suffix}-${index}.jpg`, url: `/test/gallery-${suffix}-${index}.jpg`,
    },
  })));

  try {
    // Obě operace nejprve přečtou stejné pořadí; retry pak musí řešit skutečnou
    // chybu PostgreSQL adaptéru, nikoli pouze ručně sestavený mock P2002.
    let initialReads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const db = {
      serviceMedia: {
        aggregate: async (...args: Parameters<typeof prisma.serviceMedia.aggregate>) => {
          const result = await prisma.serviceMedia.aggregate(...args);
          initialReads += 1;
          if (initialReads === 2) release();
          await bothRead;
          return result;
        },
        upsert: prisma.serviceMedia.upsert.bind(prisma.serviceMedia),
      },
    };
    const results = await Promise.allSettled(assets.map((asset) =>
      createServiceGalleryMediaWithRetry(service.id, asset.id, db as typeof prisma),
    ));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    const rows = await prisma.serviceMedia.findMany({ where: { serviceId: service.id }, orderBy: { sortOrder: "asc" } });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.sortOrder), [0, 10]);
    assert.deepEqual(rows.map((row) => row.mediaAssetId).sort(), assets.map((asset) => asset.id).sort());
  } finally {
    await prisma.serviceMedia.deleteMany({ where: { serviceId: service.id } });
    await prisma.service.delete({ where: { id: service.id } });
    await prisma.serviceCategory.delete({ where: { id: category.id } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } });
  }
});
