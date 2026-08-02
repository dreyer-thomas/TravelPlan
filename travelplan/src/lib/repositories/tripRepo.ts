import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/bcrypt";
import { Prisma } from "@/generated/prisma/client";
import type { TravelSegmentItemType, TravelTransportType } from "@/generated/prisma/enums";
import type { TripAccessRole } from "@/lib/auth/tripAccess";
import { buildDayMapPanelData, buildTripDayMapItems, type TripDayMapPanelData } from "@/lib/trips/dayMapData";
import { getTripUploadDir, resolvePublicFilePath } from "@/lib/trips/uploadPaths";
import { sniffPhotoContentType } from "@/lib/trips/importPackage";
import {
  discardStashedTripUploadDir,
  planAccommodationGalleryPhoto,
  planDayPlanItemGalleryPhoto,
  planTripDayPhoto,
  planTripHeroPhoto,
  restoreStashedTripUploadDir,
  stashTripUploadDir,
  writeImportedPhotos,
  type PlannedPhotoWrite,
} from "@/lib/trips/importPhotos";
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

/**
 * One member of the export archive's photo pool.
 *
 * The bytes are *not* here - `archivePath` names the archive member that carries them, and the
 * export route streams that member straight off disk. Entities reference the pool by id so a file
 * referenced twice is stored once.
 */
export type TripExportPhoto = {
  contentType: string;
  archivePath: string;
};

/** Gallery entry in the export manifest. Deliberately no `id` and no `imageUrl`: the source row id is
 * meaningless to an importer and the old `/uploads/` URL is a dead link on the target server. The
 * `sortOrder` is the only thing that has to survive. */
export type TripExportImageRef = {
  sortOrder: number;
  photoId: string;
};

export type TripExportTravelSegment = {
  id: string;
  fromItemType: "accommodation" | "dayPlanItem";
  /**
   * The `id` of this day's exported `accommodation` / `dayPlanItems` record.
   *
   * Story 2.32 regenerates every cuid on import and can only rewire a segment by matching these
   * against the exported record ids. Dropping them - or emitting positional indexes instead -
   * silently breaks the import half. Note that `TravelSegment` carries a unique constraint on
   * `(tripDayId, fromItemType, fromItemId, toItemType, toItemId)`, so an importer whose remap
   * collapses two distinct source ids onto one new id will hit a P2002.
   */
  fromItemId: string;
  toItemType: "accommodation" | "dayPlanItem";
  toItemId: string;
  transportType: "car" | "ship" | "flight";
  durationMinutes: number;
  distanceKm: number | null;
  linkUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TripExportBucketListItem = {
  id: string;
  title: string;
  description: string | null;
  positionText: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type TripExportPayload = {
  /**
   * Surfaced as `meta.warnings` in the manifest. Always present, `[]` when clean - an optional field
   * would make every consumer branch on absence for no reason. Holds one line per image row that was
   * skipped (file gone from disk, or a stored URL that does not resolve inside the trip's own upload
   * directory), so a skipped photo is visible rather than silent.
   */
  warnings: string[];
  /** Photo pool, keyed `p1`, `p2`, ... in traversal order. `{}` for a trip with no photos. */
  photos: Record<string, TripExportPhoto>;
  trip: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    /** v1 field, kept verbatim - a v1 reader and the existing import schema both still read it. */
    heroImageUrl: string | null;
    heroPhotoId: string | null;
    startLocation: { lat: number; lng: number; label: string | null } | null;
    destinationLocation: { lat: number; lng: number; label: string | null } | null;
    createdAt: string;
    updatedAt: string;
    /** Trip-scoped, so it lives inside `trip` and not at the manifest root. */
    bucketListItems: TripExportBucketListItem[];
  };
  days: {
    id: string;
    date: string;
    dayIndex: number;
    /** v1 field, kept verbatim. */
    imageUrl: string | null;
    imagePhotoId: string | null;
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
      images: TripExportImageRef[];
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
      images: TripExportImageRef[];
    }[];
    travelSegments: TripExportTravelSegment[];
  }[];
};

/**
 * What `getTripExportForUser` hands back: the manifest payload plus the on-disk location of every
 * pooled photo, already in pool-key order, so the route can stream each member without re-deriving
 * (or re-validating) a single path.
 */
export type TripExportResult = {
  payload: TripExportPayload;
  photoFiles: { archivePath: string; filePath: string }[];
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
  /** Counts the UI confirms a complete restore against - see Story 2.32 Task 4. */
  travelSegmentCount: number;
  bucketListItemCount: number;
  /** Photo *files* written to upload storage, not pool entries: one per restored image slot. */
  photoCount: number;
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

/**
 * Extension allow-list for pooled photos, mirroring the set the three upload routes accept
 * (`ALLOWED_TYPES` in e.g. `accommodations/images/route.ts`). Anything else lands as `bin` /
 * `application/octet-stream` rather than being guessed at.
 */
const EXPORT_PHOTO_CONTENT_TYPES = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
const EXPORT_PHOTO_FALLBACK_EXTENSION = "bin";
const EXPORT_PHOTO_FALLBACK_CONTENT_TYPE = "application/octet-stream";

const toExportPhotoExtension = (imageUrl: string) => {
  const fileName = imageUrl.split("/").pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
  return EXPORT_PHOTO_CONTENT_TYPES.has(extension) ? extension : EXPORT_PHOTO_FALLBACK_EXTENSION;
};

// Same wire vocabulary the rest of the app uses; shape copied from `travelSegmentRepo.ts`.
const toExportSegmentItemType = (value: TravelSegmentItemType): "accommodation" | "dayPlanItem" => {
  switch (value) {
    case "ACCOMMODATION":
      return "accommodation";
    case "DAY_PLAN_ITEM":
      return "dayPlanItem";
    default: {
      // Exhaustive for the same reason `toExportTransportType` is: a new `TravelSegmentItemType`
      // member falling through to an existing spelling would make Story 2.32 rewire the segment
      // onto the wrong kind of record. Fail loudly instead.
      const unhandled: never = value;
      throw new Error(`Unhandled travel segment item type: ${String(unhandled)}`);
    }
  }
};

const toExportTransportType = (value: TravelTransportType): "car" | "ship" | "flight" => {
  switch (value) {
    case "CAR":
      return "car";
    case "SHIP":
      return "ship";
    case "FLIGHT":
      return "flight";
    default: {
      // Exhaustive: a new `TravelTransportType` member must not be exported under an existing
      // spelling. Story 2.32 remaps by this vocabulary, so a silent mislabel would restore the
      // wrong transport rather than fail loudly.
      const unhandled: never = value;
      throw new Error(`Unhandled travel transport type: ${String(unhandled)}`);
    }
  }
};

export const getTripExportForUser = async (userId: string, tripId: string): Promise<TripExportResult | null> => {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      // Trip-scoped, so it hangs off `Trip` and not off a day. Ordering is identical to
      // `listBucketListItemsForTrip` so the backup matches what the UI shows.
      bucketListItems: {
        orderBy: [{ title: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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
              createdAt: true,
              updatedAt: true,
              // Nested include rather than the print path's separate per-owner queries: the export
              // walks one trip top-down and has no need to reach a neighbouring day.
              images: {
                select: { imageUrl: true, sortOrder: true },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
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
              images: {
                select: { imageUrl: true, sortOrder: true },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          },
          travelSegments: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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

  const warnings: string[] = [];
  const photos: Record<string, TripExportPhoto> = {};
  const photoFiles: { archivePath: string; filePath: string }[] = [];
  const poolIdByFilePath = new Map<string, string>();
  const skippedUrls = new Set<string>();

  const ownedUrlPrefix = `/uploads/trips/${tripId}/`;
  const ownedUploadRoot = path.resolve(getTripUploadDir(tripId));
  // Both sides of the containment test must be compared in the same terms. The upload root itself
  // can sit under a symlinked ancestor (macOS `/tmp` -> `/private/tmp`, and the per-worker temp dir
  // `test/setup.ts` points `UPLOADS_PUBLIC_ROOT` at), so realpath the root once here rather than
  // comparing a realpath-ed file against a lexical root and rejecting every legitimate photo.
  const ownedUploadRootReal = await fs.realpath(ownedUploadRoot).catch(() => ownedUploadRoot);

  const warnOnce = (imageUrl: string, message: string) => {
    if (skippedUrls.has(imageUrl)) {
      return;
    }
    skippedUrls.add(imageUrl);
    warnings.push(message);
  };

  // Gallery drops are deduped per (URL, sortOrder) rather than per URL: the slot is the thing the
  // user needs to be told about, and one URL can legitimately occupy several slots.
  const warnedGalleryDrops = new Set<string>();
  const warnGalleryDropOnce = (imageUrl: string, sortOrder: number, message: string) => {
    const key = `${sortOrder} ${imageUrl}`;
    if (warnedGalleryDrops.has(key)) {
      return;
    }
    warnedGalleryDrops.add(key);
    warnings.push(message);
  };

  /**
   * Resolve a stored URL to a file this trip actually owns, or `null`.
   *
   * The prefix test alone is the pattern `removeManagedFile` uses, and it is not enough here: that
   * function only unlinks, this one reads bytes into a file the user downloads.
   * `/uploads/trips/<tripId>/../../../etc/passwd` satisfies the prefix and escapes the directory, so
   * the resolved-path containment check is the control that matters. The trailing separator stops
   * `.../trips/abc-evil` from passing as `.../trips/abc`.
   *
   * `path.resolve` is purely lexical, but `fs.stat` and `fs.readFile` both follow symlinks - so a
   * symlink *inside* the trip's own directory pointing anywhere on the box would pass a lexical
   * check and stream its target's bytes into the download. The realpath comparison below is what
   * closes that. A realpath failure is left to the `stat` in `registerPhoto`, which reports a
   * missing file with the accurate warning rather than mislabelling it a containment breach.
   */
  const resolveOwnedPhotoPath = async (imageUrl: string): Promise<string | null> => {
    if (!imageUrl.startsWith(ownedUrlPrefix)) {
      return null;
    }
    const resolved = path.resolve(resolvePublicFilePath(imageUrl));
    if (!resolved.startsWith(`${ownedUploadRoot}${path.sep}`)) {
      return null;
    }
    const real = await fs.realpath(resolved).catch(() => null);
    if (real !== null && !real.startsWith(`${ownedUploadRootReal}${path.sep}`)) {
      return null;
    }
    // Return the realpath when there is one: it is what the pool dedupes on, and two URLs that
    // alias the same bytes (a symlink inside the trip's own directory, or two spellings that a
    // case-insensitive filesystem folds together) must collapse to one pool entry and one archive
    // member. A lexical path would give each alias its own id and write the bytes twice.
    return real ?? resolved;
  };

  /**
   * Register one stored image URL in the pool and return its id, or `null` when it earns no entry.
   *
   * `null` is returned - and nothing is read from disk - for an absent URL, an external `http(s)`
   * URL (legal in this schema; a backup does not go out to the network), a path that does not
   * resolve inside this trip's own upload directory, and a row whose file is gone. Everything is
   * stat-ed here during assembly rather than mid-stream: a header already on the wire cannot be
   * retracted, and AC4's pool/member set equality has to hold before the first byte is written.
   */
  const registerPhoto = async (imageUrl: string | null): Promise<string | null> => {
    if (!imageUrl) {
      return null;
    }
    if (!imageUrl.startsWith("/uploads/")) {
      // External URL - preserved in its v1 field, never fetched.
      return null;
    }

    const filePath = await resolveOwnedPhotoPath(imageUrl);
    if (!filePath) {
      warnOnce(imageUrl, `Skipped image outside this trip's upload directory: ${imageUrl}`);
      return null;
    }

    const pooled = poolIdByFilePath.get(filePath);
    if (pooled) {
      return pooled;
    }
    if (skippedUrls.has(imageUrl)) {
      return null;
    }

    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        warnOnce(imageUrl, `Skipped image that is not a regular file: ${imageUrl}`);
        return null;
      }
    } catch {
      warnOnce(imageUrl, `Skipped image whose file is missing on disk: ${imageUrl}`);
      return null;
    }

    const extension = toExportPhotoExtension(imageUrl);
    const poolId = `p${photoFiles.length + 1}`;
    const archivePath = `photos/${poolId}.${extension}`;
    photos[poolId] = {
      contentType: EXPORT_PHOTO_CONTENT_TYPES.get(extension) ?? EXPORT_PHOTO_FALLBACK_CONTENT_TYPE,
      archivePath,
    };
    photoFiles.push({ archivePath, filePath });
    poolIdByFilePath.set(filePath, poolId);
    return poolId;
  };

  /**
   * Gallery entries are the one place a dropped photo leaves no trace: `trip.heroImageUrl` and
   * `days[].imageUrl` survive verbatim beside their pool id, but `TripExportImageRef` is
   * `{ sortOrder, photoId }` by contract - no `imageUrl` to fall back on. So a gallery row that
   * earns no pool entry vanishes from the backup entirely, and the only record the user gets is
   * `meta.warnings`. A row `registerPhoto` has just reported (missing file, failed containment) is
   * not reported twice; this catches the two cases it leaves silent - an external `http(s)` URL,
   * which is legal in this schema, and a *repeat* row whose URL an earlier row already spent the
   * per-URL warning on. Nothing constrains a gallery to distinct URLs (`AccommodationImage` is
   * unique on `(accommodationId, sortOrder)`, not on `imageUrl`), so without the second case the
   * later slots of a repeated bad URL would disappear with no trace at all.
   */
  const registerGallery = async (images: { imageUrl: string; sortOrder: number }[]) => {
    const refs: TripExportImageRef[] = [];
    for (const image of images) {
      const alreadyReported = skippedUrls.has(image.imageUrl);
      const photoId = await registerPhoto(image.imageUrl);
      if (photoId) {
        refs.push({ sortOrder: image.sortOrder, photoId });
        continue;
      }
      if (!alreadyReported && skippedUrls.has(image.imageUrl)) {
        // `registerPhoto` warned about this very row - one line per row is enough.
        continue;
      }
      warnGalleryDropOnce(
        image.imageUrl,
        image.sortOrder,
        `Dropped gallery image at sortOrder ${image.sortOrder} that could not be archived: ${image.imageUrl}`,
      );
    }
    return refs;
  };

  // Pool ids are assigned in a fixed traversal: hero, then day by day - day image, accommodation
  // gallery in sortOrder, then each plan item's gallery in sortOrder. AC7 rests on this order.
  const heroPhotoId = await registerPhoto(trip.heroImageUrl);

  const days: TripExportPayload["days"] = [];
  for (const day of trip.days) {
    const imagePhotoId = await registerPhoto(day.imageUrl);
    const accommodationImages = day.accommodation ? await registerGallery(day.accommodation.images) : [];

    const dayPlanItems: TripExportPayload["days"][number]["dayPlanItems"] = [];
    for (const item of day.dayPlanItems) {
      const images = await registerGallery(item.images);
      dayPlanItems.push({
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
        images,
      });
    }

    days.push({
      id: day.id,
      date: day.date.toISOString(),
      dayIndex: day.dayIndex,
      imageUrl: day.imageUrl,
      imagePhotoId,
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
            images: accommodationImages,
          }
        : null,
      dayPlanItems,
      travelSegments: day.travelSegments.map((segment) => ({
        id: segment.id,
        fromItemType: toExportSegmentItemType(segment.fromItemType),
        fromItemId: segment.fromItemId,
        toItemType: toExportSegmentItemType(segment.toItemType),
        toItemId: segment.toItemId,
        transportType: toExportTransportType(segment.transportType),
        durationMinutes: segment.durationMinutes,
        distanceKm: segment.distanceKm,
        linkUrl: segment.linkUrl,
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString(),
      })),
    });
  }

  const payload: TripExportPayload = {
    warnings,
    photos,
    trip: {
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate.toISOString(),
      endDate: trip.endDate.toISOString(),
      heroImageUrl: trip.heroImageUrl,
      heroPhotoId,
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
      bucketListItems: trip.bucketListItems.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        positionText: item.positionText,
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
    },
    days,
  };

  return { payload, photoFiles };
};

const toAccommodationStatus = (status: "planned" | "booked") => (status === "booked" ? "BOOKED" : "PLANNED");

const sortImportDays = (days: TripImportPayloadInput["days"]) =>
  [...days].sort((left, right) => {
    if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
    return new Date(left.date).getTime() - new Date(right.date).getTime();
  });

/**
 * Lowercase wire vocabulary up to Prisma's enums. Same shape as `travelSegmentRepo.ts`'s helpers,
 * duplicated rather than imported because importing from a sibling repository would make one
 * repository depend on another's private mapping - and there must not be a third spelling of this.
 */
const toPrismaSegmentItemType = (value: "accommodation" | "dayPlanItem"): TravelSegmentItemType =>
  value === "accommodation" ? "ACCOMMODATION" : "DAY_PLAN_ITEM";

const toPrismaTransportType = (value: "car" | "ship" | "flight"): TravelTransportType => {
  switch (value) {
    case "car":
      return "CAR";
    case "ship":
      return "SHIP";
    default:
      return "FLIGHT";
  }
};

/** `cleanOptionalString` semantics from `bucketListRepo.ts`: blank is stored as absent. */
const cleanImportedOptionalString = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

type ImportPhotoPool = TripImportPayloadInput["photos"];

/**
 * Look up a pool entry that validation has already proven exists.
 *
 * The root `superRefine` rejects any dangling `photoId` before the transaction opens, so reaching
 * the throw means a caller bypassed the schema. Better a rolled-back transaction than a row whose
 * `imageUrl` points at a file nobody will ever write.
 */
const requirePooledPhoto = (photos: ImportPhotoPool, photoId: string) => {
  const photo = photos[photoId];
  if (!photo) {
    throw new Error("photo_reference_missing");
  }
  return photo;
};

/**
 * Drops a v1 `/uploads/…` string that names a file this import is about to delete.
 *
 * Overwrite stashes and then removes the target trip's whole upload directory, so a payload with no
 * pooled replacement for a URL pointing *into that directory* would restore a row whose file no
 * longer exists - the orphaned rows AC5 rules out. Storing `null` is the honest answer: the image is
 * genuinely gone, and a null renders as "no image" rather than as a broken one.
 *
 * `replacedUploadPrefix` is `null` in create-new mode, which is what keeps that path byte-identical:
 * there the URL names some *other* trip's directory, nothing on disk is touched, and AC2 requires
 * the string back verbatim.
 */
const dropReplacedUploadUrl = (imageUrl: string | null, replacedUploadPrefix: string | null) => {
  if (!imageUrl || !replacedUploadPrefix) return imageUrl;
  return imageUrl.startsWith(replacedUploadPrefix) ? null : imageUrl;
};

/** The prefix every stored URL under one trip's upload directory begins with. */
const tripUploadUrlPrefix = (tripId: string) => `/uploads/trips/${tripId}/`;

type ImportedDaysResult = {
  dayIdBySourceId: Map<string, string>;
  accommodationIdBySourceId: Map<string, string>;
  dayPlanItemIdBySourceId: Map<string, string>;
  /** Files to create once the transaction commits; the rows already carry their URLs. */
  photoWrites: PlannedPhotoWrite[];
  travelSegmentCount: number;
};

const createImportedDays = async ({
  tx,
  tripId,
  sortedDays,
  photos,
  takenFileNames,
  replacedUploadPrefix,
}: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  tripId: string;
  sortedDays: TripImportPayloadInput["days"];
  photos: ImportPhotoPool;
  takenFileNames: Set<string>;
  /** See `dropReplacedUploadUrl`. Only ever set in overwrite mode. */
  replacedUploadPrefix: string | null;
}): Promise<ImportedDaysResult> => {
  const dayIdBySourceId = new Map<string, string>();
  const accommodationIdBySourceId = new Map<string, string>();
  const dayPlanItemIdBySourceId = new Map<string, string>();
  const photoWrites: PlannedPhotoWrite[] = [];
  let travelSegmentCount = 0;

  for (const day of sortedDays) {
    const createdDay = await tx.tripDay.create({
      data: {
        tripId,
        date: new Date(day.date),
        dayIndex: day.dayIndex,
        imageUrl: dropReplacedUploadUrl(day.imageUrl ?? null, replacedUploadPrefix),
        note: day.note ?? null,
      },
    });
    dayIdBySourceId.set(day.id, createdDay.id);

    // Precedence: a pooled photo always wins over the v1 `imageUrl` string. Keeping the old
    // `/uploads/trips/<sourceTripId>/...` value when bytes are available is a dead link on another
    // system, and on this one it points into a different trip's directory - one that disappears
    // with that trip.
    if (day.imagePhotoId) {
      const photo = requirePooledPhoto(photos, day.imagePhotoId);
      const placement = planTripDayPhoto(tripId, createdDay.id, photo.contentType);
      photoWrites.push({ filePath: placement.filePath, archivePath: photo.archivePath });
      await tx.tripDay.update({ where: { id: createdDay.id }, data: { imageUrl: placement.imageUrl } });
    }

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
      accommodationIdBySourceId.set(day.accommodation.id, accommodation.id);

      for (const image of day.accommodation.images) {
        const photo = requirePooledPhoto(photos, image.photoId);
        const placement = planAccommodationGalleryPhoto(
          {
            tripId,
            tripDayId: createdDay.id,
            accommodationId: accommodation.id,
            contentType: photo.contentType,
          },
          takenFileNames,
        );
        photoWrites.push({ filePath: placement.filePath, archivePath: photo.archivePath });
        await tx.accommodationImage.create({
          data: {
            accommodationId: accommodation.id,
            imageUrl: placement.imageUrl,
            sortOrder: image.sortOrder,
          },
        });
      }

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

    // Insertion order is the package's array order and must stay that way: import does not preserve
    // `createdAt`, so plan-item ordering - which travel segments now depend on - is insertion order.
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
      dayPlanItemIdBySourceId.set(item.id, createdItem.id);

      for (const image of item.images) {
        const photo = requirePooledPhoto(photos, image.photoId);
        const placement = planDayPlanItemGalleryPhoto(
          {
            tripId,
            tripDayId: createdDay.id,
            dayPlanItemId: createdItem.id,
            contentType: photo.contentType,
          },
          takenFileNames,
        );
        photoWrites.push({ filePath: placement.filePath, archivePath: photo.archivePath });
        await tx.dayPlanItemImage.create({
          data: {
            dayPlanItemId: createdItem.id,
            imageUrl: placement.imageUrl,
            sortOrder: image.sortOrder,
          },
        });
      }

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

    // Travel segments come last, once this day's accommodation and every plan item exist and their
    // new cuids are known. `fromItemId` / `toItemId` in the package are the *source* ids; written
    // through unchanged they would point at nothing. This remap is the whole reason the export
    // carries record ids at all.
    //
    // Written with `tx.travelSegment.create` rather than `createTravelSegmentForTripDay`: that
    // function re-runs adjacency validation against live ordering and takes its own user/trip guard,
    // neither of which is meaningful - or usable - inside an import transaction.
    for (const segment of day.travelSegments) {
      const fromItemId =
        segment.fromItemType === "accommodation"
          ? accommodationIdBySourceId.get(segment.fromItemId)
          : dayPlanItemIdBySourceId.get(segment.fromItemId);
      const toItemId =
        segment.toItemType === "accommodation"
          ? accommodationIdBySourceId.get(segment.toItemId)
          : dayPlanItemIdBySourceId.get(segment.toItemId);

      if (!fromItemId || !toItemId) {
        // Validation rejects a segment whose endpoints are not on its own day, so this is only
        // reachable when the schema was bypassed. Rolling the transaction back beats persisting a
        // segment that renders as a broken leg of the timeline.
        throw new Error("travel_segment_reference_missing");
      }

      await tx.travelSegment.create({
        data: {
          tripDayId: createdDay.id,
          fromItemType: toPrismaSegmentItemType(segment.fromItemType),
          fromItemId,
          toItemType: toPrismaSegmentItemType(segment.toItemType),
          toItemId,
          transportType: toPrismaTransportType(segment.transportType),
          durationMinutes: segment.durationMinutes,
          distanceKm: segment.distanceKm,
          linkUrl: segment.linkUrl,
        },
      });
      travelSegmentCount += 1;
    }
  }

  return {
    dayIdBySourceId,
    accommodationIdBySourceId,
    dayPlanItemIdBySourceId,
    photoWrites,
    travelSegmentCount,
  };
};

const createImportedBucketListItems = async ({
  tx,
  tripId,
  items,
}: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  tripId: string;
  items: TripImportPayloadInput["trip"]["bucketListItems"];
}) => {
  if (items.length === 0) return 0;

  await tx.tripBucketListItem.createMany({
    data: items.map((item) => ({
      tripId,
      title: item.title.trim(),
      description: cleanImportedOptionalString(item.description),
      positionText: cleanImportedOptionalString(item.positionText),
      locationLat: item.location?.lat ?? null,
      locationLng: item.location?.lng ?? null,
      locationLabel: cleanImportedOptionalString(item.location?.label),
    })),
  });

  return items.length;
};

export const importTripFromExportForUser = async ({
  userId,
  payload,
  strategy,
  targetTripId,
  photoBytes,
}: {
  userId: string;
  payload: TripImportPayloadInput;
  strategy?: TripImportConflictStrategy;
  targetTripId?: string;
  /**
   * Archive member path to bytes, from `parseImportPackage`. Omitted by the legacy JSON wire path,
   * which can only carry a v1 payload or a v2 manifest with an empty pool.
   */
  photoBytes?: Map<string, Buffer>;
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
  const availablePhotoBytes = photoBytes ?? new Map<string, Buffer>();
  // Gallery file names are generated in a single tick, so `Date.now()` is constant across the whole
  // import; this set is what keeps two photos in one gallery from colliding on it.
  const takenFileNames = new Set<string>();

  // AC3, applied before a single row is written: a pool entry whose bytes never arrived cannot be
  // restored, and discovering that after the commit would leave rows pointing at absent files. The
  // route validates the same thing with a better message; this guard is what makes a direct caller
  // - including the legacy JSON wire path, which carries no bytes at all - fail safely.
  for (const photo of Object.values(payload.photos)) {
    if (!availablePhotoBytes.has(photo.archivePath)) {
      throw new Error("photo_bytes_missing");
    }
  }

  /**
   * The pool, with every `contentType` replaced by what the bytes actually are.
   *
   * The manifest's value is a hint and nothing more: `trips/[id]/hero-image/route.ts` derives the
   * stored extension from the client-supplied `file.type` without sniffing, so a perfectly genuine
   * export can declare `image/jpeg` for PNG bytes. The extension written to disk has to describe
   * the file's real contents, or the app serves a `.jpg` that is not one.
   *
   * `validatePackagePhotos` has already rejected anything matching no signature, so a `null` here
   * means a caller bypassed it - the declared type is kept in that case so `extensionFor` fails
   * loudly instead of inventing an extension.
   */
  const photos: ImportPhotoPool = Object.fromEntries(
    Object.entries(payload.photos).map(([photoId, photo]) => {
      const bytes = availablePhotoBytes.get(photo.archivePath);
      const sniffed = bytes ? sniffPhotoContentType(bytes) : null;
      return [photoId, sniffed === null ? photo : { ...photo, contentType: sniffed }];
    }),
  );

  type CommittedImport = {
    trip: ImportTripSuccessResult["trip"];
    photoWrites: PlannedPhotoWrite[];
    travelSegmentCount: number;
    bucketListItemCount: number;
  };

  const mode: "overwrite" | "createNew" = strategy === "overwrite" ? "overwrite" : "createNew";
  let committed: CommittedImport;

  if (mode === "overwrite") {
    if (!targetTripId) {
      throw new Error("target_trip_required");
    }
    if (!sameNameTrips.some((trip) => trip.id === targetTripId)) {
      throw new Error("target_trip_not_conflict");
    }

    committed = await prisma.$transaction(async (tx): Promise<CommittedImport> => {
      const targetTrip = await tx.trip.findFirst({
        where: {
          id: targetTripId,
          userId,
        },
      });

      if (!targetTrip) {
        throw new Error("target_trip_not_found");
      }

      // Hero placement is computable before the update here: overwrite already knows the trip id.
      const heroPhoto = payload.trip.heroPhotoId
        ? requirePooledPhoto(photos, payload.trip.heroPhotoId)
        : null;
      const heroPlacement = heroPhoto ? planTripHeroPhoto(targetTrip.id, heroPhoto.contentType) : null;
      // This trip's own files are about to be deleted, so any restored URL naming one is dead.
      const replacedUploadPrefix = tripUploadUrlPrefix(targetTrip.id);

      const updatedTrip = await tx.trip.update({
        where: { id: targetTrip.id },
        data: {
          name: payload.trip.name,
          startDate: new Date(payload.trip.startDate),
          endDate: new Date(payload.trip.endDate),
          heroImageUrl: heroPlacement
            ? heroPlacement.imageUrl
            : dropReplacedUploadUrl(payload.trip.heroImageUrl, replacedUploadPrefix),
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
      // Days cascade to accommodations, plan items, travel segments, images and payments. Bucket
      // list items hang off `Trip`, not `TripDay`, so nothing above reaches them - without this
      // they would survive the overwrite and double up (AC5).
      await tx.tripBucketListItem.deleteMany({ where: { tripId: targetTrip.id } });

      const days = await createImportedDays({
        tx,
        tripId: targetTrip.id,
        sortedDays,
        photos,
        takenFileNames,
        replacedUploadPrefix,
      });
      const bucketListItemCount = await createImportedBucketListItems({
        tx,
        tripId: targetTrip.id,
        items: payload.trip.bucketListItems,
      });

      return {
        trip: {
          id: updatedTrip.id,
          name: updatedTrip.name,
          startDate: updatedTrip.startDate,
          endDate: updatedTrip.endDate,
          heroImageUrl: updatedTrip.heroImageUrl,
        },
        photoWrites: heroPhoto && heroPlacement
          ? [{ filePath: heroPlacement.filePath, archivePath: heroPhoto.archivePath }, ...days.photoWrites]
          : days.photoWrites,
        travelSegmentCount: days.travelSegmentCount,
        bucketListItemCount,
      };
    });
  } else {
    committed = await prisma.$transaction(async (tx): Promise<CommittedImport> => {
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

      // The hero URL contains the trip id, which only exists once the row does - hence create, then
      // update. Same precedence as day images: a pooled photo replaces the v1 string outright.
      let heroImageUrl = createdTrip.heroImageUrl;
      const heroWrites: PlannedPhotoWrite[] = [];
      if (payload.trip.heroPhotoId) {
        const heroPhoto = requirePooledPhoto(photos, payload.trip.heroPhotoId);
        const placement = planTripHeroPhoto(createdTrip.id, heroPhoto.contentType);
        heroWrites.push({ filePath: placement.filePath, archivePath: heroPhoto.archivePath });
        heroImageUrl = placement.imageUrl;
        await tx.trip.update({ where: { id: createdTrip.id }, data: { heroImageUrl } });
      }

      const days = await createImportedDays({
        tx,
        tripId: createdTrip.id,
        sortedDays,
        photos,
        takenFileNames,
        // Create-new touches no existing file, so every v1 URL is restored verbatim (AC2).
        replacedUploadPrefix: null,
      });
      const bucketListItemCount = await createImportedBucketListItems({
        tx,
        tripId: createdTrip.id,
        items: payload.trip.bucketListItems,
      });

      return {
        trip: {
          id: createdTrip.id,
          name: createdTrip.name,
          startDate: createdTrip.startDate,
          endDate: createdTrip.endDate,
          heroImageUrl,
        },
        photoWrites: [...heroWrites, ...days.photoWrites],
        travelSegmentCount: days.travelSegmentCount,
        bucketListItemCount,
      };
    });
  }

  // --- post-commit disk phase ------------------------------------------------------------------
  // Files are written only now, because every URL above contains an id Prisma generated on insert.
  //
  // Overwrite moves the target's existing upload directory aside first rather than deleting it: the
  // rows are already replaced, so those files are the only thing left to restore if a write fails
  // (AC5). It is deleted for real once every new file is safely down.
  const stashedUploads = mode === "overwrite" ? await stashTripUploadDir(committed.trip.id) : null;
  try {
    await writeImportedPhotos(committed.photoWrites, availablePhotoBytes);
  } catch (error) {
    // `writeImportedPhotos` already removed everything it wrote.
    //
    // The branch is on the *mode*, never on whether there is a stash: `stashTripUploadDir` returns
    // `null` for a trip that had no upload directory, which is the ordinary case for a photo-free
    // trip. Branching on the stash therefore sent exactly that overwrite into the delete below and
    // destroyed the trip the user was replacing.
    if (mode === "createNew") {
      // Create-new owns everything it just made, so dropping the trip really does return the system
      // to its prior state.
      await prisma.trip.delete({ where: { id: committed.trip.id } }).catch(() => undefined);
    } else {
      // Overwrite deliberately does *not* delete: the transaction has committed the restored rows,
      // and deleting the target would destroy the trip the user was replacing rather than leave it
      // recoverable by re-running the import. A restore that itself fails must not replace the
      // original error either - `photo_write_failed` is what actually went wrong.
      await restoreStashedTripUploadDir(stashedUploads).catch(() => undefined);
    }
    throw new Error("photo_write_failed", { cause: error });
  }
  // Every file is down and the rows are committed, so the import has succeeded whatever happens to
  // the stash. Letting `fs.rm` fail here - a held handle, a scanner mid-scan - would report that
  // success as a 500 and send the user back to re-import against a trip that restored perfectly.
  // The stash is named `<tripDir>.import-<timestamp>-<random>`, so leaving one behind is untidy,
  // not harmful.
  await discardStashedTripUploadDir(stashedUploads).catch(() => undefined);

  return {
    outcome: "imported",
    mode,
    trip: committed.trip,
    dayCount: sortedDays.length,
    travelSegmentCount: committed.travelSegmentCount,
    bucketListItemCount: committed.bucketListItemCount,
    photoCount: committed.photoWrites.length,
  };
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
