import { notFound } from "next/navigation";

import { AdminEmailLogDetailPage } from "@/features/admin/components/admin-email-log-detail-page";
import { getEmailLogDetailData } from "@/features/admin/lib/data/email-logs";
import { requireAdminArea } from "@/lib/auth/session";

type AdminEmailLogDetailRouteProps = {
  params: Promise<{
    emailLogId: string;
  }>;
  searchParams: Promise<{
    flash?: string;
  }>;
};

export default async function AdminEmailLogDetailRoute({
  params,
  searchParams,
}: AdminEmailLogDetailRouteProps) {
  await requireAdminArea("owner");

  const { emailLogId } = await params;
  const { flash } = await searchParams;
  const data = await getEmailLogDetailData(emailLogId);

  if (!data) {
    notFound();
  }

  const flashMessage = getFlashMessage(flash);

  return <AdminEmailLogDetailPage data={data} flashMessage={flashMessage} />;
}

function getFlashMessage(flash?: string) {
  switch (flash) {
    case "job-changed":
      return "Stav e-mailu se mezitím změnil. Akce nebyla provedena; zkontrolujte aktuální stav.";
    case "retry-success":
      return "Ruční retry byl odeslaný do fronty. Worker ho zpracuje při dalším průchodu.";
    case "release-success":
      return "Zaseknutý job byl uvolněný a vrácený zpět do fronty.";
    case "resend-success":
      return "Do fronty byl založený nový pokus o odeslání tohoto e-mailu.";
    case "resend-missing-recipient":
      return "U aktuálního kontaktu není vyplněný e-mail, takže resend nelze založit.";
    case "resend-client-missing-recipient":
      return "Klientka nemá aktuální e-mailovou adresu.";
    case "incident-closed":
      return "Incident byl ručně uzavřený. Historie e-mailu zůstala beze změny.";
    default:
      return undefined;
  }
}
