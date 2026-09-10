import { BookingSource, BookingStatus, Prisma } from "@/generated/prisma/client";

import type { AdminArea } from "@/config/navigation";
import { getAdminBookingActionOptions, getAdminBookingHref } from "@/features/admin/lib/booking/booking-display";
import { bookingListSearchParamsSchema, type BookingListSourceValue, type BookingListStatusValue, type BookingListViewValue } from "@/features/admin/lib/admin-booking-list-validation";
import { addDays, formatDateKey, getDayBounds } from "@/features/admin/lib/admin-slots/time";
import { getAdminBookingAvailabilityCatalog } from "@/features/booking/lib/booking-admin-availability";
import { buildClientPhoneHref, formatClientPhoneForDisplay } from "@/features/booking/lib/client-phone";
import { getBookingStatusLabel } from "@/features/booking/lib/booking-status-presentation";
import { prisma } from "@/lib/prisma";

const formatDate = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" });
const formatTime = new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
const defaultReservationLimit = 30;
const reservationLimitStep = 30;
const reservationLimitMax = 200;
const activeBookingStatuses = [BookingStatus.PENDING, BookingStatus.CONFIRMED] as const;

function isActiveBookingStatus(status: BookingStatus) {
  return status === BookingStatus.PENDING || status === BookingStatus.CONFIRMED;
}

function formatDateLabel(value: Date | null | undefined): string {
  if (!value) return "Bez data";
  return formatDate.format(value);
}

export type ReservationsDashboardData = {
  currentPath: string;
  filters: {
    view: BookingListViewValue;
    query: string;
    status: BookingListStatusValue;
    source: BookingListSourceValue;
    dateFrom: string;
    dateTo: string;
    limit: number;
    hasActiveFilters: boolean;
  };
  views: Array<{ key: BookingListViewValue; label: string; count: number; href: string; isActive: boolean }>;
  attention: { pendingCount: number; needsClosureCount: number; totalCount: number; href: string };
  summary: {
    totalCount: number;
    visibleCount: number;
    emptyState: "today" | "upcoming" | "attention" | "history" | "all";
    showMoreHref: string | null;
  };
  sections: Array<{
    key: string;
    label: string;
    detail: string;
    totalCount: number;
    items: Array<{
      id: string;
      title: string;
      serviceName: string;
      scheduledStartsAtIso: string;
      scheduledDateLabel: string;
      scheduledDateShortLabel: string;
      scheduledTimeLabel: string;
      status: BookingStatus;
      statusLabel: string;
      primaryContactLabel: string | null;
      primaryContactHref: string | null;
      href: string;
      availableActions: ReturnType<typeof getAdminBookingActionOptions>;
      isMuted: boolean;
      isPending: boolean;
      needsClosure: boolean;
    }>;
  }>;
  manualBooking: {
    services: Array<{
      id: string;
      categoryName: string;
      name: string;
      durationMinutes: number;
      cleanupBlockMinutes: number;
      priceFromCzk: number | null;
    }>;
    slots: Awaited<ReturnType<typeof getAdminBookingAvailabilityCatalog>>["slots"];
    scheduleOptimization: Awaited<ReturnType<typeof getAdminBookingAvailabilityCatalog>>["scheduleOptimization"];
    clients: Array<{
      id: string;
      fullName: string;
      email: string;
      phone: string | null;
      internalNote: string | null;
      isActive: boolean;
    }>;
  };
};

function normalizeReservationsSearchParams(
  searchParams?: Record<string, string | string[] | undefined>,
) {
  const parsed = bookingListSearchParamsSchema.safeParse({
    query: typeof searchParams?.query === "string" ? searchParams.query : undefined,
    status: typeof searchParams?.status === "string" ? searchParams.status : undefined,
    source: typeof searchParams?.source === "string" ? searchParams.source : undefined,
    view: typeof searchParams?.view === "string" ? searchParams.view : undefined,
    stat: typeof searchParams?.stat === "string" ? searchParams.stat : undefined,
    dateFrom: typeof searchParams?.dateFrom === "string" ? searchParams.dateFrom : undefined,
    dateTo: typeof searchParams?.dateTo === "string" ? searchParams.dateTo : undefined,
    showPast: typeof searchParams?.showPast === "string" ? searchParams.showPast : undefined,
    limit: typeof searchParams?.limit === "string" ? searchParams.limit : undefined,
  });

  const defaults = {
    query: "",
    status: "all" as BookingListStatusValue,
    source: "all" as BookingListSourceValue,
    view: "today" as BookingListViewValue,
    dateFrom: "",
    dateTo: "",
    limit: defaultReservationLimit,
  };

  if (!parsed.success) {
    return defaults;
  }

  const dateFrom = parsed.data.dateFrom ?? "";
  const dateTo = parsed.data.dateTo ?? "";
  const query = parsed.data.query ?? defaults.query;
  const requestedView = parsed.data.view ?? legacyView(parsed.data.stat, parsed.data.showPast) ?? defaults.view;

  return {
    // Hledání klientky je globální; záložka „Nadcházející“ nesmí schovat její starší rezervace.
    query,
    status: parsed.data.status ?? defaults.status,
    source: parsed.data.source ?? defaults.source,
    view: query ? "all" : requestedView,
    dateFrom: dateFrom <= dateTo || !dateFrom || !dateTo ? dateFrom : dateTo,
    dateTo: dateFrom <= dateTo || !dateFrom || !dateTo ? dateTo : dateFrom,
    limit: parsed.data.limit ?? defaults.limit,
  };
}

function legacyView(stat?: string, showPast?: string): BookingListViewValue | null {
  if (stat === "needs_closure" || stat === "pending") return "attention";
  if (stat === "upcoming" || stat === "confirmed") return "upcoming";
  if (stat === "completed" || stat === "cancelled" || showPast === "1") return "history";
  return null;
}


function parseDateFilterBoundary(value: string, endOfDay = false) {
  if (!value) {
    return null;
  }

  const { startsAt, endsAt } = getDayBounds(value);
  return endOfDay ? endsAt : startsAt;
}

function bookingStatusFromFilter(status: BookingListStatusValue) {
  switch (status) {
    case "pending":
      return BookingStatus.PENDING;
    case "confirmed":
      return BookingStatus.CONFIRMED;
    case "completed":
      return BookingStatus.COMPLETED;
    case "cancelled":
      return BookingStatus.CANCELLED;
    case "no_show":
      return BookingStatus.NO_SHOW;
    default:
      return null;
  }
}

function bookingSourceFromFilter(source: BookingListSourceValue) {
  switch (source) {
    case "web":
      return BookingSource.WEB;
    case "phone":
      return BookingSource.PHONE;
    case "instagram":
      return BookingSource.INSTAGRAM;
    case "in_person":
      return BookingSource.IN_PERSON;
    case "other":
      return BookingSource.OTHER;
    default:
      return null;
  }
}

function buildReservationsWhere(
  filters: ReturnType<typeof normalizeReservationsSearchParams>,
): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = {};
  const statusFilter = bookingStatusFromFilter(filters.status);
  const sourceFilter = bookingSourceFromFilter(filters.source);
  const dateFrom = parseDateFilterBoundary(filters.dateFrom);
  const dateTo = parseDateFilterBoundary(filters.dateTo, true);
  const scheduledStartsAtFilter: Prisma.DateTimeFilter = {};

  if (filters.query) {
    where.OR = [
      { clientNameSnapshot: { contains: filters.query, mode: "insensitive" } },
      { clientEmailSnapshot: { contains: filters.query, mode: "insensitive" } },
      { clientPhoneSnapshot: { contains: filters.query, mode: "insensitive" } },
      { serviceNameSnapshot: { contains: filters.query, mode: "insensitive" } },
    ];
  }

  if (statusFilter) {
    where.status = statusFilter;
  }

  if (sourceFilter) {
    where.source = sourceFilter;
  }

  if (dateFrom) {
    scheduledStartsAtFilter.gte = dateFrom;
  }

  if (dateTo) {
    scheduledStartsAtFilter.lt = dateTo;
  }

  if (scheduledStartsAtFilter.gte || scheduledStartsAtFilter.lt) {
    where.scheduledStartsAt = scheduledStartsAtFilter;
  }

  return where;
}

function startOfToday() {
  return getDayBounds(formatDateKey(new Date())).startsAt;
}

function startOfTomorrow(todayStart: Date) {
  return addDays(todayStart, 1);
}

function buildReservationsHref(
  currentPath: string,
  filters: Pick<ReservationsDashboardData["filters"], "view" | "query" | "status" | "source" | "dateFrom" | "dateTo">,
  next: Partial<ReservationsDashboardData["filters"]> = {},
) {
  const values = { ...filters, ...next };
  const params = new URLSearchParams();
  params.set("view", values.view);
  if (values.query) params.set("query", values.query);
  if (values.status !== "all") params.set("status", values.status);
  if (values.source !== "all") params.set("source", values.source);
  if (values.dateFrom) params.set("dateFrom", values.dateFrom);
  if (values.dateTo) params.set("dateTo", values.dateTo);
  if (next.limit && next.limit !== defaultReservationLimit) params.set("limit", String(next.limit));
  return `${currentPath}?${params.toString()}`;
}

function viewWhere(view: BookingListViewValue, todayStart: Date, tomorrowStart: Date, now: Date): Prisma.BookingWhereInput {
  switch (view) {
    case "today": return { scheduledStartsAt: { gte: todayStart, lt: tomorrowStart } };
    case "upcoming": return { status: { in: [...activeBookingStatuses] }, scheduledStartsAt: { gte: tomorrowStart } };
    case "attention": return { OR: [{ status: BookingStatus.PENDING }, { status: { in: [...activeBookingStatuses] }, scheduledEndsAt: { lt: now } }] };
    case "history": return { status: { in: [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.NO_SHOW] } };
    case "all": return {};
  }
}

function reservationOrder(view: BookingListViewValue): Prisma.BookingOrderByWithRelationInput[] {
  return [{ scheduledStartsAt: view === "history" || view === "all" ? "desc" : "asc" }, { id: "asc" }];
}

function buildBookingContacts(booking: { clientPhoneSnapshot: string | null; clientEmailSnapshot: string }) {
  const phone = booking.clientPhoneSnapshot?.trim();
  if (phone) return { primaryContactLabel: formatClientPhoneForDisplay(phone), primaryContactHref: buildClientPhoneHref(phone) };
  const email = booking.clientEmailSnapshot.trim();
  return { primaryContactLabel: email || null, primaryContactHref: email ? `mailto:${email}` : null };
}

export async function getReservationsData(area: AdminArea, searchParams?: Record<string, string | string[] | undefined>): Promise<ReservationsDashboardData> {
  const now = new Date();
  const todayStart = startOfToday();
  const tomorrowStart = startOfTomorrow(todayStart);
  const filters = normalizeReservationsSearchParams(searchParams);
  const currentPath = area === "owner" ? "/admin/rezervace" : "/admin/provoz/rezervace";
  const detailWhere = buildReservationsWhere(filters);
  const activeWhere = viewWhere(filters.view, todayStart, tomorrowStart, now);
  const where: Prisma.BookingWhereInput = { AND: [detailWhere, activeWhere] };
  const viewKeys: BookingListViewValue[] = ["today", "upcoming", "attention", "history", "all"];
  const viewLabels: Record<BookingListViewValue, string> = { today: "Dnes", upcoming: "Nadcházející", attention: "Pozornost", history: "Historie", all: "Vše" };
  const [totalCount, bookings, pendingCount, needsClosureCount, bookingCatalog, ...viewCounts] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({ where, orderBy: reservationOrder(filters.view), take: Math.min(filters.limit, reservationLimitMax), include: { client: { select: { fullName: true } } } }),
    prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
    prisma.booking.count({ where: { status: { in: [...activeBookingStatuses] }, scheduledEndsAt: { lt: now } } }),
    getAdminBookingAvailabilityCatalog(),
    ...viewKeys.map((view) => prisma.booking.count({ where: viewWhere(view, todayStart, tomorrowStart, now) })),
  ]);
  const rows = bookings.map((booking) => {
    const contacts = buildBookingContacts(booking);
    return {
      id: booking.id, title: booking.client?.fullName ?? booking.clientNameSnapshot, serviceName: booking.serviceNameSnapshot,
      scheduledStartsAtIso: booking.scheduledStartsAt.toISOString(), scheduledDateLabel: formatDateLabel(booking.scheduledStartsAt),
      scheduledDateShortLabel: formatDaySectionLabel(booking.scheduledStartsAt, todayStart, tomorrowStart), scheduledTimeLabel: `${formatTime.format(booking.scheduledStartsAt)} - ${formatTime.format(booking.scheduledEndsAt)}`,
      status: booking.status, statusLabel: getBookingStatusLabel(booking.status), primaryContactLabel: contacts.primaryContactLabel,
      primaryContactHref: contacts.primaryContactHref, href: getAdminBookingHref(area, booking.id),
      availableActions: getAdminBookingActionOptions(booking.status, { scheduledStartsAt: booking.scheduledStartsAt, scheduledEndsAt: booking.scheduledEndsAt }),
      isMuted: booking.status === BookingStatus.COMPLETED || booking.status === BookingStatus.CANCELLED,
      isPending: booking.status === BookingStatus.PENDING,
      needsClosure: booking.scheduledEndsAt < now && isActiveBookingStatus(booking.status),
    };
  });
  const sections = new Map<string, ReservationsDashboardData["sections"][number]>();
  for (const row of rows) {
    const attentionKey = row.needsClosure ? "needs_closure" : "pending";
    const key = filters.view === "attention" ? attentionKey : row.scheduledStartsAtIso.slice(0, 10);
    const label = filters.view === "attention" ? (attentionKey === "needs_closure" ? "K uzavření" : "Čeká na potvrzení") : formatDaySectionLabel(new Date(row.scheduledStartsAtIso), todayStart, tomorrowStart);
    const detail = filters.view === "attention" ? (attentionKey === "needs_closure" ? "Proběhlé aktivní rezervace." : "Rezervace vyžadující potvrzení.") : "";
    const section = sections.get(key) ?? { key, label, detail, totalCount: 0, items: [] };
    section.items.push(row); section.totalCount += 1; sections.set(key, section);
  }
  const baseFilters = { view: filters.view, query: filters.query, status: filters.status, source: filters.source, dateFrom: filters.dateFrom, dateTo: filters.dateTo };
  const attentionHref = buildReservationsHref(currentPath, baseFilters, { view: "attention" });
  const hasActiveFilters = Boolean(filters.query || filters.status !== "all" || filters.source !== "all" || filters.dateFrom || filters.dateTo);
  return {
    currentPath,
    filters: { ...baseFilters, limit: filters.limit, hasActiveFilters },
    views: viewKeys.map((key, index) => ({ key, label: viewLabels[key], count: viewCounts[index] ?? 0, href: buildReservationsHref(currentPath, baseFilters, { view: key }), isActive: key === filters.view })),
    attention: { pendingCount, needsClosureCount, totalCount: pendingCount + needsClosureCount, href: attentionHref },
    summary: { totalCount, visibleCount: rows.length, emptyState: filters.view, showMoreHref: totalCount > rows.length ? buildReservationsHref(currentPath, baseFilters, { limit: Math.min(filters.limit + reservationLimitStep, reservationLimitMax) }) : null },
    sections: Array.from(sections.values()),
    manualBooking: { services: bookingCatalog.services.map((service) => ({ id: service.id, categoryName: service.categoryName, name: service.name, durationMinutes: service.durationMinutes, cleanupBlockMinutes: service.cleanupBlockMinutes, priceFromCzk: service.priceFromCzk })), slots: bookingCatalog.slots, scheduleOptimization: bookingCatalog.scheduleOptimization, clients: [] },
  } satisfies ReservationsDashboardData;
}

function formatDaySectionLabel(value: Date, todayStart: Date, tomorrowStart: Date) {
  const key = formatDateKey(value);
  const label = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Prague" }).format(value);
  if (key === formatDateKey(todayStart)) return `Dnes · ${label}`;
  if (key === formatDateKey(tomorrowStart)) return `Zítra · ${label}`;
  return label;
}
