import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/bcrypt";
import { Prisma } from "@/generated/prisma/client";
import type { TripAccessRole } from "@/lib/auth/tripAccess";
import { buildDayMapPanelData, buildTripDayMapItems, type TripDayMapPanelData } from "@/lib/trips/dayMapData";
import type { TripImportConflictStrategy, TripImportPayloadInput } from "@/lib/validation/tripImportSchemas";

export type CreateTripParams = {
  userId: string;
  name: string;
  startDate: string;
  endDate: string;
  startLocation?: TripLocationInput;
  destinationLocation?: TripLocationInput;
};

export type TripLocationInput = {
  lat: number;
  lng: number;
  label?: string | null;
} | null;

export type TripSummary = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  heroImageUrl: string | null;
  /**
   * Bumped by the hero write, so readers can version the otherwise-stable hero URL.
   *
   * The hero always lands on `hero.<ext>` (the upload route replaces the file in place), so the URL
   * alone is byte-identical before and after a replacement and a cached copy - or a cached 404 -
   * wins forever. Callers stamp this onto the URL, exactly as day images already do with
   * `TripDaySummary.updatedAt`. See `withImageCacheBuster`.
   */
  updatedAt: Date;
  /**
   * Days whose accommodation name is missing or blank - the trip-level mirror of a day's
   * `missingAccommodation`. A stay row that exists with a blank name counts as open, which is the
   * same rule `getTripWithDaysForUser` applies; the two surfaces must not disagree.
   */
  openDayCount: number;
  /** Total day plan items across the trip. Distinguishes "not planned yet" from "plan has holes". */
  planItemCount: number;
  /** Cents. Visible accommodation cost (non-blank name only) plus every plan item cost. */
  plannedCostTotal: number;
  startLocationLabel: string | null;
  destinationLocationLabel: string | null;
};

export type TripHeroSummary = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  heroImageUrl: string | null;
  /** Bumped by the hero write itself, so callers can version the otherwise-stable hero URL. */
  updatedAt: Date;
};

export type TripDaySummary = {
  id: string;
  date: Date;
  dayIndex: number;
  imageUrl: string | null;
  note: string | null;
  updatedAt: Date;
  plannedCostSubtotal: number;
  missingAccommodation: boolean;
  missingPlan: boolean;
  accommodation: {
    id: string;
    name: string;
    notes: string | null;
    status: "planned" | "booked";
    costCents: number | null;
    payments: { amountCents: number; dueDate: string }[];
    link: string | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  } | null;
  dayPlanItems: {
    id: string;
    title: string | null;
    fromTime: string | null;
    toTime: string | null;
    contentJson: string;
    costCents: number | null;
    payments: { amountCents: number; dueDate: string }[];
    linkUrl: string | null;
    location: { lat: number; lng: number; label: string | null } | null;
  }[];
  travelSegments: {
    id: string;
    fromItemType: "accommodation" | "dayPlanItem";
    fromItemId: string;
    toItemType: "accommodation" | "dayPlanItem";
    toItemId: string;
    transportType: "car" | "ship" | "flight";
    durationMinutes: number;
    distanceKm: number | null;
    linkUrl: string | null;
  }[];
};

export type TripWithDays = {
  id: string;
  name: string;
  accessRole: TripAccessRole;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  plannedCostTotal: number;
  accommodationCostTotalCents: number;
  heroImageUrl: string | null;
  /** Bumped by the hero write; see `TripSummary.updatedAt` for why readers need it. */
  updatedAt: Date;
  days: TripDaySummary[];
};

export type TripDayPrintImage = {
  id: string;
  imageUrl: string;
  sortOrder: number;
};

export type TripDayPrintStay = {
  id: string;
  name: string;
  notes: string | null;
  status: "planned" | "booked";
  costCents: number | null;
  link: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  images: TripDayPrintImage[];
};

export type TripDayPrintPlanItem = {
  id: string;
  title: string | null;
  fromTime: string | null;
  toTime: string | null;
  contentJson: string;
  costCents: number | null;
  linkUrl: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  images: TripDayPrintImage[];
};

export type TripDayPrintTravelSegment = TripDaySummary["travelSegments"][number];

export type TripDayPrintTimelineEntry =
  | { kind: "previousStay"; stay: TripDayPrintStay }
  | { kind: "planItem"; item: TripDayPrintPlanItem }
  | { kind: "travelSegment"; segment: TripDayPrintTravelSegment }
  | { kind: "currentStay"; stay: TripDayPrintStay };

export type TripDayPrintPayload = {
  trip: {
    id: string;
    name: string;
  };
  day: {
    id: string;
    date: string;
    dayIndex: number;
    note: string | null;
    imageUrl: string | null;
  };
  timeline: TripDayPrintTimelineEntry[];
  map: TripDayMapPanelData;
};

export type TripExportPayload = {
  trip: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    heroImageUrl: string | null;
    startLocation: { lat: number; lng: number; label: string | null } | null;
    destinationLocation: { lat: number; lng: number; label: string | null } | null;
    createdAt: string;
    updatedAt: string;
  };
  days: {
    id: string;
    date: string;
    dayIndex: number;
    imageUrl: string | null;
    note: string | null;
    createdAt: string;
    updatedAt: string;
    accommodation: {
      id: string;
      name: string;
      notes: string | null;
      status: "planned" | "booked";
      costCents: number | null;
      payments: { amountCents: number; dueDate: string }[];
      link: string | null;
      checkInTime: string | null;
      checkOutTime: string | null;
      location: { lat: number; lng: number; label: string | null } | null;
      createdAt: string;
      updatedAt: string;
    } | null;
    dayPlanItems: {
      id: string;
      title: string | null;
      fromTime: string | null;
      toTime: string | null;
      contentJson: string;
      costCents: number | null;
      payments: { amountCents: number; dueDate: string }[];
      linkUrl: string | null;
      location: { lat: number; lng: number; label: string | null } | null;
      createdAt: string;
      updatedAt: string;
    }[];
  }[];
};

type TripImportConflict = {
  id: string;
  name: string;
};

type ImportTripConflictResult = {
  outcome: "conflict";
  conflicts: TripImportConflict[];
};

type ImportTripSuccessResult = {
  outcome: "imported";
  mode: "overwrite" | "createNew";
  trip: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    heroImageUrl: string | null;
  };
  dayCount: number;
};

export type ImportTripResult = ImportTripConflictResult | ImportTripSuccessResult;

export type TripCollaborator = {
  id: string;
  email: string;
  role: "viewer" | "contributor";
};

export type TripSharing = {
  owner: { email: string };
  collaborators: TripCollaborator[];
};

export type CreateTripCollaboratorParams = {
  ownerUserId: string;
  tripId: string;
  email: string;
  role: "viewer" | "contributor";
  temporaryPassword?: string;
};

export type DeleteTripCollaboratorParams = {
  ownerUserId: string;
  tripId: string;
  memberId: string;
};

export type DeleteTripCollaboratorResult =
  | {
      outcome: "not_found";
    }
  | {
      outcome: "missing";
    }
  | {
      outcome: "deleted";
      collaborators: TripCollaborator[];
    };

export type CreateTripCollaboratorResult =
  | {
      outcome: "created";
      accountAction: "created_account" | "linked_existing_account";
      collaborator: TripCollaborator;
      collaborators: TripCollaborator[];
    }
  | {
      outcome: "conflict";
      reason: "already_member" | "owner_email";
    }
  | {
      outcome: "validation_error";
      field: "temporaryPassword";
      message: string;
    }
  | {
      outcome: "not_found";
    };

const normalizeToUtcDate = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const buildTripDays = (start: Date, end: Date) => {
  const days: { date: Date; dayIndex: number }[] = [];
  const cursor = new Date(start);
  let index = 1;

  while (cursor.getTime() <= end.getTime()) {
    days.push({ date: new Date(cursor), dayIndex: index });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    index += 1;
  }

  return days;
};

const compareDayPlanItemsByStartTime = (
  left: { fromTime: string | null; createdAt: Date; id: string },
  right: { fromTime: string | null; createdAt: Date; id: string },
) => {
  const leftHasStart = Boolean(left.fromTime);
  const rightHasStart = Boolean(right.fromTime);
  if (leftHasStart && rightHasStart) {
    if (left.fromTime !== right.fromTime) return left.fromTime!.localeCompare(right.fromTime!);
  } else if (leftHasStart !== rightHasStart) {
    return leftHasStart ? -1 : 1;
  }

  const leftTime = left.createdAt.getTime();
  const rightTime = right.createdAt.getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
};

const parsePrintablePlanText = (value: string) => {
  try {
    const doc = JSON.parse(value) as { text?: string; content?: unknown[] };
    const parts: string[] = [];

    const walk = (node: { text?: string; content?: unknown[] } | null | undefined) => {
      if (!node) return;
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        node.content.forEach((child) => walk(child as { text?: string; content?: unknown[] }));
      }
    };

    walk(doc);
    return parts.join(" ").trim();
  } catch {
    return "";
  }
};

const buildLocationData = (location?: TripLocationInput) =>
  location === undefined
    ? undefined
    : {
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        label: location?.label ?? null,
      };

const mapTripMemberRole = (role: "VIEWER" | "CONTRIBUTOR"): "viewer" | "contributor" =>
  role === "VIEWER" ? "viewer" : "contributor";

const toTripMemberRole = (role: "viewer" | "contributor") => (role === "viewer" ? "VIEWER" : "CONTRIBUTOR");

const listTripCollaborators = async (
  tx: Prisma.TransactionClient | typeof prisma,
  tripId: string,
  ownerUserId: string,
): Promise<TripCollaborator[]> =>
  tx.tripMember.findMany({
    where: {
      tripId,
      trip: { userId: ownerUserId },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  }).then((rows) =>
    rows.map((row) => ({
      id: row.id,
      email: row.user.email,
      role: mapTripMemberRole(row.role),
    })),
  );

export const createTripWithDays = async ({
  userId,
  name,
  startDate,
  endDate,
  startLocation,
  destinationLocation,
}: CreateTripParams) => {
  const normalizedStart = normalizeToUtcDate(new Date(startDate));
  const normalizedEnd = normalizeToUtcDate(new Date(endDate));
  const startData = buildLocationData(startLocation);
  const destinationData = buildLocationData(destinationLocation);

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        userId,
        name,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        startLocationLat: startData?.lat ?? null,
        startLocationLng: startData?.lng ?? null,
        startLocationLabel: startData?.label ?? null,
        destinationLocationLat: destinationData?.lat ?? null,
        destinationLocationLng: destinationData?.lng ?? null,
        destinationLocationLabel: destinationData?.label ?? null,
      },
    });

    const days = buildTripDays(normalizedStart, normalizedEnd).map((day) => ({
      tripId: trip.id,
      date: day.date,
      dayIndex: day.dayIndex,
    }));

    const created = await tx.tripDay.createMany({ data: days });

    return { trip, dayCount: created.count };
  });
};

export const listTripsForUser = async (userId: string): Promise<TripSummary[]> => {
  // One `findMany`, not one query per trip: calling `getTripWithDaysForUser` in a loop would issue a
  // raw query plus a full day/plan-item/travel-segment tree for every row on the landing surface.
  // (Prisma still expands the nested relations into their own queries - the point is that the cost
  // is fixed, not proportional to the number of trips.) The `where`/`orderBy` stay as they are -
  // shared trips are deliberately not listed here (see the story's Dev Notes), and past-trips-last
  // ordering is applied client-side where "today" is known.
  const trips = await prisma.trip.findMany({
    where: { userId },
    orderBy: { startDate: "asc" },
    include: {
      days: {
        select: {
          accommodation: { select: { name: true, costCents: true } },
          dayPlanItems: { select: { costCents: true } },
        },
      },
    },
  });

  return trips.map((trip) => {
    // Mirrors `getTripWithDaysForUser`'s visible-cost rules verbatim: a stay whose name is blank
    // contributes neither cost nor "has accommodation", so the same trip reads identically here and
    // on the trip overview.
    const hasVisibleAccommodation = (day: (typeof trip.days)[number]) =>
      (day.accommodation?.name?.trim() ?? "").length > 0;
    const getVisibleAccommodationCost = (day: (typeof trip.days)[number]) =>
      hasVisibleAccommodation(day) ? (day.accommodation?.costCents ?? 0) : 0;
    const getVisibleDayPlanCost = (day: (typeof trip.days)[number]) =>
      day.dayPlanItems.reduce((sum, item) => sum + (item.costCents ?? 0), 0);

    return {
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      // `trip.days` is already loaded in full, so counting it here avoids a `_count` subquery.
      dayCount: trip.days.length,
      heroImageUrl: trip.heroImageUrl,
      updatedAt: trip.updatedAt,
      openDayCount: trip.days.filter((day) => !hasVisibleAccommodation(day)).length,
      planItemCount: trip.days.reduce((sum, day) => sum + day.dayPlanItems.length, 0),
      plannedCostTotal: trip.days.reduce(
        (sum, day) => sum + getVisibleAccommodationCost(day) + getVisibleDayPlanCost(day),
        0,
      ),
      startLocationLabel: trip.startLocationLabel,
      destinationLocationLabel: trip.destinationLocationLabel,
    };
  });
};

export type UpdateTripParams = {
  userId: string;
  tripId: string;
  name: string;
  startDate: string;
  endDate: string;
  startLocation?: TripLocationInput;
  destinationLocation?: TripLocationInput;
};

export const updateTripWithDays = async ({
  userId,
  tripId,
  name,
  startDate,
  endDate,
  startLocation,
  destinationLocation,
}: UpdateTripParams) => {
  const normalizedStart = normalizeToUtcDate(new Date(startDate));
  const normalizedEnd = normalizeToUtcDate(new Date(endDate));
  const startData = buildLocationData(startLocation);
  const destinationData = buildLocationData(destinationLocation);

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: {
        id: tripId,
        OR: [{ userId }, { members: { some: { userId, role: "CONTRIBUTOR" } } }],
      },
      include: { days: true },
    });

    if (!trip) {
      return null;
    }

    const newDays = buildTripDays(normalizedStart, normalizedEnd);
    const existingByDate = new Map(trip.days.map((day) => [toDateKey(day.date), day]));
    const retainedDayIds = new Set<string>();

    for (const day of newDays) {
      const existing = existingByDate.get(toDateKey(day.date));
      if (existing) {
        retainedDayIds.add(existing.id);
        if (existing.dayIndex !== day.dayIndex || existing.date.getTime() !== day.date.getTime()) {
          await tx.tripDay.update({
            where: { id: existing.id },
            data: { date: day.date, dayIndex: day.dayIndex },
          });
        }
      } else {
        await tx.tripDay.create({
          data: {
            tripId: trip.id,
            date: day.date,
            dayIndex: day.dayIndex,
          },
        });
      }
    }

    const staleIds = trip.days.filter((day) => !retainedDayIds.has(day.id)).map((day) => day.id);
    if (staleIds.length > 0) {
      await tx.tripDay.deleteMany({ where: { id: { in: staleIds } } });
    }

    const updatedTrip = await tx.trip.update({
      where: { id: trip.id },
      data: {
        name,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        ...(startData
          ? {
              startLocationLat: startData.lat,
              startLocationLng: startData.lng,
              startLocationLabel: startData.label,
            }
          : startLocation !== undefined
          ? {
              startLocationLat: null,
              startLocationLng: null,
              startLocationLabel: null,
            }
          : {}),
        ...(destinationData
          ? {
              destinationLocationLat: destinationData.lat,
              destinationLocationLng: destinationData.lng,
              destinationLocationLabel: destinationData.label,
            }
          : destinationLocation !== undefined
          ? {
              destinationLocationLat: null,
              destinationLocationLng: null,
              destinationLocationLabel: null,
            }
          : {}),
      },
    });

    const dayCount = await tx.tripDay.count({ where: { tripId: trip.id } });

    return { trip: updatedTrip, dayCount };
  });
};

export const getTripWithDaysForUser = async (userId: string, tripId: string): Promise<TripWithDays | null> => {
  const trip = await prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
      userId: true,
      name: true,
      startDate: true,
      endDate: true,
      heroImageUrl: true,
      updatedAt: true,
      members: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
      days: {
        orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
        include: {
          accommodation: {
            select: {
              id: true,
              name: true,
              notes: true,
              status: true,
              costCents: true,
              payments: {
                select: { amountCents: true, dueDate: true },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
              link: true,
              checkInTime: true,
              checkOutTime: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
            },
          },
          dayPlanItems: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              title: true,
              fromTime: true,
              toTime: true,
              createdAt: true,
              contentJson: true,
              costCents: true,
              payments: {
                select: { amountCents: true, dueDate: true },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
              linkUrl: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
            },
          },
          travelSegments: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              fromItemType: true,
              fromItemId: true,
              toItemType: true,
              toItemId: true,
              transportType: true,
              durationMinutes: true,
              distanceKm: true,
              linkUrl: true,
            },
          },
          _count: { select: { dayPlanItems: true } },
        },
      },
      _count: { select: { days: true } },
    },
  });

  if (!trip) {
    return null;
  }

  const accessRole: TripAccessRole =
    trip.userId === userId ? "owner" : mapTripMemberRole(trip.members[0]?.role ?? "VIEWER");

  const dayMetaRows = await prisma.$queryRawUnsafe<
    {
      id: string;
      image_url: string | null;
      note: string | null;
      updated_at: Date | string;
    }[]
  >(`SELECT "id", "image_url", "note", "updated_at" FROM "trip_days" WHERE "trip_id" = ?`, trip.id);
  const dayMetaById = new Map(dayMetaRows.map((row) => [row.id, row]));

  const getVisibleAccommodationCost = (day: (typeof trip.days)[number]) => {
    const accommodationName = day.accommodation?.name?.trim() ?? "";
    if (!accommodationName) return 0;
    return day.accommodation?.costCents ?? 0;
  };

  const getVisibleDayPlanCost = (day: (typeof trip.days)[number]) =>
    day.dayPlanItems.reduce((sum, item) => sum + (item.costCents ?? 0), 0);

  const getVisibleDayTotal = (day: (typeof trip.days)[number]) => getVisibleAccommodationCost(day) + getVisibleDayPlanCost(day);

  const accommodationCostTotalCents = trip.days.reduce((sum, day) => sum + getVisibleAccommodationCost(day), 0);
  const plannedCostTotal = trip.days.reduce((sum, day) => sum + getVisibleDayTotal(day), 0);

  return {
    id: trip.id,
    name: trip.name,
    accessRole,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dayCount: trip._count.days,
    plannedCostTotal,
    accommodationCostTotalCents,
    heroImageUrl: trip.heroImageUrl,
    updatedAt: trip.updatedAt,
    days: trip.days.map((day) => {
      const accommodationName = day.accommodation?.name?.trim() ?? "";
      const hasAccommodation = accommodationName.length > 0;
      const status = day.accommodation?.status === "BOOKED" ? "booked" : "planned";
      const dayMeta = dayMetaById.get(day.id);
      const updatedAt = dayMeta?.updated_at ?? day.updatedAt;

      return {
        id: day.id,
        date: day.date,
        dayIndex: day.dayIndex,
        imageUrl: dayMeta?.image_url ?? day.imageUrl ?? null,
        note: dayMeta?.note ?? day.note ?? null,
        updatedAt: updatedAt instanceof Date ? updatedAt : new Date(updatedAt),
        plannedCostSubtotal: getVisibleDayTotal(day),
        missingAccommodation: !hasAccommodation,
        missingPlan: day._count.dayPlanItems === 0,
        accommodation: hasAccommodation
          ? {
              id: day.accommodation!.id,
              name: accommodationName,
              notes: day.accommodation!.notes,
              status,
              costCents: day.accommodation!.costCents,
              payments: day.accommodation!.payments ?? [],
              link: day.accommodation!.link,
              checkInTime: day.accommodation!.checkInTime ?? null,
              checkOutTime: day.accommodation!.checkOutTime ?? null,
              location:
                day.accommodation!.locationLat !== null && day.accommodation!.locationLng !== null
                  ? {
                      lat: day.accommodation!.locationLat,
                      lng: day.accommodation!.locationLng,
                      label: day.accommodation!.locationLabel,
                    }
                  : null,
            }
          : null,
        dayPlanItems: [...day.dayPlanItems].sort(compareDayPlanItemsByStartTime).map((item) => ({
          id: item.id,
          title: item.title,
          fromTime: item.fromTime,
          toTime: item.toTime,
          contentJson: item.contentJson,
          costCents: item.costCents,
          payments: item.payments ?? [],
          linkUrl: item.linkUrl,
          location:
            item.locationLat !== null && item.locationLng !== null
              ? {
                  lat: item.locationLat,
                  lng: item.locationLng,
                  label: item.locationLabel,
                }
              : null,
        })),
        travelSegments: day.travelSegments.map((segment) => ({
          id: segment.id,
          fromItemType: segment.fromItemType === "ACCOMMODATION" ? "accommodation" : "dayPlanItem",
          fromItemId: segment.fromItemId,
          toItemType: segment.toItemType === "ACCOMMODATION" ? "accommodation" : "dayPlanItem",
          toItemId: segment.toItemId,
          transportType: segment.transportType === "CAR" ? "car" : segment.transportType === "SHIP" ? "ship" : "flight",
          durationMinutes: segment.durationMinutes,
          distanceKm: segment.distanceKm,
          linkUrl: segment.linkUrl,
        })),
      };
    }),
  };
};

export const updateTripDayImageForUser = async ({
  userId,
  tripId,
  dayId,
  imageUrl,
  note,
}: {
  userId: string;
  tripId: string;
  dayId: string;
  imageUrl?: string | null;
  note?: string | null;
}) => {
  const day = await prisma.tripDay.findFirst({
    where: {
      id: dayId,
      tripId,
      trip: { userId },
    },
    select: { id: true },
  });

  if (!day) {
    return null;
  }

  const setClauses: string[] = [];
  const setValues: Array<string | null> = [];

  if (imageUrl !== undefined) {
    setClauses.push(`"image_url" = ?`);
    setValues.push(imageUrl);
  }
  if (note !== undefined) {
    setClauses.push(`"note" = ?`);
    setValues.push(note);
  }

  if (setClauses.length > 0) {
    setClauses.push(`"updated_at" = CURRENT_TIMESTAMP`);
    await prisma.$executeRawUnsafe(
      `UPDATE "trip_days" SET ${setClauses.join(", ")} WHERE "id" = ?`,
      ...setValues,
      day.id,
    );
  }

  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      trip_id: string;
      image_url: string | null;
      note: string | null;
      updated_at: Date | string;
    }[]
  >(`SELECT "id", "trip_id", "image_url", "note", "updated_at" FROM "trip_days" WHERE "id" = ? LIMIT 1`, day.id);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tripId: row.trip_id,
    imageUrl: row.image_url,
    note: row.note,
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
};

const PRINT_ACCOMMODATION_SELECT = {
  id: true,
  name: true,
  notes: true,
  status: true,
  costCents: true,
  link: true,
  checkInTime: true,
  checkOutTime: true,
  locationLat: true,
  locationLng: true,
  locationLabel: true,
} as const;

const mapPrintLocation = (row: {
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
}): { lat: number; lng: number; label: string | null } | null =>
  row.locationLat !== null && row.locationLng !== null
    ? { lat: row.locationLat, lng: row.locationLng, label: row.locationLabel }
    : null;

export const getTripDayPrintPayloadForUser = async ({
  userId,
  tripId,
  dayId,
}: {
  userId: string;
  tripId: string;
  dayId: string;
}): Promise<TripDayPrintPayload | null> => {
  // Round 1 (parallel): access check + target day content
  const [tripAccess, targetDay] = await Promise.all([
    prisma.trip.findFirst({
      where: { id: tripId, OR: [{ userId }, { members: { some: { userId } } }] },
      select: {
        id: true,
        name: true,
        userId: true,
        members: { where: { userId }, select: { role: true }, take: 1 },
      },
    }),
    prisma.tripDay.findFirst({
      where: { id: dayId, tripId },
      select: {
        id: true,
        date: true,
        dayIndex: true,
        note: true,
        imageUrl: true,
        accommodation: { select: PRINT_ACCOMMODATION_SELECT },
        dayPlanItems: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            title: true,
            fromTime: true,
            toTime: true,
            createdAt: true,
            contentJson: true,
            costCents: true,
            linkUrl: true,
            locationLat: true,
            locationLng: true,
            locationLabel: true,
          },
        },
        travelSegments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fromItemType: true,
            fromItemId: true,
            toItemType: true,
            toItemId: true,
            transportType: true,
            durationMinutes: true,
            distanceKm: true,
            linkUrl: true,
          },
        },
      },
    }),
  ]);

  if (!tripAccess || !targetDay) return null;

  const planItemIds = targetDay.dayPlanItems.map((item) => item.id);

  // Round 2 (parallel): previous day accommodation + plan item images
  const [prevDay, planItemImages] = await Promise.all([
    targetDay.dayIndex > 1
      ? prisma.tripDay.findFirst({
          where: { tripId, dayIndex: targetDay.dayIndex - 1 },
          select: { accommodation: { select: PRINT_ACCOMMODATION_SELECT } },
        })
      : Promise.resolve(null),
    planItemIds.length
      ? prisma.dayPlanItemImage.findMany({
          where: { dayPlanItemId: { in: planItemIds } },
          select: { id: true, dayPlanItemId: true, imageUrl: true, sortOrder: true },
          orderBy: [{ dayPlanItemId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const previousStaySummary = prevDay?.accommodation ?? null;
  const currentStaySummary = targetDay.accommodation;

  // Round 3: accommodation images (now we have all IDs including prev day)
  const accommodationIds = [previousStaySummary?.id, currentStaySummary?.id].filter(
    (v): v is string => Boolean(v),
  );
  const accommodationImages = accommodationIds.length
    ? await prisma.accommodationImage.findMany({
        where: { accommodationId: { in: accommodationIds } },
        select: { id: true, accommodationId: true, imageUrl: true, sortOrder: true },
        orderBy: [{ accommodationId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      })
    : [];

  const accommodationImagesById = new Map<string, TripDayPrintImage[]>();
  for (const image of accommodationImages) {
    const existing = accommodationImagesById.get(image.accommodationId) ?? [];
    existing.push({ id: image.id, imageUrl: image.imageUrl, sortOrder: image.sortOrder });
    accommodationImagesById.set(image.accommodationId, existing);
  }

  const planItemImagesById = new Map<string, TripDayPrintImage[]>();
  for (const image of planItemImages) {
    const existing = planItemImagesById.get(image.dayPlanItemId) ?? [];
    existing.push({ id: image.id, imageUrl: image.imageUrl, sortOrder: image.sortOrder });
    planItemImagesById.set(image.dayPlanItemId, existing);
  }

  const toPrintStay = (
    stay: NonNullable<typeof previousStaySummary>,
  ): TripDayPrintStay => ({
    id: stay.id,
    name: stay.name,
    notes: stay.notes,
    status: stay.status === "BOOKED" ? "booked" : "planned",
    costCents: stay.costCents,
    link: stay.link,
    checkInTime: stay.checkInTime,
    checkOutTime: stay.checkOutTime,
    location: mapPrintLocation(stay),
    images: accommodationImagesById.get(stay.id) ?? [],
  });

  const previousStay = previousStaySummary ? toPrintStay(previousStaySummary) : null;
  const currentStay = currentStaySummary ? toPrintStay(currentStaySummary) : null;

  const planItems: TripDayPrintPlanItem[] = [...targetDay.dayPlanItems]
    .sort(compareDayPlanItemsByStartTime)
    .map((item) => ({
      id: item.id,
      title: item.title,
      fromTime: item.fromTime,
      toTime: item.toTime,
      contentJson: item.contentJson,
      costCents: item.costCents,
      linkUrl: item.linkUrl,
      location: mapPrintLocation(item),
      images: planItemImagesById.get(item.id) ?? [],
    }));

  const timeline: TripDayPrintTimelineEntry[] = [];
  const orderedStops: Array<
    | { kind: "previousStay"; stay: TripDayPrintStay; refType: "accommodation"; refId: string }
    | { kind: "planItem"; item: TripDayPrintPlanItem; refType: "dayPlanItem"; refId: string }
    | { kind: "currentStay"; stay: TripDayPrintStay; refType: "accommodation"; refId: string }
  > = [];

  if (previousStay) {
    orderedStops.push({ kind: "previousStay", stay: previousStay, refType: "accommodation", refId: previousStay.id });
  }
  for (const item of planItems) {
    orderedStops.push({ kind: "planItem", item, refType: "dayPlanItem", refId: item.id });
  }
  if (currentStay) {
    orderedStops.push({ kind: "currentStay", stay: currentStay, refType: "accommodation", refId: currentStay.id });
  }

  const mapFromItemType = (t: string) => (t === "ACCOMMODATION" ? "accommodation" : "dayPlanItem");
  const mapTransportType = (t: string) =>
    t === "CAR" ? "car" : t === "SHIP" ? "ship" : ("flight" as const);

  const segmentsByKey = new Map(
    targetDay.travelSegments.map((segment) => [
      `${mapFromItemType(segment.fromItemType)}:${segment.fromItemId}->${mapFromItemType(segment.toItemType)}:${segment.toItemId}`,
      segment,
    ]),
  );

  orderedStops.forEach((entry, index) => {
    if (entry.kind === "previousStay") {
      timeline.push({ kind: "previousStay", stay: entry.stay });
    } else if (entry.kind === "planItem") {
      timeline.push({ kind: "planItem", item: entry.item });
    } else {
      timeline.push({ kind: "currentStay", stay: entry.stay });
    }

    const next = orderedStops[index + 1];
    if (!next) return;

    const rawSeg = segmentsByKey.get(`${entry.refType}:${entry.refId}->${next.refType}:${next.refId}`);
    if (rawSeg) {
      timeline.push({
        kind: "travelSegment",
        segment: {
          id: rawSeg.id,
          fromItemType: mapFromItemType(rawSeg.fromItemType),
          fromItemId: rawSeg.fromItemId,
          toItemType: mapFromItemType(rawSeg.toItemType),
          toItemId: rawSeg.toItemId,
          transportType: mapTransportType(rawSeg.transportType),
          durationMinutes: rawSeg.durationMinutes,
          distanceKm: rawSeg.distanceKm,
          linkUrl: rawSeg.linkUrl,
        },
      });
    }
  });

  const map = buildDayMapPanelData(
    buildTripDayMapItems({
      previousStay: previousStay ? { id: previousStay.id, name: previousStay.name, location: previousStay.location } : null,
      planItems: planItems.map((item, index) => ({
        id: item.id,
        label: item.title?.trim() || parsePrintablePlanText(item.contentJson) || `Activity ${index + 1}`,
        location: item.location,
      })),
      currentStay: currentStay ? { id: currentStay.id, name: currentStay.name, location: currentStay.location } : null,
    }),
  );

  return {
    trip: {
      id: tripAccess.id,
      name: tripAccess.name,
    },
    day: {
      id: targetDay.id,
      date: targetDay.date.toISOString(),
      dayIndex: targetDay.dayIndex,
      note: targetDay.note,
      imageUrl: targetDay.imageUrl,
    },
    timeline,
    map,
  };
};

export const getTripExportForUser = async (userId: string, tripId: string): Promise<TripExportPayload | null> => {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      days: {
        orderBy: [{ dayIndex: "asc" }, { date: "asc" }],
        include: {
          accommodation: {
            select: {
              id: true,
              name: true,
              notes: true,
              status: true,
              costCents: true,
              payments: {
                select: { amountCents: true, dueDate: true },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
              link: true,
              checkInTime: true,
              checkOutTime: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          dayPlanItems: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              title: true,
              fromTime: true,
              toTime: true,
              contentJson: true,
              costCents: true,
              payments: {
                select: { amountCents: true, dueDate: true },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
              linkUrl: true,
              locationLat: true,
              locationLng: true,
              locationLabel: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!trip) {
    return null;
  }

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate.toISOString(),
      endDate: trip.endDate.toISOString(),
      heroImageUrl: trip.heroImageUrl,
      startLocation:
        trip.startLocationLat !== null && trip.startLocationLng !== null
          ? {
              lat: trip.startLocationLat,
              lng: trip.startLocationLng,
              label: trip.startLocationLabel,
            }
          : null,
      destinationLocation:
        trip.destinationLocationLat !== null && trip.destinationLocationLng !== null
          ? {
              lat: trip.destinationLocationLat,
              lng: trip.destinationLocationLng,
              label: trip.destinationLocationLabel,
            }
          : null,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    },
    days: trip.days.map((day) => ({
      id: day.id,
      date: day.date.toISOString(),
      dayIndex: day.dayIndex,
      imageUrl: day.imageUrl,
      note: day.note,
      createdAt: day.createdAt.toISOString(),
      updatedAt: day.updatedAt.toISOString(),
      accommodation: day.accommodation
        ? {
            id: day.accommodation.id,
            name: day.accommodation.name,
            notes: day.accommodation.notes,
            status: day.accommodation.status === "BOOKED" ? "booked" : "planned",
            costCents: day.accommodation.costCents,
            payments:
              day.accommodation.payments && day.accommodation.payments.length > 0
                ? day.accommodation.payments
                : day.accommodation.costCents !== null
                  ? [
                      {
                        amountCents: day.accommodation.costCents,
                        dueDate: day.date.toISOString().slice(0, 10),
                      },
                    ]
                  : [],
            link: day.accommodation.link,
            checkInTime: day.accommodation.checkInTime ?? null,
            checkOutTime: day.accommodation.checkOutTime ?? null,
            location:
              day.accommodation.locationLat !== null && day.accommodation.locationLng !== null
                ? {
                    lat: day.accommodation.locationLat,
                    lng: day.accommodation.locationLng,
                    label: day.accommodation.locationLabel,
                  }
                : null,
            createdAt: day.accommodation.createdAt.toISOString(),
            updatedAt: day.accommodation.updatedAt.toISOString(),
          }
        : null,
      dayPlanItems: day.dayPlanItems.map((item) => ({
        id: item.id,
        title: item.title,
        fromTime: item.fromTime,
        toTime: item.toTime,
        contentJson: item.contentJson,
        costCents: item.costCents,
        payments:
          item.payments && item.payments.length > 0
            ? item.payments
            : item.costCents !== null
              ? [
                  {
                    amountCents: item.costCents,
                    dueDate: day.date.toISOString().slice(0, 10),
                  },
                ]
              : [],
        linkUrl: item.linkUrl,
        location:
          item.locationLat !== null && item.locationLng !== null
            ? {
                lat: item.locationLat,
                lng: item.locationLng,
                label: item.locationLabel,
              }
            : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    })),
  };
};

const toAccommodationStatus = (status: "planned" | "booked") => (status === "booked" ? "BOOKED" : "PLANNED");

const sortImportDays = (days: TripImportPayloadInput["days"]) =>
  [...days].sort((left, right) => {
    if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
    return new Date(left.date).getTime() - new Date(right.date).getTime();
  });

const createImportedDays = async ({
  tx,
  tripId,
  sortedDays,
}: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  tripId: string;
  sortedDays: TripImportPayloadInput["days"];
}) => {
  for (const day of sortedDays) {
    const createdDay = await tx.tripDay.create({
      data: {
        tripId,
        date: new Date(day.date),
        dayIndex: day.dayIndex,
        imageUrl: day.imageUrl ?? null,
        note: day.note ?? null,
      },
    });

    if (day.accommodation) {
      const accommodation = await tx.accommodation.create({
        data: {
          tripDayId: createdDay.id,
          name: day.accommodation.name,
          notes: day.accommodation.notes,
          status: toAccommodationStatus(day.accommodation.status),
          costCents: day.accommodation.costCents,
          link: day.accommodation.link,
          checkInTime: day.accommodation.checkInTime ?? null,
          checkOutTime: day.accommodation.checkOutTime ?? null,
          locationLat: day.accommodation.location?.lat ?? null,
          locationLng: day.accommodation.location?.lng ?? null,
          locationLabel: day.accommodation.location?.label ?? null,
        },
      });
      const accommodationPayments =
        day.accommodation.payments && day.accommodation.payments.length > 0
          ? day.accommodation.payments
          : day.accommodation.costCents !== null
            ? [
                {
                  amountCents: day.accommodation.costCents,
                  dueDate: day.date.slice(0, 10),
                },
              ]
            : [];
      if (accommodationPayments.length > 0) {
        await tx.costPayment.createMany({
          data: accommodationPayments.map((payment, index) => ({
            accommodationId: accommodation.id,
            amountCents: payment.amountCents,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }

    for (const item of day.dayPlanItems) {
      const createdItem = await tx.dayPlanItem.create({
        data: {
          tripDayId: createdDay.id,
          title: item.title ?? null,
          fromTime: item.fromTime ?? null,
          toTime: item.toTime ?? null,
          contentJson: item.contentJson,
          costCents: item.costCents ?? null,
          linkUrl: item.linkUrl,
          locationLat: item.location?.lat ?? null,
          locationLng: item.location?.lng ?? null,
          locationLabel: item.location?.label ?? null,
        },
      });
      const itemPayments =
        item.payments && item.payments.length > 0
          ? item.payments
          : item.costCents !== null
            ? [
                {
                  amountCents: item.costCents,
                  dueDate: day.date.slice(0, 10),
                },
              ]
            : [];
      if (itemPayments.length > 0) {
        await tx.costPayment.createMany({
          data: itemPayments.map((payment, index) => ({
            dayPlanItemId: createdItem.id,
            amountCents: payment.amountCents,
            dueDate: payment.dueDate,
            sortOrder: index,
          })),
        });
      }
    }
  }
};

export const importTripFromExportForUser = async ({
  userId,
  payload,
  strategy,
  targetTripId,
}: {
  userId: string;
  payload: TripImportPayloadInput;
  strategy?: TripImportConflictStrategy;
  targetTripId?: string;
}): Promise<ImportTripResult> => {
  const sameNameTrips = await prisma.trip.findMany({
    where: {
      userId,
      name: payload.trip.name,
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (!strategy && sameNameTrips.length > 0) {
    return {
      outcome: "conflict",
      conflicts: sameNameTrips,
    };
  }

  const sortedDays = sortImportDays(payload.days);

  if (strategy === "overwrite") {
    if (!targetTripId) {
      throw new Error("target_trip_required");
    }
    if (!sameNameTrips.some((trip) => trip.id === targetTripId)) {
      throw new Error("target_trip_not_conflict");
    }

    return prisma.$transaction(async (tx) => {
      const targetTrip = await tx.trip.findFirst({
        where: {
          id: targetTripId,
          userId,
        },
      });

      if (!targetTrip) {
        throw new Error("target_trip_not_found");
      }

      const updatedTrip = await tx.trip.update({
        where: { id: targetTrip.id },
        data: {
          name: payload.trip.name,
          startDate: new Date(payload.trip.startDate),
          endDate: new Date(payload.trip.endDate),
          heroImageUrl: payload.trip.heroImageUrl,
          ...(payload.trip.startLocation === undefined
            ? {}
            : {
                startLocationLat: payload.trip.startLocation?.lat ?? null,
                startLocationLng: payload.trip.startLocation?.lng ?? null,
                startLocationLabel: payload.trip.startLocation?.label ?? null,
              }),
          ...(payload.trip.destinationLocation === undefined
            ? {}
            : {
                destinationLocationLat: payload.trip.destinationLocation?.lat ?? null,
                destinationLocationLng: payload.trip.destinationLocation?.lng ?? null,
                destinationLocationLabel: payload.trip.destinationLocation?.label ?? null,
              }),
        },
      });

      await tx.tripDay.deleteMany({ where: { tripId: targetTrip.id } });
      await createImportedDays({
        tx,
        tripId: targetTrip.id,
        sortedDays,
      });

      return {
        outcome: "imported",
        mode: "overwrite",
        trip: {
          id: updatedTrip.id,
          name: updatedTrip.name,
          startDate: updatedTrip.startDate,
          endDate: updatedTrip.endDate,
          heroImageUrl: updatedTrip.heroImageUrl,
        },
        dayCount: sortedDays.length,
      };
    });
  }

  return prisma.$transaction(async (tx) => {
    const createdTrip = await tx.trip.create({
      data: {
        userId,
        name: payload.trip.name,
        startDate: new Date(payload.trip.startDate),
        endDate: new Date(payload.trip.endDate),
        heroImageUrl: payload.trip.heroImageUrl,
        startLocationLat: payload.trip.startLocation?.lat ?? null,
        startLocationLng: payload.trip.startLocation?.lng ?? null,
        startLocationLabel: payload.trip.startLocation?.label ?? null,
        destinationLocationLat: payload.trip.destinationLocation?.lat ?? null,
        destinationLocationLng: payload.trip.destinationLocation?.lng ?? null,
        destinationLocationLabel: payload.trip.destinationLocation?.label ?? null,
      },
    });

    await createImportedDays({
      tx,
      tripId: createdTrip.id,
      sortedDays,
    });

    return {
      outcome: "imported",
      mode: "createNew",
      trip: {
        id: createdTrip.id,
        name: createdTrip.name,
        startDate: createdTrip.startDate,
        endDate: createdTrip.endDate,
        heroImageUrl: createdTrip.heroImageUrl,
      },
      dayCount: sortedDays.length,
    };
  });
};

export const deleteTripForUser = async (userId: string, tripId: string) => {
  const result = await prisma.trip.deleteMany({
    where: { id: tripId, userId },
  });

  return result.count > 0;
};

export const getTripSharingForOwner = async (
  ownerUserId: string,
  tripId: string,
): Promise<TripSharing | null> => {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: ownerUserId },
    select: {
      id: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!trip) {
    return null;
  }

  const collaborators = await listTripCollaborators(prisma, tripId, ownerUserId);

  return {
    owner: { email: trip.user.email },
    collaborators,
  };
};

/**
 * Removes a single collaborator's membership from one trip.
 *
 * Deliberately deletes the `TripMember` row only: the `User` account is a separate model with its own
 * lifecycle (Story 5.1 provisions accounts on invite), may own trips, and may hold memberships on other
 * trips. Deleting the account here would silently destroy unrelated data.
 *
 * Tenancy lives in the `where` clause rather than a preceding `if`, so the lookup that finds the row is
 * the same query that proves the caller owns it.
 */
export const deleteTripCollaboratorForOwner = async ({
  ownerUserId,
  tripId,
  memberId,
}: DeleteTripCollaboratorParams): Promise<DeleteTripCollaboratorResult> =>
  prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, userId: ownerUserId },
      select: { id: true },
    });

    if (!trip) {
      return { outcome: "not_found" } satisfies DeleteTripCollaboratorResult;
    }

    // A single guarded `deleteMany` rather than `findFirst` then `delete`: the same statement both
    // finds the row and proves the caller owns it, and a concurrent duplicate removal reports
    // `missing` (→ 404) instead of throwing Prisma `P2025` out into the route's 500 branch.
    const removed = await tx.tripMember.deleteMany({
      where: {
        id: memberId,
        tripId,
        trip: { userId: ownerUserId },
      },
    });

    if (removed.count === 0) {
      return { outcome: "missing" } satisfies DeleteTripCollaboratorResult;
    }

    const collaborators = await listTripCollaborators(tx, tripId, ownerUserId);

    return { outcome: "deleted", collaborators } satisfies DeleteTripCollaboratorResult;
  });

export const createTripCollaboratorForOwner = async ({
  ownerUserId,
  tripId,
  email,
  role,
  temporaryPassword,
}: CreateTripCollaboratorParams): Promise<CreateTripCollaboratorResult> => {
  const normalizedEmail = email.trim().toLowerCase();

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, userId: ownerUserId },
      select: { id: true },
    });

    if (!trip) {
      return { outcome: "not_found" } satisfies CreateTripCollaboratorResult;
    }

    const existingUser = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
      },
    });

    if (existingUser?.id === ownerUserId) {
      return { outcome: "conflict", reason: "owner_email" } satisfies CreateTripCollaboratorResult;
    }

    if (existingUser) {
      const duplicate = await tx.tripMember.findUnique({
        where: {
          tripId_userId: {
            tripId,
            userId: existingUser.id,
          },
        },
        select: { id: true },
      });

      if (duplicate) {
        return { outcome: "conflict", reason: "already_member" } satisfies CreateTripCollaboratorResult;
      }

      try {
        const membership = await tx.tripMember.create({
          data: {
            tripId,
            userId: existingUser.id,
            role: toTripMemberRole(role),
          },
          select: {
            id: true,
            user: {
              select: {
                email: true,
              },
            },
          },
        });

        const collaborators = await listTripCollaborators(tx, tripId, ownerUserId);

        return {
          outcome: "created",
          accountAction: "linked_existing_account",
          collaborator: {
            id: membership.id,
            email: membership.user.email,
            role,
          },
          collaborators,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { outcome: "conflict", reason: "already_member" } satisfies CreateTripCollaboratorResult;
        }

        throw error;
      }
    }

    if (!temporaryPassword) {
      return {
        outcome: "validation_error",
        field: "temporaryPassword",
        message: "Temporary password is required for new collaborator accounts",
      } satisfies CreateTripCollaboratorResult;
    }

    const passwordHash = await hashPassword(temporaryPassword);
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: "VIEWER",
        mustChangePassword: true,
      },
      select: { id: true, email: true },
    });

    try {
      const membership = await tx.tripMember.create({
        data: {
          tripId,
          userId: user.id,
          role: toTripMemberRole(role),
        },
        select: {
          id: true,
        },
      });

      const collaborators = await listTripCollaborators(tx, tripId, ownerUserId);

      return {
        outcome: "created",
        accountAction: "created_account",
        collaborator: {
          id: membership.id,
          email: user.email,
          role,
        },
        collaborators,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { outcome: "conflict", reason: "already_member" } satisfies CreateTripCollaboratorResult;
      }

      throw error;
    }
  });
};

export const getTripByIdForUser = async (userId: string, tripId: string) =>
  prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true },
  });

export const getTripDayByIdForUser = async ({
  userId,
  tripId,
  dayId,
}: {
  userId: string;
  tripId: string;
  dayId: string;
}) =>
  prisma.tripDay.findFirst({
    where: {
      id: dayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId } } }],
      },
    },
    select: { id: true, tripId: true },
  });

export type DayRoutePoint = {
  id: string;
  kind: "previousStay" | "planItem" | "currentStay";
  lat: number;
  lng: number;
};

export const getDayRoutePointsForUser = async ({
  userId,
  tripId,
  dayId,
}: {
  userId: string;
  tripId: string;
  dayId: string;
}): Promise<DayRoutePoint[] | null> => {
  const day = await prisma.tripDay.findFirst({
    where: {
      id: dayId,
      tripId,
      trip: {
        OR: [{ userId }, { members: { some: { userId } } }],
      },
    },
    select: {
      id: true,
      dayIndex: true,
      accommodation: {
        select: {
          id: true,
          locationLat: true,
          locationLng: true,
        },
      },
      dayPlanItems: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          locationLat: true,
          locationLng: true,
        },
      },
    },
  });

  if (!day) {
    return null;
  }

  const previousDay = await prisma.tripDay.findFirst({
    where: {
      tripId,
      dayIndex: { lt: day.dayIndex },
    },
    orderBy: [{ dayIndex: "desc" }, { date: "desc" }],
    select: {
      accommodation: {
        select: {
          id: true,
          locationLat: true,
          locationLng: true,
        },
      },
    },
  });

  const points: DayRoutePoint[] = [];
  const previousAccommodation = previousDay?.accommodation;

  if (previousAccommodation?.locationLat != null && previousAccommodation.locationLng != null) {
    points.push({
      id: `prev-${previousAccommodation.id}`,
      kind: "previousStay",
      lat: previousAccommodation.locationLat,
      lng: previousAccommodation.locationLng,
    });
  }

  for (const item of day.dayPlanItems) {
    if (item.locationLat === null || item.locationLng === null) {
      continue;
    }
    points.push({
      id: item.id,
      kind: "planItem",
      lat: item.locationLat,
      lng: item.locationLng,
    });
  }

  const currentAccommodation = day.accommodation;
  if (currentAccommodation?.locationLat != null && currentAccommodation.locationLng != null) {
    points.push({
      id: `curr-${currentAccommodation.id}`,
      kind: "currentStay",
      lat: currentAccommodation.locationLat,
      lng: currentAccommodation.locationLng,
    });
  }

  return points;
};

export const updateTripHeroImageForUser = async ({
  userId,
  tripId,
  heroImageUrl,
}: {
  userId: string;
  tripId: string;
  heroImageUrl: string | null;
}): Promise<TripHeroSummary | null> =>
  prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: tripId, userId },
      include: { _count: { select: { days: true } } },
    });

    if (!trip) {
      return null;
    }

    const updated = await tx.trip.update({
      where: { id: trip.id },
      data: { heroImageUrl },
    });

    return {
      id: updated.id,
      name: updated.name,
      startDate: updated.startDate,
      endDate: updated.endDate,
      dayCount: trip._count.days,
      heroImageUrl: updated.heroImageUrl,
      updatedAt: updated.updatedAt,
    };
  });
