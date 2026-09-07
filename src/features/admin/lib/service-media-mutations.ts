import "server-only";

import { ServiceMediaRole } from "@/generated/prisma/browser";
import { prisma } from "@/lib/prisma";

function isServiceGallerySortOrderConflict(error: unknown) {
  if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) return false;
  const meta = "meta" in error ? error.meta as {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
  } | undefined : undefined;
  const target = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target;
  const fields = (Array.isArray(target) ? target : [target]).map((field) =>
    typeof field === "string" ? field.replaceAll('"', "") : field,
  );

  return (
    (fields.length === 1 && fields[0] === "ServiceMedia_serviceId_role_sortOrder_key")
    || (fields.length === 3 && ["serviceId", "role", "sortOrder"].every((field) => fields.includes(field)))
  );
}

export async function createServiceGalleryMediaWithRetry(serviceId: string, mediaAssetId: string, db = prisma) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const last = await db.serviceMedia.aggregate({
        where: { serviceId, role: ServiceMediaRole.GALLERY },
        _max: { sortOrder: true },
      });
      return await db.serviceMedia.upsert({
        where: { serviceId_role_mediaAssetId: { serviceId, role: ServiceMediaRole.GALLERY, mediaAssetId } },
        create: { serviceId, mediaAssetId, role: ServiceMediaRole.GALLERY, sortOrder: (last._max.sortOrder ?? -10) + 10 },
        update: {},
      });
    } catch (error) {
      if (!isServiceGallerySortOrderConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error('SERVICE_GALLERY_CREATE_FAILED');
}
