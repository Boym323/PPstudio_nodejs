"use server";

import { EmailAudience, EmailIncidentManualResolutionReason, EmailLogStatus } from "@/generated/prisma/browser";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createResendEmailLog } from "@/features/admin/actions/email-log-resend";
import { requireAdminArea } from "@/lib/auth/session";
import { manuallyResolveEmailIncident } from "@/lib/email/incident-resolution";
import { prisma } from "@/lib/prisma";
import { requeuePendingEmailLog } from "@/features/admin/lib/email-log-requeue";
import { getEmailBrandingSettings } from "@/lib/site-settings";

const emailLogActionSchema = z.object({
  emailLogId: z.string().trim().min(1).max(64),
});

const closeEmailIncidentSchema = emailLogActionSchema.extend({
  reason: z.nativeEnum(EmailIncidentManualResolutionReason),
  note: z.string().trim().max(300).optional(),
}).superRefine((value, context) => {
  if (value.reason === EmailIncidentManualResolutionReason.OTHER && !value.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "Doplňte krátkou poznámku." });
  }
});

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

async function loadOwnerEmailLog(formData: FormData) {
  await requireAdminArea("owner");

  const parsed = emailLogActionSchema.safeParse({
    emailLogId: readFormString(formData, "emailLogId"),
  });

  if (!parsed.success) {
    return null;
  }

  return prisma.emailLog.findUnique({
    where: { id: parsed.data.emailLogId },
    include: {
      client: {
        select: {
          id: true,
          email: true,
        },
      },
      booking: {
        select: {
          id: true,
          clientEmailSnapshot: true,
        },
      },
    },
  });
}

type OwnerEmailLog = NonNullable<Awaited<ReturnType<typeof loadOwnerEmailLog>>>;

async function createOwnerResendEmailLog(emailLog: OwnerEmailLog) {
  const emailBranding = emailLog.audience === EmailAudience.ADMIN
    ? await getEmailBrandingSettings()
    : null;
  return createResendEmailLog({
    emailLog,
    adminNotificationEmail: emailBranding?.notificationAdminEmail,
  });
}

function revalidateResendPaths(sourceEmailLogId: string, resendEmailLogId: string) {
  revalidatePath("/admin/email-logy");
  revalidatePath(`/admin/email-logy/${sourceEmailLogId}`);
  revalidatePath(`/admin/email-logy/${resendEmailLogId}`);
}

function getMissingResendRecipientFlash(emailLog: OwnerEmailLog) {
  return emailLog.audience === EmailAudience.CLIENT && emailLog.client !== null
    ? "resend-client-missing-recipient"
    : "resend-missing-recipient";
}

export async function retryEmailLogAction(formData: FormData) {
  const emailLog = await loadOwnerEmailLog(formData);

  if (!emailLog || emailLog.status === EmailLogStatus.SENT || emailLog.processingStartedAt) {
    redirect("/admin/email-logy");
  }

  // Terminální failure je neměnný auditní záznam. Další ruční pokus proto
  // vždy zakládá nový explicitní resend log místo návratu původního do fronty.
  if (emailLog.status === EmailLogStatus.FAILED) {
    const createdEmailLog = await createOwnerResendEmailLog(emailLog);
    if (!createdEmailLog) {
      redirect(`/admin/email-logy/${emailLog.id}?flash=${getMissingResendRecipientFlash(emailLog)}`);
    }

    revalidateResendPaths(emailLog.id, createdEmailLog.id);
    redirect(`/admin/email-logy/${createdEmailLog.id}?flash=resend-success`);
  }

  const requeued = await requeuePendingEmailLog(emailLog, true);

  revalidatePath("/admin/email-logy");
  revalidatePath(`/admin/email-logy/${emailLog.id}`);
  redirect(`/admin/email-logy/${emailLog.id}?flash=${requeued ? "retry-success" : "job-changed"}`);
}

export async function releaseStuckEmailLogAction(formData: FormData) {
  const emailLog = await loadOwnerEmailLog(formData);

  if (
    !emailLog ||
    emailLog.status !== EmailLogStatus.PENDING ||
    emailLog.processingStartedAt === null
  ) {
    redirect("/admin/email-logy");
  }

  const requeued = await requeuePendingEmailLog(emailLog, false);

  revalidatePath("/admin/email-logy");
  revalidatePath(`/admin/email-logy/${emailLog.id}`);
  redirect(`/admin/email-logy/${emailLog.id}?flash=${requeued ? "release-success" : "job-changed"}`);
}

export async function resendEmailLogAction(formData: FormData) {
  const emailLog = await loadOwnerEmailLog(formData);

  if (!emailLog || emailLog.processingStartedAt) {
    redirect("/admin/email-logy");
  }

  const createdEmailLog = await createOwnerResendEmailLog(emailLog);
  if (!createdEmailLog) {
    redirect(`/admin/email-logy/${emailLog.id}?flash=${getMissingResendRecipientFlash(emailLog)}`);
  }

  revalidateResendPaths(emailLog.id, createdEmailLog.id);
  redirect(`/admin/email-logy/${createdEmailLog.id}?flash=resend-success`);
}

export async function closeEmailIncidentAction(formData: FormData) {
  const session = await requireAdminArea("owner");
  const parsed = closeEmailIncidentSchema.safeParse({
    emailLogId: readFormString(formData, "emailLogId"),
    reason: readFormString(formData, "reason"),
    note: readFormString(formData, "note"),
  });

  if (!parsed.success) {
    redirect("/admin/email-logy");
  }

  const result = await manuallyResolveEmailIncident({
    emailLogId: parsed.data.emailLogId,
    actorUserId: session.sub,
    actorRole: session.role,
    reason: parsed.data.reason,
    note: parsed.data.note || null,
  });

  if (result.outcome === "missing" || result.outcome === "forbidden" || result.outcome === "not_an_incident") {
    redirect("/admin/email-logy");
  }

  revalidatePath("/admin/email-logy");
  revalidatePath(`/admin/email-logy/${parsed.data.emailLogId}`);
  if (result.rootId !== parsed.data.emailLogId) {
    revalidatePath(`/admin/email-logy/${result.rootId}`);
  }
  redirect(`/admin/email-logy/${parsed.data.emailLogId}?flash=incident-closed`);
}
