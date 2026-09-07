import "server-only";

import { randomUUID } from "node:crypto";
import { type Prisma } from "@/generated/prisma/client";
import { type AdminArea } from "@/config/navigation";

export async function persistAutoLunchDayMode(
  tx: Prisma.TransactionClient,
  input: { area: AdminArea; dateKey: string; mode: "AUTO" | "OFF"; actor: { id: string; role: "OWNER" | "SALON" } },
) {
    const previous = await tx.autoLunchDayOverride.findUnique({ where: { dateKey: input.dateKey } });

    if ((input.mode === "OFF") === Boolean(previous)) {
      return false;
    }

    if (input.mode === "OFF") {
      await tx.autoLunchDayOverride.upsert({
        where: { dateKey: input.dateKey },
        create: { dateKey: input.dateKey, updatedByUserId: input.actor.id },
        update: { updatedByUserId: input.actor.id },
      });
    } else {
      await tx.autoLunchDayOverride.delete({ where: { dateKey: input.dateKey } });
    }

    await tx.availabilityAuditEvent.create({ data: {
      actorUserId: input.actor.id, actorRole: input.actor.role, adminArea: input.area, dateKey: input.dateKey,
      operation: input.mode === "OFF" ? "ADD" : "REMOVE", source: "auto-lunch-day-override-v1", operationId: randomUUID(),
      before: { dayLunchMode: previous ? "OFF" : "AUTO" }, after: { dayLunchMode: input.mode },
      createdSlots: [], archivedOrRemovedSlots: [],
    } });

    return true;
}

