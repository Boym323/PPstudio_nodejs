import { AvailabilitySlotStatus, BookingStatus } from "@/generated/prisma/browser";

import { type AdminArea } from "@/config/navigation";
import { getUnresolvedEmailDeliveryIncidentRootWhere } from "@/lib/email/incidents";
import {
  getAdminBookingActionOptions,
  getAdminBookingHref,
} from "@/features/admin/lib/booking/booking-display";
import { getBookingStatusLabel } from "@/features/booking/lib/booking-status-presentation";
import {
  clampIntervalToDay,
  mergeIntervals,
  subtractIntervals,
} from "@/features/admin/lib/admin-slots/helpers";
import {
  addDays,
  formatDateKey,
  getDayBounds,
  resolveWeekStart,
} from "@/features/admin/lib/admin-slots/time";
import {
  buildClientPhoneHref,
  formatClientPhoneForDisplay,
} from "@/features/booking/lib/client-phone";
import { prisma } from "@/lib/prisma";

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];
const TIMELINE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
];
const ACTIVE_SLOT_STATUSES: AvailabilitySlotStatus[] = [
  AvailabilitySlotStatus.DRAFT,
  AvailabilitySlotStatus.PUBLISHED,
];

const dayLabelFormatter = new Intl.DateTimeFormat("cs-CZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Prague",
});

const timeFormatter = new Intl.DateTimeFormat("cs-CZ", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Prague",
});

type DashboardAlertTone = "warning" | "problem" | "success";

type DashboardBookingNote = {
  label: "Klientka" | "Interně";
  value: string;
};

function formatCountLabel(count: number, singular: string, pluralFew: string, pluralMany: string) {
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 14) {
    return pluralMany;
  }

  const mod10 = count % 10;

  if (mod10 === 1) {
    return singular;
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return pluralFew;
  }

  return pluralMany;
}

export type DashboardTimelineItem =
  | {
      id: string;
      kind: "booking";
      sortTime: number;
      timeLabel: string;
      title: string;
      subtitle: string;
      badge: "REZERVACE";
      href: string;
      bookingId: string;
      bookingStatus: BookingStatus;
      bookingStatusLabel: string;
      contact: DashboardContactActions;
      notes: DashboardBookingNote[];
      availableActions: Array<{
        value: string;
        label: string;
      }>;
    }
  | {
      id: string;
      kind: "free";
      sortTime: number;
      timeLabel: string;
      title: string;
      subtitle: string;
      badge: "VOLNE";
      href: string;
      editHref: string;
    };

export type DashboardTodayPlanItem = {
  id: string;
  timeLabel: string;
  serviceName: string;
  clientName: string;
  statusLabel: string;
  href: string;
  phoneLabel: string | null;
  phoneHref: string | null;
  emailLabel: string | null;
  emailHref: string | null;
  isCurrent: boolean;
  isCompleted: boolean;
  primaryAction: "CONFIRMED" | "COMPLETED" | null;
  notes: DashboardBookingNote[];
};

type DashboardContactActions = {
  phoneLabel: string | null;
  phoneHref: string | null;
  emailLabel: string | null;
  emailHref: string | null;
};

export type DashboardUpcomingSlot = {
  id: string;
  dayLabel: string;
  timeLabel: string;
  metaLabel: string;
  createBookingHref: string;
};

type UpcomingSlotRecord = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
};

type UpcomingBookingBlockRecord = {
  scheduledStartsAt: Date;
  scheduledEndsAt: Date;
  blockedUntil: Date | null;
};

type UpcomingFreeWindow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
};

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDayLabel(date: Date) {
  return capitalize(dayLabelFormatter.format(date));
}

function getSlotEditHref(area: AdminArea, slotId: string) {
  return area === "owner"
    ? `/admin/volne-terminy/${slotId}/upravit`
    : `/admin/provoz/volne-terminy/${slotId}/upravit`;
}

function getPlannerHref(area: AdminArea) {
  return area === "owner" ? "/admin/volne-terminy" : "/admin/provoz/volne-terminy";
}

function getBookingsHref(area: AdminArea) {
  return area === "owner" ? "/admin/rezervace" : "/admin/provoz/rezervace";
}

function getCreateBookingHref(
  area: AdminArea,
  options?: {
    clientId?: string | null;
    date?: string | null;
    time?: string | null;
  },
) {
  const params = new URLSearchParams();

  params.set("create", "1");

  if (options?.clientId) {
    params.set("clientId", options.clientId);
  }

  if (options?.date) {
    params.set("date", options.date);
  }

  if (options?.time) {
    params.set("time", options.time);
  }

  return `${getBookingsHref(area)}?${params.toString()}`;
}

function getVouchersHref(area: AdminArea) {
  return area === "owner" ? "/admin/vouchery" : "/admin/provoz/vouchery";
}

function getTodayBounds(now: Date) {
  const { startsAt: todayStart, endsAt: tomorrowStart } = getDayBounds(formatDateKey(now));
  const dayAfterTomorrowStart = addDays(tomorrowStart, 1);

  return {
    todayStart,
    tomorrowStart,
    dayAfterTomorrowStart,
  };
}

function buildDashboardBookingNotes(booking: {
  clientNote: string | null;
  internalNote: string | null;
}) {
  const notes: DashboardBookingNote[] = [];

  if (booking.clientNote?.trim()) {
    notes.push({
      label: "Klientka",
      value: booking.clientNote.trim(),
    });
  }

  if (booking.internalNote?.trim()) {
    notes.push({
      label: "Interně",
      value: booking.internalNote.trim(),
    });
  }

  return notes;
}

function getWeekBounds(now: Date) {
  const weekStart = resolveWeekStart(formatDateKey(now));
  const weekEnd = addDays(weekStart, 7);

  return { weekStart, weekEnd };
}

function getDashboardContactActions(booking: {
  clientPhoneSnapshot?: string | null;
  clientEmailSnapshot?: string | null;
}): DashboardContactActions {
  const email = booking.clientEmailSnapshot?.trim() ?? "";

  return {
    phoneLabel: booking.clientPhoneSnapshot
      ? formatClientPhoneForDisplay(booking.clientPhoneSnapshot)
      : null,
    phoneHref: buildClientPhoneHref(booking.clientPhoneSnapshot),
    emailLabel: email || null,
    emailHref: email ? `mailto:${email}` : null,
  };
}

function getFreeIntervalsForSlot(
  slot: UpcomingSlotRecord,
  overlappingBookings: UpcomingBookingBlockRecord[],
) {
  if (slot.capacity < 1) {
    return [];
  }

  const blockedIntervals = mergeIntervals(
    overlappingBookings
      .map((booking) =>
        clampIntervalToDay(
          {
            startsAt: booking.scheduledStartsAt,
            endsAt: booking.blockedUntil ?? booking.scheduledEndsAt,
          },
          slot.startsAt,
          slot.endsAt,
        ))
      .filter((interval): interval is { startsAt: Date; endsAt: Date } => interval !== null),
  );

  if (slot.capacity === 1) {
    return blockedIntervals.reduce(
      (intervals, blockedInterval) => subtractIntervals(intervals, blockedInterval),
      [{ startsAt: slot.startsAt, endsAt: slot.endsAt }],
    );
  }

  const boundaries = new Set<number>([
    slot.startsAt.getTime(),
    slot.endsAt.getTime(),
  ]);

  for (const blockedInterval of blockedIntervals) {
    boundaries.add(blockedInterval.startsAt.getTime());
    boundaries.add(blockedInterval.endsAt.getTime());
  }

  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
  const availableSegments: Array<{ startsAt: Date; endsAt: Date }> = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const segmentStart = sortedBoundaries[index];
    const segmentEnd = sortedBoundaries[index + 1];

    if (segmentEnd <= segmentStart) {
      continue;
    }

    const activeBookings = overlappingBookings.filter((booking) => {
      const blockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;
      return booking.scheduledStartsAt.getTime() < segmentEnd && blockedUntil.getTime() > segmentStart;
    }).length;

    if (activeBookings < slot.capacity) {
      availableSegments.push({
        startsAt: new Date(segmentStart),
        endsAt: new Date(segmentEnd),
      });
    }
  }

  return availableSegments;
}

export function buildUpcomingFreeWindows(
  slots: UpcomingSlotRecord[],
  bookings: UpcomingBookingBlockRecord[],
) {
  const rawFreeWindows = slots.flatMap<UpcomingFreeWindow>((slot) => {
    const overlappingBookings = bookings.filter((booking) => {
      const blockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;
      return booking.scheduledStartsAt < slot.endsAt && blockedUntil > slot.startsAt;
    });

    return getFreeIntervalsForSlot(slot, overlappingBookings).map((interval, index) => ({
      id: `${slot.id}-${index}`,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
      capacity: slot.capacity,
    }));
  });

  const mergedWindows: UpcomingFreeWindow[] = [];

  for (const window of rawFreeWindows) {
    const previous = mergedWindows.at(-1);

    if (
      previous
      && previous.capacity === window.capacity
      && previous.endsAt.getTime() === window.startsAt.getTime()
    ) {
      previous.endsAt = window.endsAt;
      continue;
    }

    mergedWindows.push({ ...window });
  }

  return mergedWindows;
}

export function buildTimelineItems(
  area: AdminArea,
  now: Date,
  slots: Array<{
    id: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    bookings: Array<{
      id: string;
      scheduledStartsAt: Date;
      scheduledEndsAt: Date;
      blockedUntil?: Date | null;
      status: BookingStatus;
      serviceNameSnapshot: string;
      clientNameSnapshot: string;
      clientPhoneSnapshot?: string | null;
      clientEmailSnapshot?: string | null;
      clientNote: string | null;
      internalNote: string | null;
    }>;
  }>,
) {
  const items: DashboardTimelineItem[] = [];

  for (const slot of slots) {
    const bookings = [...slot.bookings].sort(
      (left, right) => left.scheduledStartsAt.getTime() - right.scheduledStartsAt.getTime(),
    );
    let cursor = slot.startsAt;

    const pushFreeWindow = (startsAt: Date, endsAt: Date, idSuffix: string) => {
      const effectiveStartsAt = startsAt.getTime() < now.getTime() ? now : startsAt;

      if (effectiveStartsAt.getTime() >= endsAt.getTime()) {
        return;
      }

      items.push({
        id: `${slot.id}-free-${idSuffix}`,
        kind: "free",
        sortTime: effectiveStartsAt.getTime(),
        timeLabel: `${timeFormatter.format(effectiveStartsAt)} - ${timeFormatter.format(endsAt)}`,
        title: "Volné okno",
        subtitle:
          endsAt.getTime() > now.getTime()
            ? `Kapacita ${slot.capacity} • připravené pro další rezervaci`
            : `Kapacita ${slot.capacity} • historické volno`,
        badge: "VOLNE",
        href: getSlotEditHref(area, slot.id),
        editHref: getSlotEditHref(area, slot.id),
      });
    };

    for (const booking of bookings) {
      if (booking.scheduledStartsAt.getTime() > cursor.getTime()) {
        pushFreeWindow(cursor, booking.scheduledStartsAt, cursor.toISOString());
      }

      items.push({
        id: booking.id,
        kind: "booking",
        sortTime: booking.scheduledStartsAt.getTime(),
        timeLabel: `${timeFormatter.format(booking.scheduledStartsAt)} - ${timeFormatter.format(booking.scheduledEndsAt)}`,
        title: booking.serviceNameSnapshot,
        subtitle: booking.clientNameSnapshot,
        badge: "REZERVACE",
        href: getAdminBookingHref(area, booking.id),
        bookingId: booking.id,
        bookingStatus: booking.status,
        bookingStatusLabel: getBookingStatusLabel(booking.status),
        contact: getDashboardContactActions(booking),
        notes: buildDashboardBookingNotes(booking),
        availableActions: getAdminBookingActionOptions(booking.status, {
          scheduledStartsAt: booking.scheduledStartsAt,
          scheduledEndsAt: booking.scheduledEndsAt,
        }),
      });

      const bookingBlockedUntil = booking.blockedUntil ?? booking.scheduledEndsAt;

      if (bookingBlockedUntil.getTime() > cursor.getTime()) {
        cursor = bookingBlockedUntil;
      }
    }

    if (cursor.getTime() < slot.endsAt.getTime()) {
      pushFreeWindow(cursor, slot.endsAt, slot.endsAt.toISOString());
    }
  }

  return items.sort((left, right) => left.sortTime - right.sortTime);
}

function getWeekOccupancy(
  slots: Array<{
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    bookings: Array<{
      scheduledStartsAt: Date;
      scheduledEndsAt: Date;
    }>;
  }>,
) {
  const availableMinutes = slots.reduce((total, slot) => {
    const slotMinutes = (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60000;
    return total + slotMinutes * Math.max(slot.capacity, 1);
  }, 0);

  const bookedMinutes = slots.reduce((total, slot) => {
    return (
      total +
      slot.bookings.reduce((slotTotal, booking) => {
        return (
          slotTotal + (booking.scheduledEndsAt.getTime() - booking.scheduledStartsAt.getTime()) / 60000
        );
      }, 0)
    );
  }, 0);

  if (availableMinutes === 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100)));
}

export type AdminDashboardData = {
  area: AdminArea;
  todayLabel: string;
  todayBookingsCount: number;
  currentReservationSummary: string | null;
  nextClient: {
    timeLabel: string;
    timeRangeLabel: string;
    serviceName: string;
    clientName: string;
    detailHref: string;
    phoneLabel: string | null;
    phoneHref: string | null;
    emailLabel: string | null;
    emailHref: string | null;
  } | null;
  alerts: Array<{
    id: string;
    tone: DashboardAlertTone;
    text: string;
    href: string;
    actionLabel: string;
    emphasis: "primary" | "secondary" | "ok";
  }>;
  todayPlanItems: DashboardTodayPlanItem[];
  timelineFooterHref: string;
  createBookingHref: string;
  addSlotHref: string;
  weekSummary: {
    occupancyLabel: string;
    freeSlotsLabel: string;
    bookingsLabel: string;
  };
  hasFreeWindowsToday: boolean;
  upcomingSlots: DashboardUpcomingSlot[];
  draftUpcomingSlotsCount: number;
  upcomingSlotsFooterHref: string;
  quickActions: Array<{
    id: string;
    label: string;
    href: string;
    icon: "plus" | "calendar" | "booking" | "clients" | "voucher";
  }>;
};

export async function getAdminDashboardData(area: AdminArea): Promise<AdminDashboardData> {
  const now = new Date();
  const { todayStart, tomorrowStart, dayAfterTomorrowStart } = getTodayBounds(now);
  const { weekStart, weekEnd } = getWeekBounds(now);
  const availabilityHorizon = addDays(tomorrowStart, 30);

  const bookingsHref = getBookingsHref(area);
  const plannerHref = getPlannerHref(area);
  const vouchersHref = getVouchersHref(area);

  const [
    todayBookings,
    pendingBookings,
    failedEmails,
    weekSlots,
    nearbyPublishedSlots,
    nearbyBookingBlocks,
    upcomingDraftSlotsCount,
  ] = await Promise.all([
    prisma.booking.findMany({
      where: {
        scheduledStartsAt: { gte: todayStart, lt: tomorrowStart },
        status: { in: TIMELINE_BOOKING_STATUSES },
      },
      orderBy: { scheduledStartsAt: "asc" },
      select: {
        id: true,
        status: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        serviceNameSnapshot: true,
        clientNameSnapshot: true,
        clientPhoneSnapshot: true,
        clientEmailSnapshot: true,
        clientNote: true,
        internalNote: true,
      },
    }),
    prisma.booking.count({
      where: {
        status: BookingStatus.PENDING,
      },
    }),
    prisma.emailLog.count({ where: getUnresolvedEmailDeliveryIncidentRootWhere() }),
    prisma.availabilitySlot.findMany({
      where: {
        startsAt: { gte: weekStart, lt: weekEnd },
        status: { in: ACTIVE_SLOT_STATUSES },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        bookings: {
          where: { status: { in: ACTIVE_BOOKING_STATUSES } },
          select: {
            id: true,
            scheduledStartsAt: true,
            scheduledEndsAt: true,
          },
        },
      },
    }),
    prisma.availabilitySlot.findMany({
      where: {
        startsAt: { lt: availabilityHorizon },
        endsAt: { gt: now },
        status: AvailabilitySlotStatus.PUBLISHED,
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
      },
    }),
    prisma.booking.findMany({
      where: {
        scheduledStartsAt: { lt: availabilityHorizon },
        OR: [
          {
            blockedUntil: {
              gt: now,
            },
          },
          {
            blockedUntil: null,
            scheduledEndsAt: {
              gt: now,
            },
          },
        ],
        status: { in: ACTIVE_BOOKING_STATUSES },
      },
      orderBy: { scheduledStartsAt: "asc" },
      select: {
        scheduledStartsAt: true,
        scheduledEndsAt: true,
        blockedUntil: true,
      },
    }),
    prisma.availabilitySlot.count({
      where: {
        startsAt: { gte: now },
        status: AvailabilitySlotStatus.DRAFT,
        // Draft navázaný na aktivní rezervaci je interní ochranný slot po
        // ručním přesunu, ne návrh volného termínu určený k publikování.
        bookings: {
          none: {
            status: { in: ACTIVE_BOOKING_STATUSES },
          },
        },
      },
    }),
  ]);

  const safeText = (value: string, fallback: string) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  };

  const activeTodayBookings = todayBookings.filter((booking) =>
    ACTIVE_BOOKING_STATUSES.includes(booking.status),
  );
  const currentTodayBooking =
    activeTodayBookings.find(
      (booking) =>
        booking.scheduledStartsAt.getTime() <= now.getTime() &&
        booking.scheduledEndsAt.getTime() > now.getTime(),
    ) ?? null;
  const nextTodayBooking =
    activeTodayBookings.find((booking) => booking.scheduledStartsAt.getTime() >= now.getTime()) ?? null;
  const todayPlanItems: DashboardTodayPlanItem[] = todayBookings.map((booking) => ({
      id: booking.id,
      timeLabel: `${timeFormatter.format(booking.scheduledStartsAt)} - ${timeFormatter.format(booking.scheduledEndsAt)}`,
      serviceName: safeText(booking.serviceNameSnapshot, "Služba není uvedená"),
      clientName: safeText(booking.clientNameSnapshot, "Klientka není uvedená"),
      statusLabel: getBookingStatusLabel(booking.status),
      href: getAdminBookingHref(area, booking.id),
      ...getDashboardContactActions(booking),
      isCurrent: booking.id === currentTodayBooking?.id,
      isCompleted: booking.status === BookingStatus.COMPLETED,
      primaryAction: getAdminBookingActionOptions(booking.status, {
        scheduledStartsAt: booking.scheduledStartsAt,
        scheduledEndsAt: booking.scheduledEndsAt,
        now,
      }).find((action): action is typeof action & { value: "CONFIRMED" | "COMPLETED" } =>
        action.value === "CONFIRMED" || action.value === "COMPLETED",
      )?.value ?? null,
      notes: buildDashboardBookingNotes(booking),
    }));
  const weekOccupancy = getWeekOccupancy(weekSlots);
  const weekFreeSlots = weekSlots.filter((slot) => slot.bookings.length < slot.capacity).length;
  const weekBookingsCount = weekSlots.reduce((total, slot) => total + slot.bookings.length, 0);
  const upcomingFreeWindows = buildUpcomingFreeWindows(
    nearbyPublishedSlots.map((slot) => ({
      ...slot,
      startsAt: slot.startsAt < now ? now : slot.startsAt,
    })),
    nearbyBookingBlocks,
  );
  const todayFreeWindows = upcomingFreeWindows.filter(
    (slot) => slot.startsAt >= todayStart && slot.startsAt < tomorrowStart,
  );
  const hasFreeWindowsToday = todayFreeWindows.length > 0;
  const overdueActiveBookingsCount = activeTodayBookings.filter(
    (booking) => booking.scheduledEndsAt.getTime() <= now.getTime(),
  ).length;

  const alerts: AdminDashboardData["alerts"] = [];

  if (pendingBookings > 0) {
    alerts.push({
      id: "pending-bookings",
      tone: "warning",
      text: `${pendingBookings} ${formatCountLabel(
        pendingBookings,
        "rezervace čeká na potvrzení",
        "rezervace čekají na potvrzení",
        "rezervací čeká na potvrzení",
      )}.`,
      href: `${bookingsHref}?view=attention&status=pending`,
      actionLabel: "Potvrdit čekající rezervace",
      emphasis: "primary",
    });
  }

  if (failedEmails > 0) {
    alerts.push({
      id: "email-failures",
      tone: "problem",
      text: `${failedEmails} ${formatCountLabel(
        failedEmails,
        "e-mail má problém s odesláním nebo doručením",
        "e-maily mají problém s odesláním nebo doručením",
        "e-mailů má problém s odesláním nebo doručením",
      )}.`,
      href: area === "owner" ? "/admin/logy?view=attention&source=email" : "/admin/provoz/logy?view=attention&source=email",
      actionLabel: "Prověřit neodeslané e-maily",
      emphasis: "secondary",
    });
  }

  if (overdueActiveBookingsCount > 0) {
    alerts.push({
      id: "current-overdue",
      tone: "problem",
      text: `${overdueActiveBookingsCount} ${formatCountLabel(
        overdueActiveBookingsCount,
        "rezervace je po termínu a čeká na uzavření",
        "rezervace jsou po termínu a čekají na uzavření",
        "rezervací je po termínu a čeká na uzavření",
      )}.`,
      href: `${bookingsHref}?view=attention`,
      actionLabel: "Uzavřít návštěvy po termínu",
      emphasis: "secondary",
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "all-good",
      tone: "success",
      text: "Vše je připravené. Žádná položka teď nevyžaduje pozornost.",
      href: bookingsHref,
      actionLabel: "Otevřít rezervace",
      emphasis: "ok",
    });
  }

  return {
    area,
    todayLabel: `Dnes • ${formatDayLabel(now)}`,
    todayBookingsCount: activeTodayBookings.length,
    currentReservationSummary: currentTodayBooking
      ? `Právě probíhá: ${timeFormatter.format(
          currentTodayBooking.scheduledStartsAt,
        )}–${timeFormatter.format(currentTodayBooking.scheduledEndsAt)} ${safeText(
          currentTodayBooking.serviceNameSnapshot,
          "Služba není uvedená",
        )}.`
      : null,
    nextClient: nextTodayBooking
      ? {
          timeLabel: timeFormatter.format(nextTodayBooking.scheduledStartsAt),
          timeRangeLabel: `${timeFormatter.format(nextTodayBooking.scheduledStartsAt)}–${timeFormatter.format(
            nextTodayBooking.scheduledEndsAt,
          )}`,
          serviceName: safeText(nextTodayBooking.serviceNameSnapshot, "Služba není uvedená"),
          clientName: safeText(nextTodayBooking.clientNameSnapshot, "Klientka není uvedená"),
          detailHref: getAdminBookingHref(area, nextTodayBooking.id),
          ...getDashboardContactActions(nextTodayBooking),
        }
      : null,
    alerts,
    todayPlanItems,
    timelineFooterHref: plannerHref,
    createBookingHref: getCreateBookingHref(area),
    addSlotHref: plannerHref,
    weekSummary: {
      occupancyLabel: `${weekOccupancy} %`,
      freeSlotsLabel: `${weekFreeSlots} ${formatCountLabel(
        weekFreeSlots,
        "volný slot",
        "volné sloty",
        "volných slotů",
      )}`,
      bookingsLabel: `${weekBookingsCount} ${formatCountLabel(
        weekBookingsCount,
        "rezervace",
        "rezervace",
        "rezervací",
      )}`,
    },
    hasFreeWindowsToday,
    upcomingSlots: upcomingFreeWindows.slice(0, 6).map((slot) => {
      const prefix =
        slot.startsAt >= todayStart && slot.startsAt < tomorrowStart
          ? "Dnes"
          : slot.startsAt >= tomorrowStart && slot.startsAt < dayAfterTomorrowStart
            ? "Zítra"
            : formatDayLabel(slot.startsAt);
      const metaLabel =
        slot.capacity <= 1 ? "volno" : `volno • kapacita ${slot.capacity}`;

      return {
        id: slot.id,
        dayLabel: prefix,
        timeLabel: `${timeFormatter.format(slot.startsAt)} - ${timeFormatter.format(slot.endsAt)}`,
        metaLabel,
        createBookingHref: getCreateBookingHref(area, {
          date: formatDateKey(slot.startsAt),
          time: timeFormatter.format(slot.startsAt),
        }),
      };
    }),
    draftUpcomingSlotsCount: upcomingDraftSlotsCount,
    upcomingSlotsFooterHref: plannerHref,
    quickActions: [
      {
        id: "availability",
        label: "Upravit dostupnost",
        href: plannerHref,
        icon: "calendar",
      },
      {
        id: "vouchers",
        label: "Vystavit voucher",
        href: `${vouchersHref}/novy`,
        icon: "voucher",
      },
    ],
  };
}
