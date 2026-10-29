import type { TravelSegmentItemType, TravelTransportType } from "@/generated/prisma/enums";
import type { PaymentDetail } from "@/lib/repositories/paymentDetail";
import type {
  PlannerCost,
  PlannerDay,
  PlannerItem,
  PlannerLeg,
  PlannerLocation,
  PlannerMedia,
  PlannerStay,
} from "@/lib/repositories/connectorReadRepo";
import type { ParkedDayPlanItemDetail } from "@/lib/repositories/bucketListRepo";
import type { TripSummary, TripWithDays } from "@/lib/repositories/tripRepo";
import type { DayPlanConflict } from "@/lib/trips/planConflicts";
import { tiptapDocToPlainText } from "@/lib/trips/planText";
import { DEFAULT_CHECK_OUT_TIME, resolveCheckOutTime } from "@/lib/trips/stayTimes";
import { timeToMinutes } from "@/lib/trips/daySchedule";
import type { TransportType } from "@/lib/trips/transportTypes";

/**
 * Story 15.2, AC 1-8, 11. Repository rows as the JSON the read tools hand to the model. Pure, so the
 * shapes are tested without the SDK. Dates `YYYY-MM-DD` (UTC, never local time), times `HH:MM`,
 * timestamps ISO 8601, money in EUR cents with the original currency beside it. Files are named by id
 * and file name only: no URL or storage path ever leaves here (15.7's `get_file` takes the id).
 */

export const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

/** `Record` over the enum, so a new transport mode is a compile error here rather than a silent gap. */
const TRANSPORT_MODES: Record<TravelTransportType, TransportType> = {
  CAR: "car",
  SHIP: "ship",
  FLIGHT: "flight",
  WALKING: "walking",
  CYCLING: "cycling",
  TRAIN: "train",
  BUS: "bus",
};

const ENDPOINT_TYPES: Record<TravelSegmentItemType, "stay" | "activity"> = {
  ACCOMMODATION: "stay",
  DAY_PLAN_ITEM: "activity",
};

export const toCost = (row: Omit<PlannerCost, "payments">) => {
  if (row.costCents === null) return null;
  const original =
    row.costOriginalAmount !== null && row.costCurrency !== null && row.costRate !== null && row.costRateDate !== null
      ? { amountMinor: row.costOriginalAmount, currency: row.costCurrency, rate: row.costRate, rateDate: row.costRateDate }
      : null;
  return { eurCents: row.costCents, original };
};

export const toPayments = (payments: PaymentDetail[]) =>
  payments.map((payment) =>
    payment.amountOriginal === undefined
      ? { amountEurCents: payment.amountCents, dueDate: payment.dueDate }
      : { amountEurCents: payment.amountCents, dueDate: payment.dueDate, amountOriginalMinor: payment.amountOriginal },
  );

export const toWarning = (conflict: DayPlanConflict) =>
  conflict.kind === "late"
    ? {
        kind: "late" as const,
        activityId: conflict.itemId,
        title: conflict.title,
        startTime: conflict.fromTime,
        reachableAt: conflict.reachableAt,
        lateMinutes: conflict.lateMinutes,
      }
    : { kind: "overflow" as const, activityId: conflict.itemId, title: conflict.title };

/** The last path segment of a stored image URL, which stands in for the name images do not have. */
export const fileNameOfUrl = (url: string) => {
  const path = url.split(/[?#]/)[0];
  const segment = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export const toFiles = (media: PlannerMedia) => ({
  documents: media.documents.map((document) => ({ id: document.id, fileName: document.fileName })),
  images: media.images.map((image) => ({ id: image.id, fileName: fileNameOfUrl(image.imageUrl) })),
});

const toPlace = (location: PlannerLocation) =>
  location ? { label: location.label, lat: location.lat, lng: location.lng } : null;

type ActivitySource = Omit<PlannerItem, keyof PlannerMedia | "title"> & { title: string | null };

const NO_MEDIA: PlannerMedia = { documents: [], images: [] };

/** One activity, on a day (`withTimes`) or in the bucket list (no times; always flexible there). */
export const toActivity = (item: ActivitySource, media: PlannerMedia | undefined, options: { withTimes: boolean }) => ({
  id: item.id,
  title: item.title?.trim() ? item.title : null,
  description: tiptapDocToPlainText(item.contentJson),
  mode: item.scheduleMode === "FIXED" ? ("fixed" as const) : ("flexible" as const),
  durationMinutes: item.durationMinutes,
  ...(options.withTimes ? { startTime: item.fromTime, endTime: item.toTime } : {}),
  place: toPlace(item.location),
  link: item.linkUrl,
  cost: toCost(item),
  payments: toPayments(item.payments),
  ...toFiles(media ?? NO_MEDIA),
  updatedAt: item.updatedAt.toISOString(),
});

export const toLeg = (leg: PlannerLeg) => ({
  id: leg.id,
  from: { type: ENDPOINT_TYPES[leg.fromItemType], id: leg.fromItemId },
  to: { type: ENDPOINT_TYPES[leg.toItemType], id: leg.toItemId },
  mode: TRANSPORT_MODES[leg.transportType],
  durationMinutes: leg.durationMinutes,
  distanceKm: leg.distanceKm,
  link: leg.linkUrl,
  updatedAt: leg.updatedAt.toISOString(),
});

export const toStay = (stay: PlannerStay) => ({
  id: stay.id,
  name: stay.name,
  status: stay.status === "BOOKED" ? ("booked" as const) : ("planned" as const),
  checkInTime: stay.checkInTime,
  checkOutTime: stay.checkOutTime,
  place: toPlace(stay.location),
  link: stay.link,
  notes: stay.notes,
  cost: toCost(stay),
  payments: toPayments(stay.payments),
  ...toFiles(stay),
  updatedAt: stay.updatedAt.toISOString(),
});

/**
 * Last night's stay with the check-out the day actually starts from (AC 3): the stored time, or 10:00 when
 * none is stored or it does not read as `HH:MM`, the rule `resolveDayStartMinute` schedules by.
 */
const toPreviousStay = (stay: PlannerDay["previousStay"]) => {
  if (!stay) return null;
  const checkOutTime = resolveCheckOutTime(stay.checkOutTime);
  return {
    id: stay.id,
    name: stay.name,
    checkOutTime: timeToMinutes(checkOutTime) === null ? DEFAULT_CHECK_OUT_TIME : checkOutTime,
  };
};

export const toPlannerDay = (day: PlannerDay) => ({
  id: day.id,
  date: toDateKey(day.date),
  dayIndex: day.dayIndex,
  previousStay: toPreviousStay(day.previousStay),
  activities: day.items.map((item) => toActivity(item, item, { withTimes: true })),
  legs: day.legs.map(toLeg),
  stay: day.stay ? toStay(day.stay) : null,
  missingStay: day.missingStay,
  warnings: day.warnings.map(toWarning),
});

/** `list_trips`: the caller has already dropped trips it may only view. */
export const toTripListEntry = (trip: TripSummary) => ({
  id: trip.id,
  name: trip.name,
  startDate: toDateKey(trip.startDate),
  endDate: toDateKey(trip.endDate),
  role: trip.accessRole === "owner" ? ("owner" as const) : ("contributor" as const),
  dayCount: trip.dayCount,
});

/** `get_trip`: the overview per day. No cost totals (Tommy, 2026-10-29); costs are read per entry. */
export const toTripOverview = (trip: TripWithDays) => ({
  id: trip.id,
  name: trip.name,
  startDate: toDateKey(trip.startDate),
  endDate: toDateKey(trip.endDate),
  days: trip.days.map((day) => ({
    id: day.id,
    date: toDateKey(day.date),
    dayIndex: day.dayIndex,
    stay: day.accommodation ? { name: day.accommodation.name, status: day.accommodation.status } : null,
    missingStay: day.missingAccommodation,
    activityCount: day.dayPlanItems.length,
    warnings: day.planConflicts.map(toWarning),
  })),
});

export const toBucketActivity = (item: ParkedDayPlanItemDetail, media: PlannerMedia | undefined) =>
  toActivity({ ...item, scheduleMode: "FLEXIBLE", fromTime: null, toTime: null }, media, { withTimes: false });
