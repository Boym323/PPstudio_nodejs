"use client";

import { AvailabilitySlotServiceRestrictionMode } from "@/generated/prisma/browser";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { createPublicBookingAction } from "@/features/booking/actions/create-public-booking";
import { refreshPublicBookingCatalogAction } from "@/features/booking/actions/refresh-public-booking-catalog";
import { validatePublicBookingVoucherAction } from "@/features/booking/actions/validate-public-booking-voucher";
import { initialPublicBookingActionState } from "@/features/booking/actions/public-booking-action-state";
import { trackBookingEvent } from "@/features/analytics/matomo";
import {
  trackMetaPixelCustomEvent,
  trackMetaPixelStandardEvent,
} from "@/features/analytics/meta-pixel";
import {
  buildSlotTimeOptions,
  filterTimeOptionsForAutoLunch,
  getAutoLunchBoundaryStartCandidates,
  groupSlotsByDayPeriod,
  type TimeSlotOption,
} from "@/features/booking/lib/booking-time-slots";
import { selectSuggestedSlots } from "@/features/booking/lib/booking-schedule-optimization";

import { BookingConfirmationPanel } from "./booking-confirmation-panel";
import { StickyCTA } from "./sticky-cta";
import { BookingContactStep } from "./booking-flow/contact-step";
import { shouldTrackContactFieldInput } from "./booking-flow/contact-analytics";
import {
  formatBookingMatomoSlotName,
  formatSuggestedSlotSelectionMatomoName,
  formatSuggestedSlotsDisplayedMatomoName,
  getSuggestedSlotPosition,
  getSuggestedSlotsDisplayKey,
  getVisibleSuggestedSlots,
  isBookingTermConflictErrorCode,
  shouldTrackBookingDateSelection,
  shouldTrackSuggestedSlotsDisplay,
  shouldTrackBookingTimeSelection,
} from "./booking-flow/booking-analytics";
import {
  getAvailableDateKeysForAvailability,
  canApplyAvailabilityRefresh,
  getAvailabilityRefreshKey,
  getRefreshedDateSelection,
  isPublicBookingAvailabilityError,
} from "./booking-flow/availability-refresh";
import {
  resolveVoucherRevalidation,
  type VoucherApplicationState,
} from "./booking-flow/voucher-revalidation";
import {
  buildContactFieldErrors,
  EMPTY_TIME_SLOTS,
  findInitialSelectedService,
  getBookingStickyOffset,
  getCategoryKey,
  getSlotDateKey,
  getSlotDurationMinutes,
  getSlotHour,
  formatSlotDate,
  formatSlotTime,
  shouldTrackPrefilledServiceSelectionEvent,
  stepLabels,
} from "./booking-flow/helpers";
import { BookingProgressPanel } from "./booking-flow/progress-panel";
import { BookingServiceStep } from "./booking-flow/service-step";
import { BookingSummarySidebar } from "./booking-flow/summary-sidebar";
import { BookingTermStep } from "./booking-flow/term-step";
import type {
  BookingFlowProps,
  ContactAnalyticsField,
  ContactFieldKey,
  ServiceCategory,
} from "./booking-flow/types";

type SlotSelectionSource = "suggested" | "calendar";

const MOBILE_SUGGESTED_SLOTS_LIMIT = 4;
const DESKTOP_SUGGESTED_SLOTS_LIMIT = 6;

export function BookingFlow({
  catalog,
  initialSelectedServiceSlug,
  initialVoucherCode,
  bookingEntrySource,
  salonProfile,
}: BookingFlowProps) {
  const [serverState, formAction, isSubmitting] = useActionState(
    createPublicBookingAction,
    initialPublicBookingActionState,
  );
  const [currentCatalog, setCurrentCatalog] = useState(catalog);
  const [isRefreshingCatalog, setIsRefreshingCatalog] = useState(false);
  const [catalogRefreshError, setCatalogRefreshError] = useState("");
  const [catalogRefreshRetry, setCatalogRefreshRetry] = useState(0);
  const initialSelectedService = findInitialSelectedService(
    currentCatalog.services,
    initialSelectedServiceSlug,
  );
  const initialSelectedServiceId = initialSelectedService?.id;
  const initialCategoryKey = getCategoryKey(
    initialSelectedService?.categoryName ?? currentCatalog.services[0]?.categoryName ?? "",
  );
  const [selectedCategoryKey, setSelectedCategoryKey] = useState(initialCategoryKey);
  const [selectedServiceId, setSelectedServiceId] = useState(initialSelectedService?.id ?? "");
  const [selectedTimeOptionKey, setSelectedTimeOptionKey] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [clientNote, setClientNote] = useState("");
  const [voucherCode, setVoucherCode] = useState(initialVoucherCode ?? "");
  const [appliedVoucherCode, setAppliedVoucherCode] = useState("");
  const [voucherApplication, setVoucherApplication] = useState<VoucherApplicationState>({ status: "idle" });
  const [voucherValidationVersion, setVoucherValidationVersion] = useState(0);
  const [currentStep, setCurrentStep] = useState(initialSelectedService ? 2 : 1);
  const [isServiceCatalogOpen, setIsServiceCatalogOpen] = useState(!initialSelectedService);
  const [selectedDateKey, setSelectedDateKey] = useState("");
  const [visibleMonthKey, setVisibleMonthKey] = useState("");
  const [isServiceStepHighlighted, setIsServiceStepHighlighted] = useState(false);
  const [isTermStepHighlighted, setIsTermStepHighlighted] = useState(false);
  const [isContactStepHighlighted, setIsContactStepHighlighted] = useState(false);
  const [visibleSuggestedSlotsLimit, setVisibleSuggestedSlotsLimit] = useState(() => (
    typeof window !== "undefined" && !window.matchMedia("(max-width: 639px)").matches
      ? DESKTOP_SUGGESTED_SLOTS_LIMIT
      : MOBILE_SUGGESTED_SLOTS_LIMIT
  ));
  const [touchedFields, setTouchedFields] = useState<Record<ContactFieldKey, boolean>>({
    fullName: false,
    email: false,
    phone: false,
  });
  const serviceStepSectionRef = useRef<HTMLDivElement | null>(null);
  const serviceStepHighlightTimeoutRef = useRef<number | null>(null);
  const termStepSectionRef = useRef<HTMLDivElement | null>(null);
  const availableTimesSectionRef = useRef<HTMLDivElement | null>(null);
  const termStepHighlightTimeoutRef = useRef<number | null>(null);
  const contactStepSectionRef = useRef<HTMLDivElement | null>(null);
  const firstContactInputRef = useRef<HTMLInputElement | null>(null);
  const contactStepHighlightTimeoutRef = useRef<number | null>(null);
  const contactStepFocusTimeoutRef = useRef<number | null>(null);
  const confirmedBookingIdsRef = useRef<Set<string>>(new Set());
  const bookingStartedTrackedRef = useRef(false);
  const serviceSelectedTrackedRef = useRef(false);
  const bookingReviewedTrackedRef = useRef(false);
  const successViewportResetRef = useRef(false);
  const contactStartedTrackedRef = useRef(false);
  const trackedContactInputFieldsRef = useRef<Set<ContactAnalyticsField>>(new Set());
  const prefilledServiceTrackedRef = useRef(false);
  const initiateCheckoutTrackedRef = useRef(false);
  const lastFailedBookingKeyRef = useRef<string | null>(null);
  const lastTrackedDateKeyRef = useRef<string | null>(null);
  const lastTrackedTimeOptionKeyRef = useRef<string | null>(null);
  const lastTrackedSuggestedSlotsDisplayKeyRef = useRef<string | null>(null);
  const catalogRefreshRequestRef = useRef(0);
  const voucherValidationRequestRef = useRef(0);
  const lastVoucherValidationServiceIdRef = useRef(selectedServiceId);
  const lastRefreshedConflictRef = useRef("");
  const formRevisionRef = useRef(0);

  const markFormChanged = () => {
    formRevisionRef.current += 1;
  };

  const trackSelectedServiceMetaEvent = (service?: {
    categoryName: string;
    name: string;
    slug: string;
    durationMinutes: number;
    priceFromCzk: number | null;
  }) => {
    if (!service) {
      return;
    }

    trackMetaPixelCustomEvent("BookingServiceSelected", {
      content_type: "service",
      content_ids: [service.slug],
      content_name: service.name,
      content_category: service.categoryName,
      duration_minutes: service.durationMinutes,
    });
  };

  const trackSelectedDateMetaEvent = (dateKey: string) => {
    if (!shouldTrackBookingDateSelection(lastTrackedDateKeyRef.current, dateKey)) return;

    lastTrackedDateKeyRef.current = dateKey;
    trackBookingEvent("Datum vybráno", dateKey);
    const bookingDate = new Date(`${dateKey}T12:00:00Z`);
    const bookingWeekday = new Intl.DateTimeFormat("cs-CZ", {
      weekday: "long",
      timeZone: "Europe/Prague",
    }).format(bookingDate);

    trackMetaPixelCustomEvent("BookingDateSelected", {
      booking_month: dateKey.slice(0, 7),
      booking_weekday: bookingWeekday,
    });
  };

  const trackSelectedTimeMetaEvent = (slotOption: TimeSlotOption) => {
    const hour = getSlotHour(slotOption.startsAt);
    const timeBucket = hour !== null && hour < 12
      ? "morning"
      : hour !== null && hour < 17
        ? "afternoon"
        : "evening";

    trackMetaPixelCustomEvent("BookingTimeSelected", {
      time_bucket: timeBucket,
      duration_minutes: selectedService?.durationMinutes,
    });
  };

  const focusSection = (
    sectionElement: HTMLDivElement | null,
    setHighlighted: (value: boolean) => void,
    timeoutRef: MutableRefObject<number | null>,
    durationMs: number,
  ) => {
    if (!sectionElement) {
      return;
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setHighlighted(true);
    timeoutRef.current = window.setTimeout(() => {
      setHighlighted(false);
      timeoutRef.current = null;
    }, durationMs);

    window.requestAnimationFrame(() => {
      const rect = sectionElement.getBoundingClientRect();
      const topSafeArea = getBookingStickyOffset();
      const bottomSafeArea = 64;
      const isComfortablyVisible =
        rect.top >= topSafeArea && rect.bottom <= window.innerHeight - bottomSafeArea;

      if (isComfortablyVisible) {
        return;
      }

      const targetTop = window.scrollY + rect.top - topSafeArea;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });
    });
  };

  const focusServiceStepSection = () => {
    focusSection(
      serviceStepSectionRef.current,
      setIsServiceStepHighlighted,
      serviceStepHighlightTimeoutRef,
      750,
    );
  };

  const focusTermStepSection = () => {
    focusSection(
      termStepSectionRef.current,
      setIsTermStepHighlighted,
      termStepHighlightTimeoutRef,
      750,
    );
  };

  const focusAvailableTimesSection = () => {
    const sectionElement = availableTimesSectionRef.current;

    if (!sectionElement) {
      return;
    }

    window.requestAnimationFrame(() => {
      const rect = sectionElement.getBoundingClientRect();
      const topSafeArea = getBookingStickyOffset();
      const bottomSafeArea = 64;
      const isComfortablyVisible =
        rect.top >= topSafeArea && rect.bottom <= window.innerHeight - bottomSafeArea;

      sectionElement.focus({ preventScroll: true });

      if (isComfortablyVisible) {
        return;
      }

      const targetTop = window.scrollY + rect.top - topSafeArea;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });
    });
  };

  const focusContactStepSection = () => {
    const sectionElement = contactStepSectionRef.current;
    const firstInputElement = firstContactInputRef.current;

    if (!sectionElement || !firstInputElement) {
      return;
    }

    if (contactStepHighlightTimeoutRef.current !== null) {
      window.clearTimeout(contactStepHighlightTimeoutRef.current);
    }

    if (contactStepFocusTimeoutRef.current !== null) {
      window.clearTimeout(contactStepFocusTimeoutRef.current);
    }

    setIsContactStepHighlighted(true);
    contactStepHighlightTimeoutRef.current = window.setTimeout(() => {
      setIsContactStepHighlighted(false);
      contactStepHighlightTimeoutRef.current = null;
    }, 900);

    window.requestAnimationFrame(() => {
      const rect = sectionElement.getBoundingClientRect();
      const topSafeArea = getBookingStickyOffset();
      const bottomSafeArea = 64;
      const isComfortablyVisible =
        rect.top >= topSafeArea && rect.bottom <= window.innerHeight - bottomSafeArea;

      const focusFirstInput = () => {
        firstInputElement.focus({ preventScroll: true });
      };

      if (isComfortablyVisible) {
        focusFirstInput();
        return;
      }

      const targetTop = window.scrollY + rect.top - topSafeArea;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });

      contactStepFocusTimeoutRef.current = window.setTimeout(() => {
        focusFirstInput();
        contactStepFocusTimeoutRef.current = null;
      }, 280);
    });
  };

  useEffect(() => {
    return () => {
      if (serviceStepHighlightTimeoutRef.current !== null) {
        window.clearTimeout(serviceStepHighlightTimeoutRef.current);
        serviceStepHighlightTimeoutRef.current = null;
      }
      if (termStepHighlightTimeoutRef.current !== null) {
        window.clearTimeout(termStepHighlightTimeoutRef.current);
        termStepHighlightTimeoutRef.current = null;
      }
      if (contactStepHighlightTimeoutRef.current !== null) {
        window.clearTimeout(contactStepHighlightTimeoutRef.current);
        contactStepHighlightTimeoutRef.current = null;
      }
      if (contactStepFocusTimeoutRef.current !== null) {
        window.clearTimeout(contactStepFocusTimeoutRef.current);
        contactStepFocusTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!initialSelectedServiceId) {
      return;
    }

    const sectionElement = termStepSectionRef.current;

    if (!sectionElement) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setCurrentStep(2);
      const rect = sectionElement.getBoundingClientRect();
      const topSafeArea = getBookingStickyOffset();
      const bottomSafeArea = 64;
      const isComfortablyVisible =
        rect.top >= topSafeArea && rect.bottom <= window.innerHeight - bottomSafeArea;

      if (isComfortablyVisible) {
        return;
      }

      const targetTop = window.scrollY + rect.top - topSafeArea;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [initialSelectedServiceId]);

  const servicesById = useMemo(
    () => new Map(currentCatalog.services.map((service) => [service.id, service])),
    [currentCatalog.services],
  );

  const serviceCategories = useMemo(() => {
    const grouped = new Map<string, ServiceCategory>();

    for (const service of currentCatalog.services) {
      const key = getCategoryKey(service.categoryName);
      const existing = grouped.get(key);

      if (existing) {
        existing.serviceCount += 1;
      } else {
        grouped.set(key, {
          key,
          label: service.categoryName,
          serviceCount: 1,
        });
      }
    }

    return [...grouped.values()];
  }, [currentCatalog.services]);

  const effectiveCategoryKey =
    selectedCategoryKey && serviceCategories.some((category) => category.key === selectedCategoryKey)
      ? selectedCategoryKey
      : serviceCategories[0]?.key ?? "";

  const visibleServices = useMemo(
    () => currentCatalog.services.filter((service) => getCategoryKey(service.categoryName) === effectiveCategoryKey),
    [currentCatalog.services, effectiveCategoryKey],
  );

  const selectedService = selectedServiceId ? servicesById.get(selectedServiceId) : undefined;

  const trackInitiateCheckout = () => {
    if (initiateCheckoutTrackedRef.current) {
      return;
    }

    initiateCheckoutTrackedRef.current = true;
    trackMetaPixelStandardEvent("InitiateCheckout", {
      content_category: "booking",
      source_context: initialSelectedServiceSlug ? "service_prefill" : "booking_landing",
    });
  };

  const invalidateVoucherApplication = useCallback((nextCode = voucherCode) => {
    voucherValidationRequestRef.current += 1;
    setAppliedVoucherCode("");
    setVoucherApplication(nextCode.trim() && selectedServiceId ? { status: "checking" } : { status: "idle" });
  }, [selectedServiceId, voucherCode]);

  useEffect(() => {
    const code = voucherCode.trim();
    const serviceChanged = lastVoucherValidationServiceIdRef.current !== selectedServiceId;
    lastVoucherValidationServiceIdRef.current = selectedServiceId;
    const requestId = voucherValidationRequestRef.current + 1;
    voucherValidationRequestRef.current = requestId;

    if (!code || !selectedServiceId) {
      const timeoutId = window.setTimeout(() => {
        if (voucherValidationRequestRef.current === requestId) {
          setAppliedVoucherCode("");
          setVoucherApplication({ status: "idle" });
        }
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    const validate = () => {
      setAppliedVoucherCode("");
      setVoucherApplication({ status: "checking" });
      void validatePublicBookingVoucherAction({ code, serviceId: selectedServiceId })
        .then((result) => {
          if (voucherValidationRequestRef.current !== requestId) return;

          const revalidation = resolveVoucherRevalidation(result);
          setAppliedVoucherCode(revalidation.appliedVoucherCode);
          setVoucherApplication(revalidation.voucherApplication);
        })
        .catch(() => {
          if (voucherValidationRequestRef.current !== requestId) return;
          setAppliedVoucherCode("");
          setVoucherApplication({ status: "invalid", message: "Voucher se teď nepodařilo ověřit. Zkuste to prosím znovu." });
        });
    };

    const timeoutId = window.setTimeout(validate, serviceChanged ? 0 : 350);
    return () => window.clearTimeout(timeoutId);
  }, [selectedServiceId, voucherCode, voucherValidationVersion]);

  const availableSlots = useMemo(() => {
    if (!selectedServiceId) {
      return [];
    }

    return currentCatalog.slots.filter((slot) => {
      if (!selectedService) {
        return false;
      }

      if (getSlotDurationMinutes(slot) < selectedService.durationMinutes) {
        return false;
      }

      if (slot.serviceRestrictionMode === AvailabilitySlotServiceRestrictionMode.ANY) {
        return true;
      }

      return slot.allowedServiceIds.includes(selectedServiceId);
    });
  }, [currentCatalog.slots, selectedService, selectedServiceId]);

  const availableTimeOptions = useMemo(() => {
    if (!selectedService) {
      return [];
    }

    const capacity = availableSlots.every((slot) => slot.capacity === 1) ? 1 : 2;
    const autoLunchBoundaryStartCandidates = capacity === 1
      ? getAutoLunchBoundaryStartCandidates(currentCatalog.scheduleOptimization)
      : [];

    const options = availableSlots.flatMap((slot) => buildSlotTimeOptions(
      slot,
      selectedService.durationMinutes,
      selectedService.cleanupBlockMinutes,
      autoLunchBoundaryStartCandidates,
    ));

    return filterTimeOptionsForAutoLunch(options, {
      serviceDurationMinutes: selectedService.durationMinutes,
      cleanupBlockMinutes: selectedService.cleanupBlockMinutes,
      capacity,
      scheduleOptimization: currentCatalog.scheduleOptimization,
    });
  }, [availableSlots, currentCatalog.scheduleOptimization, selectedService]);

  const selectedTimeOptionCandidate = selectedTimeOptionKey
    ? availableTimeOptions.find((option) => option.key === selectedTimeOptionKey)
    : undefined;
  const selectedTimeOption = selectedTimeOptionCandidate && !selectedTimeOptionCandidate.isDisabled
    ? selectedTimeOptionCandidate
    : undefined;

  const selectableTimeOptions = useMemo(
    () => availableTimeOptions.filter((option) => !option.isDisabled),
    [availableTimeOptions],
  );

  const suggestedSlots = useMemo(
    () => {
      if (!selectedService) {
        return selectableTimeOptions.slice(0, 6);
      }

      const scheduleOptimization = currentCatalog.scheduleOptimization;
      return selectSuggestedSlots({
        candidates: selectableTimeOptions,
        availability: scheduleOptimization.publishedAvailability.map((interval) => ({
          startsAt: new Date(interval.startsAt).getTime(),
          endsAt: new Date(interval.endsAt).getTime(),
        })),
        bookedBlocks: scheduleOptimization.bookedIntervals.map((interval) => ({
          startsAt: new Date(interval.startsAt).getTime(),
          endsAt: new Date(interval.endsAt).getTime(),
        })),
        serviceDurationMinutes: selectedService.durationMinutes,
        cleanupBlockMinutes: selectedService.cleanupBlockMinutes,
        capacity: availableSlots.every((slot) => slot.capacity === 1) ? 1 : 2,
        globalAutoLunchEnabled: scheduleOptimization.globalAutoLunchEnabled,
        dayLunchModes: scheduleOptimization.dayLunchModes,
        serviceBlockOptions: scheduleOptimization.serviceBlockOptions,
        supportsServiceAwareOrphans: scheduleOptimization.supportsServiceAwareOrphans,
      });
    },
    [availableSlots, currentCatalog.scheduleOptimization, selectableTimeOptions, selectedService],
  );

  const visibleSuggestedSlots = useMemo(
    () => getVisibleSuggestedSlots(suggestedSlots, visibleSuggestedSlotsLimit),
    [suggestedSlots, visibleSuggestedSlotsLimit],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const syncVisibleSuggestedSlotsLimit = () => {
      setVisibleSuggestedSlotsLimit(
        mediaQuery.matches ? MOBILE_SUGGESTED_SLOTS_LIMIT : DESKTOP_SUGGESTED_SLOTS_LIMIT,
      );
    };

    syncVisibleSuggestedSlotsLimit();
    mediaQuery.addEventListener("change", syncVisibleSuggestedSlotsLimit);
    return () => mediaQuery.removeEventListener("change", syncVisibleSuggestedSlotsLimit);
  }, []);

  useEffect(() => {
    if (!selectedService || visibleSuggestedSlots.length === 0) {
      return;
    }

    const displayKey = getSuggestedSlotsDisplayKey(selectedService.slug, visibleSuggestedSlots);
    if (!shouldTrackSuggestedSlotsDisplay(lastTrackedSuggestedSlotsDisplayKeyRef.current, displayKey)) {
      return;
    }

    lastTrackedSuggestedSlotsDisplayKeyRef.current = displayKey;
    trackBookingEvent("Doporučené termíny zobrazeny", formatSuggestedSlotsDisplayedMatomoName(selectedService.slug));
  }, [selectedService, visibleSuggestedSlots]);

  const availableSlotsByDate = useMemo(() => {
    const grouped = new Map<string, TimeSlotOption[]>();

    for (const slotOption of selectableTimeOptions) {
      const dateKey = getSlotDateKey(slotOption.startsAt);
      if (!dateKey) {
        continue;
      }
      const current = grouped.get(dateKey) ?? [];
      current.push(slotOption);
      grouped.set(dateKey, current);
    }

    for (const [dateKey, slots] of grouped.entries()) {
      grouped.set(
        dateKey,
        [...slots].sort((slotA, slotB) => new Date(slotA.startsAt).getTime() - new Date(slotB.startsAt).getTime()),
      );
    }

    return grouped;
  }, [selectableTimeOptions]);

  const availableDateKeys = useMemo(
    () => [...availableSlotsByDate.keys()].sort((dateA, dateB) => dateA.localeCompare(dateB)),
    [availableSlotsByDate],
  );

  const availableMonths = useMemo(
    () => Array.from(new Set(availableDateKeys.map((dateKey) => dateKey.slice(0, 7)))).sort((monthA, monthB) => monthA.localeCompare(monthB)),
    [availableDateKeys],
  );

  const selectedSlotDateKey = selectedTimeOption ? getSlotDateKey(selectedTimeOption.startsAt) : "";
  const firstAvailableDateKey = availableDateKeys[0] ?? "";
  const effectiveSelectedDateKey = selectedSlotDateKey
    || (selectedDateKey && availableSlotsByDate.has(selectedDateKey) ? selectedDateKey : firstAvailableDateKey);
  const fallbackVisibleMonthKey = (effectiveSelectedDateKey || firstAvailableDateKey).slice(0, 7);
  const effectiveVisibleMonthKey =
    visibleMonthKey && availableMonths.includes(visibleMonthKey) ? visibleMonthKey : fallbackVisibleMonthKey;
  const selectedDateSlots = effectiveSelectedDateKey
    ? availableSlotsByDate.get(effectiveSelectedDateKey) ?? EMPTY_TIME_SLOTS
    : EMPTY_TIME_SLOTS;
  const selectedDateSlotGroups = useMemo(
    () => groupSlotsByDayPeriod(selectedDateSlots),
    [selectedDateSlots],
  );

  const calendarCells = useMemo(() => {
    if (!effectiveVisibleMonthKey) {
      return [];
    }

    const [yearLabel, monthLabel] = effectiveVisibleMonthKey.split("-");
    const year = Number(yearLabel);
    const month = Number(monthLabel);

    if (!year || !month) {
      return [];
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
    const leadingPlaceholders = (firstWeekday + 6) % 7;
    const cells: Array<string | null> = Array.from({ length: leadingPlaceholders }, () => null);

    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(`${yearLabel}-${monthLabel}-${day.toString().padStart(2, "0")}`);
    }

    const trailingPlaceholders = (7 - (cells.length % 7)) % 7;

    for (let index = 0; index < trailingPlaceholders; index += 1) {
      cells.push(null);
    }

    return cells;
  }, [effectiveVisibleMonthKey]);

  const contactValues = {
    fullName,
    email,
    phone,
  } satisfies Record<ContactFieldKey, string>;
  const clientFieldErrors = buildContactFieldErrors(contactValues);
  const hasClientContactErrors = Object.values(clientFieldErrors).some(Boolean);
  const canGoToStep2 = Boolean(selectedService);
  const canGoToStep3 = canGoToStep2 && Boolean(selectedTimeOption && !selectedTimeOption.isDisabled);
  const isVoucherValidationPending = voucherApplication.status === "checking";
  const hasBlockingVoucherError = voucherApplication.status === "invalid";
  const canGoToStep4 = canGoToStep3
    && !hasClientContactErrors
    && !isVoucherValidationPending
    && !hasBlockingVoucherError
    && Boolean(fullName.trim() && email.trim());

  const getDisplayedFieldError = (field: ContactFieldKey) => {
    if (touchedFields[field] && clientFieldErrors[field]) {
      return clientFieldErrors[field];
    }

    return serverState.fieldErrors?.[field];
  };

  const resetServiceDependentSelection = (nextServiceId = "") => {
    const nextService = servicesById.get(nextServiceId);
    const refreshedSelection = getRefreshedDateSelection(
      selectedDateKey,
      nextService
        ? getAvailableDateKeysForAvailability(
          currentCatalog,
          nextServiceId,
          nextService.durationMinutes,
          nextService.cleanupBlockMinutes,
        )
        : [],
    );

    setSelectedTimeOptionKey("");
    setSelectedDateKey(refreshedSelection.selectedDateKey);
    setVisibleMonthKey(refreshedSelection.visibleMonthKey);
    lastTrackedTimeOptionKeyRef.current = null;
    contactStartedTrackedRef.current = false;
  };

  const trackBookingStarted = useCallback(() => {
    if (bookingStartedTrackedRef.current) return;

    bookingStartedTrackedRef.current = true;
    trackBookingEvent("Rezervace zahájena", bookingEntrySource);
  }, [bookingEntrySource]);

  useEffect(() => {
    const trackedService = selectedService;

    if (
      !shouldTrackPrefilledServiceSelectionEvent(
        initialSelectedServiceSlug,
        trackedService,
        prefilledServiceTrackedRef.current,
      )
    ) {
      return;
    }

    if (!trackedService) {
      return;
    }

    prefilledServiceTrackedRef.current = true;
    trackBookingStarted();
    serviceSelectedTrackedRef.current = true;
    trackBookingEvent("Služba vybrána", `${trackedService.slug} | předvybraná`);
    trackSelectedServiceMetaEvent(trackedService);
  }, [initialSelectedServiceSlug, selectedService, trackBookingStarted]);

  const trackContactStarted = () => {
    trackInitiateCheckout();

    if (contactStartedTrackedRef.current) {
      return;
    }

    if (!selectedService) {
      return;
    }

    trackBookingStarted();
    contactStartedTrackedRef.current = true;
    trackBookingEvent("Kontakt zahájen", selectedService.slug);
    trackMetaPixelCustomEvent("BookingContactStarted", {
      content_name: selectedService?.name,
      content_category: selectedService?.categoryName,
      content_ids: selectedService ? [selectedService.slug] : undefined,
    });
  };

  const trackContactFieldFocus = () => {
    trackContactStarted();
  };

  const trackContactFieldInput = (field: ContactAnalyticsField, value: string) => {
    trackContactStarted();

    if (!shouldTrackContactFieldInput(trackedContactInputFieldsRef.current, field, value)) {
      return;
    }

    const fieldLabel = {
      email: "e-mail",
      phone: "telefon",
      clientNote: "poznámka",
    }[field];
    trackBookingEvent("Kontaktní pole zahájeno", fieldLabel);
  };

  const selectSlot = (slotOption: TimeSlotOption, source: SlotSelectionSource) => {
    if (slotOption.isDisabled) {
      return;
    }

    markFormChanged();
    const dateKey = getSlotDateKey(slotOption.startsAt);

    setSelectedDateKey(dateKey);
    setSelectedTimeOptionKey(slotOption.key);
    setCurrentStep(3);
    trackSelectedDateMetaEvent(dateKey);
    trackBookingStarted();
    if (selectedService && shouldTrackBookingTimeSelection(lastTrackedTimeOptionKeyRef.current, slotOption.key)) {
      lastTrackedTimeOptionKeyRef.current = slotOption.key;
      trackBookingEvent(
        "Čas vybrán",
        formatBookingMatomoSlotName(slotOption.startsAt, slotOption.endsAt, selectedService.slug),
      );
      trackSelectedTimeMetaEvent(slotOption);
    }
    if (selectedService && source === "suggested") {
      const suggestedSlotPosition = getSuggestedSlotPosition(slotOption, visibleSuggestedSlots);
      if (suggestedSlotPosition !== null) {
        trackBookingEvent(
          "Doporučený termín vybrán",
          formatSuggestedSlotSelectionMatomoName(
            slotOption.startsAt,
            slotOption.endsAt,
            selectedService.slug,
            suggestedSlotPosition,
          ),
        );
      }
    }
    trackInitiateCheckout();
    focusContactStepSection();
  };

  const goToSummary = () => {
    setTouchedFields({
      fullName: true,
      email: true,
      phone: true,
    });

    if (!canGoToStep4) {
      focusContactStepSection();
      return;
    }

    setCurrentStep(4);
    if (!bookingReviewedTrackedRef.current && selectedService) {
      bookingReviewedTrackedRef.current = true;
      trackBookingEvent("Souhrn zobrazen", selectedService.slug);
    }
  };

  useEffect(() => {
    if (serverState.status !== "error" || !serverState.formError) {
      return;
    }

    const errorKey = `${serverState.suggestedStep ?? "unknown"}:${serverState.errorCode ?? "server"}:${serverState.formError}`;

    if (lastFailedBookingKeyRef.current === errorKey) {
      return;
    }

    lastFailedBookingKeyRef.current = errorKey;
    const error = serverState.errorCode === "VALIDATION_ERROR"
      ? "validation"
      : isBookingTermConflictErrorCode(serverState.errorCode, serverState.suggestedStep)
        ? "availability_changed"
        : "server";
    trackBookingEvent("Neúspěšná rezervace", error);
  }, [serverState.errorCode, serverState.formError, serverState.status, serverState.suggestedStep]);

  useEffect(() => {
    if (
      serverState.status !== "error"
      || !isPublicBookingAvailabilityError(serverState.errorCode, serverState.suggestedStep)
    ) {
      return;
    }

    const conflictKey = getAvailabilityRefreshKey({
      availabilityErrorId: serverState.availabilityErrorId,
      retry: catalogRefreshRetry,
      isSubmitting,
    });

    if (!conflictKey || lastRefreshedConflictRef.current === conflictKey) {
      return;
    }

    lastRefreshedConflictRef.current = conflictKey;

    const requestId = catalogRefreshRequestRef.current + 1;
    const requestRevision = formRevisionRef.current;
    catalogRefreshRequestRef.current = requestId;
    setIsRefreshingCatalog(true);
    setCatalogRefreshError("");

    void refreshPublicBookingCatalogAction()
      .then((result) => {
        if (catalogRefreshRequestRef.current !== requestId) {
          return;
        }

        setCurrentCatalog(result.catalog);

        if (!canApplyAvailabilityRefresh(requestRevision, formRevisionRef.current)) {
          return;
        }

        const nextService = result.catalog.services.find((service) => service.id === selectedServiceId);
        const refreshedSelection = getRefreshedDateSelection(
          selectedDateKey,
          nextService
            ? getAvailableDateKeysForAvailability(
              result.catalog,
              selectedServiceId,
              nextService.durationMinutes,
              nextService.cleanupBlockMinutes,
            )
            : [],
        );
        setSelectedTimeOptionKey("");
        setSelectedDateKey(refreshedSelection.selectedDateKey);
        setVisibleMonthKey(refreshedSelection.visibleMonthKey);
        invalidateVoucherApplication();
        setVoucherValidationVersion((value) => value + 1);
        setCurrentStep(2);
        focusAvailableTimesSection();
      })
      .catch(() => {
        if (catalogRefreshRequestRef.current === requestId) {
          setCatalogRefreshError("Aktuální nabídku se nepodařilo načíst. Zkuste to prosím znovu.");
        }
      })
      .finally(() => {
        if (catalogRefreshRequestRef.current === requestId) {
          setIsRefreshingCatalog(false);
        }
      });
  }, [
    catalogRefreshRetry,
    invalidateVoucherApplication,
    selectedDateKey,
    selectedServiceId,
    serverState,
    isSubmitting,
  ]);

  useEffect(() => {
    if (serverState.status !== "success" || !serverState.confirmation) {
      return;
    }

    const bookingId = serverState.confirmation.bookingId;
    if (confirmedBookingIdsRef.current.has(bookingId)) return;

    confirmedBookingIdsRef.current.add(bookingId);
    trackBookingEvent("Vytvořena", selectedService?.slug ?? "unknown_service");
    trackMetaPixelStandardEvent("Schedule", {
      content_type: "service",
      content_name: selectedService?.name ?? serverState.confirmation.serviceName,
      content_category: selectedService?.categoryName,
      content_ids: selectedService ? [selectedService.slug] : undefined,
      duration_minutes: selectedService?.durationMinutes,
    });
  }, [
    selectedService,
    selectedService?.categoryName,
    selectedService?.durationMinutes,
    selectedService?.name,
    selectedService?.priceFromCzk,
    selectedService?.slug,
    serverState.confirmation,
    serverState.status,
  ]);

  useEffect(() => {
    if (serverState.status !== "success" || !serverState.confirmation || successViewportResetRef.current) {
      return;
    }

    successViewportResetRef.current = true;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [serverState.confirmation, serverState.status]);

  const updateVisibleMonth = (nextMonthKey: string) => {
    setVisibleMonthKey(nextMonthKey);
    const firstDateInMonth = availableDateKeys.find((dateKey) =>
      dateKey.startsWith(`${nextMonthKey}-`),
    );
    if (firstDateInMonth) {
      markFormChanged();
      setSelectedDateKey(firstDateInMonth);
      setSelectedTimeOptionKey("");
    }
  };

  if (serverState.status === "success" && serverState.confirmation) {
    return (
      <BookingConfirmationPanel
        confirmation={serverState.confirmation}
        salonContact={{
          name: salonProfile.name,
          email: salonProfile.email,
          phone: salonProfile.phone,
        }}
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        <p className="text-eyebrow text-[var(--color-accent)]">Rezervace</p>
        <div className="space-y-4">
          <h1 className="heading-section text-[var(--color-foreground)]">
            Vyberte si termín, který vám nejlépe vyhovuje.
          </h1>
          <p className="text-body max-w-2xl text-[var(--color-muted)]">
            Rezervace zabere jen chvilku. Nejdřív zvolíte službu, potom nejbližší termín a nakonec doplníte kontakt.
          </p>
        </div>
      </div>

      <form
        action={formAction}
        className="grid gap-5 pb-28 sm:gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:pb-0"
        onSubmitCapture={(event) => {
          if (isSubmitting || isRefreshingCatalog || isVoucherValidationPending) {
            event.preventDefault();
            return;
          }

          if (!canGoToStep4) {
            return;
          }

          lastFailedBookingKeyRef.current = null;
          if (selectedService) trackBookingEvent("Odeslána rezervace", selectedService.slug);
        }}
      >
      <input type="hidden" name="serviceId" value={selectedServiceId} />
      <input type="hidden" name="slotId" value={selectedTimeOption?.slotId ?? ""} />
      <input type="hidden" name="startsAt" value={selectedTimeOption?.startsAt ?? ""} />
      <input type="hidden" name="voucherCode" value={appliedVoucherCode} />

      <div className="space-y-5 sm:space-y-6">
        <section className="rounded-[var(--radius-panel)] border border-black/6 bg-white p-5 shadow-[var(--shadow-panel)] sm:p-7 lg:p-8">
          <BookingProgressPanel
            currentStep={currentStep}
            stepLabels={stepLabels}
          />

          <div className="mt-6 space-y-7 sm:mt-8 sm:space-y-8">
            <BookingServiceStep
              sectionRef={serviceStepSectionRef}
              highlighted={isServiceStepHighlighted}
              categories={serviceCategories}
              effectiveCategoryKey={effectiveCategoryKey}
              visibleServices={visibleServices}
              selectedService={selectedService}
              selectedServiceId={selectedServiceId}
              serviceIdError={serverState.fieldErrors?.serviceId}
              compactSelectedService={Boolean(initialSelectedServiceSlug && selectedServiceId && !isServiceCatalogOpen)}
              onChangeService={() => {
                setIsServiceCatalogOpen(true);
                setCurrentStep(1);
                focusServiceStepSection();
              }}
              onCategorySelect={(categoryKey) => {
                markFormChanged();
                setSelectedCategoryKey(categoryKey);
                invalidateVoucherApplication();
                setSelectedServiceId("");
                setIsServiceCatalogOpen(true);
                resetServiceDependentSelection();
                setCurrentStep(1);
              }}
              onServiceSelect={(serviceId) => {
                markFormChanged();
                const service = servicesById.get(serviceId);
                invalidateVoucherApplication();
                setSelectedServiceId(serviceId);
                setIsServiceCatalogOpen(false);
                resetServiceDependentSelection(serviceId);
                setCurrentStep(2);
                if (service) {
                  trackBookingStarted();
                  trackBookingEvent(
                    serviceSelectedTrackedRef.current ? "Služba změněna" : "Služba vybrána",
                    service.slug,
                  );
                  serviceSelectedTrackedRef.current = true;
                }
                trackSelectedServiceMetaEvent(service);
                focusTermStepSection();
              }}
            />

            <BookingTermStep
              sectionRef={termStepSectionRef}
              availableTimesRef={availableTimesSectionRef}
              highlighted={isTermStepHighlighted}
              selectedService={selectedService}
              selectableTimeOptions={selectableTimeOptions}
              suggestedSlots={suggestedSlots}
              selectedTimeOptionKey={selectedTimeOptionKey}
              availableMonths={availableMonths}
              effectiveVisibleMonthKey={effectiveVisibleMonthKey}
              calendarCells={calendarCells}
              availableSlotsByDate={availableSlotsByDate}
              effectiveSelectedDateKey={effectiveSelectedDateKey}
              selectedDateSlots={selectedDateSlots}
              selectedDateSlotGroups={selectedDateSlotGroups}
              canGoToStep3={canGoToStep3}
              slotError={serverState.fieldErrors?.slotId ?? serverState.fieldErrors?.startsAt}
              onContinue={() => {
                setCurrentStep(3);
                trackInitiateCheckout();
                focusContactStepSection();
              }}
              onReturnToServiceSelection={() => {
                setCurrentStep(1);
                setIsServiceCatalogOpen(true);
                focusServiceStepSection();
              }}
              onSuggestedSlotSelect={(slot) => selectSlot(slot, "suggested")}
              onCalendarSlotSelect={(slot) => selectSlot(slot, "calendar")}
              onSelectDate={(dateKey) => {
                markFormChanged();
                setSelectedDateKey(dateKey);
                trackSelectedDateMetaEvent(dateKey);
                if (selectedSlotDateKey && selectedSlotDateKey !== dateKey) {
                  setSelectedTimeOptionKey("");
                }
                focusAvailableTimesSection();
              }}
              onPreviousMonth={() => {
                const monthIndex = availableMonths.indexOf(effectiveVisibleMonthKey);
                if (monthIndex > 0) {
                  updateVisibleMonth(availableMonths[monthIndex - 1] ?? "");
                }
              }}
              onNextMonth={() => {
                const monthIndex = availableMonths.indexOf(effectiveVisibleMonthKey);
                if (monthIndex < availableMonths.length - 1) {
                  updateVisibleMonth(availableMonths[monthIndex + 1] ?? "");
                }
              }}
            />

            {isRefreshingCatalog || catalogRefreshError ? (
              <div className="rounded-2xl border border-[var(--color-accent)]/20 bg-[var(--color-surface)]/35 px-4 py-3 text-sm text-[var(--color-muted)]" role="status">
                <p>{isRefreshingCatalog ? "Aktualizujeme nabídku dostupných termínů…" : catalogRefreshError}</p>
                {catalogRefreshError ? (
                  <button
                    type="button"
                    onClick={() => setCatalogRefreshRetry((value) => value + 1)}
                    className="mt-3 font-semibold text-[var(--color-foreground)] underline underline-offset-4"
                  >
                    Zkusit načtení znovu
                  </button>
                ) : null}
              </div>
            ) : null}

            <BookingContactStep
              sectionRef={contactStepSectionRef}
              firstContactInputRef={firstContactInputRef}
              highlighted={isContactStepHighlighted}
              fullName={fullName}
              email={email}
              phone={phone}
              clientNote={clientNote}
              clientNoteError={serverState.fieldErrors?.clientNote}
              voucherCode={voucherCode}
              voucherApplication={voucherApplication}
              voucherCodeError={serverState.fieldErrors?.voucherCode}
              contactFormError={
                serverState.status === "error" && serverState.suggestedStep === 3
                  ? serverState.formError
                  : undefined
              }
              getDisplayedFieldError={getDisplayedFieldError}
              onShowSummary={goToSummary}
              onFullNameChange={(value) => {
                setFullName(value);
              }}
              onEmailChange={(value) => {
                setEmail(value);
                trackContactFieldInput("email", value);
              }}
              onPhoneChange={(value) => {
                setPhone(value);
                trackContactFieldInput("phone", value);
              }}
              onClientNoteChange={(value) => {
                setClientNote(value);
                trackContactFieldInput("clientNote", value);
              }}
              onVoucherCodeChange={(value) => {
                markFormChanged();
                invalidateVoucherApplication(value);
                setVoucherCode(value);
              }}
              onFieldFocus={trackContactFieldFocus}
              onFieldBlur={(field) => {
                setTouchedFields((current) => ({ ...current, [field]: true }));
              }}
            />
          </div>
        </section>
      </div>

      <BookingSummarySidebar
        currentStep={currentStep}
        selectedService={selectedService}
        selectedTimeOption={selectedTimeOption}
        fullName={fullName}
        email={email}
        phone={phone}
        voucherCode={voucherCode}
        voucherApplication={voucherApplication}
        canGoToStep4={canGoToStep4}
        isRefreshingCatalog={isRefreshingCatalog}
        serverState={serverState}
        onEditService={() => {
          setCurrentStep(1);
          focusServiceStepSection();
        }}
        onEditTerm={() => {
          setCurrentStep(2);
          focusTermStepSection();
        }}
        onEditContact={() => {
          setCurrentStep(3);
          focusContactStepSection();
        }}
        onStepBack={() => setCurrentStep(Math.max(currentStep - 1, 1))}
      />

      {!selectedService ? null : !selectedTimeOption ? (
        <StickyCTA
          label="Vybrat termín"
          note={`${selectedService.name} • ${selectedService.durationMinutes} min`}
          onClick={() => {
            setCurrentStep(2);
            focusTermStepSection();
          }}
        />
      ) : !canGoToStep4 ? (
        <StickyCTA
          label="Doplnit kontakt"
          note={`${formatSlotDate(selectedTimeOption.startsAt)} • ${formatSlotTime(selectedTimeOption.startsAt)}`}
          onClick={() => {
            setCurrentStep(3);
            trackContactStarted();
            focusContactStepSection();
          }}
        />
      ) : (
        <StickyCTA
          type="submit"
          label="Odeslat rezervaci"
          note={`${formatSlotDate(selectedTimeOption.startsAt)} • ${formatSlotTime(selectedTimeOption.startsAt)}`}
          disabled={!canGoToStep4 || isRefreshingCatalog}
        />
      )}
      </form>
    </>
  );
}
