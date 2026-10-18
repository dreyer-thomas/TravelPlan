import { NextRequest } from "next/server";
import { POST as PREVIEW_POST } from "@/app/api/trips/[id]/days/[dayId]/suggestions/preview/route";
import { POST as APPLY_POST } from "@/app/api/trips/[id]/days/[dayId]/suggestions/apply/route";
import { POST as UNDO_POST } from "@/app/api/trips/[id]/day-plan-changes/undo/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import type { SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import type { ApplySuggestion, SuggestionPreview } from "@/lib/validation/daySuggestionApplySchemas";
import { routeContext } from "./routeContext";
import { tripIdOfDay } from "./tripIdOfDay";

/**
 * Story 12.4. Fixtures shared by `daySuggestionApplyRoute.test.ts` and `suggestionsApplyUndo.test.ts`:
 * a two-day trip in Porto, requests with a session and the CSRF pair, and the three endpoints.
 * The suites mock OSRM and the picture download themselves (`vi.mock` is per file).
 */

export const CSRF = "csrf-token-value";

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 7)]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 9)]);

/** Fixture rows are stamped in the past so a later write can never share their millisecond. */
export const PAST = new Date("2026-01-02T03:04:05.678Z");

export const resetDatabase = async () => {
  await prisma.travelSegment.deleteMany();
  await prisma.dayPlanItemDocument.deleteMany();
  await prisma.dayPlanItemImage.deleteMany();
  await prisma.costPayment.deleteMany();
  await prisma.dayPlanItem.deleteMany();
  await prisma.tripMember.deleteMany();
  await prisma.accommodation.deleteMany();
  await prisma.tripDay.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
};

// A west-to-east line through Porto: last night's hotel in the west, tonight's about 4 km east.
export const HOTEL_WEST = { lat: 41.15, lng: -8.65 };
export const HOTEL_EAST = { lat: 41.15, lng: -8.6 };
export const TRIP_START = { lat: 41.24, lng: -8.68 };

export const suggestion = (overrides: Partial<ApplySuggestion> = {}): ApplySuggestion => ({
  title: "Old Harbour",
  description: "Walk the quay.\nThen the fish market.",
  locationLabel: "Harbour, Porto",
  lat: 41.15,
  lng: -8.62,
  durationMinutes: 90,
  verified: true,
  images: [],
  ...overrides,
});

export const createUser = (email: string, role: "OWNER" | "ADMIN" = "OWNER") =>
  prisma.user.create({ data: { email, passwordHash: "hashed", role } });

export const sessionFor = (user: { id: string; role: string }) =>
  createSessionJwt({ sub: user.id, role: user.role as "OWNER" | "VIEWER" | "ADMIN" });

/**
 * Day 1 ends at the west hotel (check-out 09:30 unless overridden), day 2 at the east one. `day2` is the
 * day the cases plan; `day1` is a first day whose origin is the trip's start.
 */
export const seedTrip = async (email = "owner@example.com", options: { checkOutTime?: string | null } = {}) => {
  const user = await createUser(email);
  const trip = await prisma.trip.create({
    data: {
      userId: user.id,
      name: "Porto",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-06T00:00:00.000Z"),
      startLocationLabel: "Porto Airport",
      startLocationLat: TRIP_START.lat,
      startLocationLng: TRIP_START.lng,
    },
  });
  const day1 = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-05T00:00:00.000Z"), dayIndex: 1 },
  });
  const day2 = await prisma.tripDay.create({
    data: { tripId: trip.id, date: new Date("2026-11-06T00:00:00.000Z"), dayIndex: 2 },
  });
  const westStay = await prisma.accommodation.create({
    data: {
      tripDayId: day1.id,
      name: "Hotel Ribeira",
      locationLat: HOTEL_WEST.lat,
      locationLng: HOTEL_WEST.lng,
      checkOutTime: options.checkOutTime === undefined ? "09:30" : options.checkOutTime,
    },
  });
  const eastStay = await prisma.accommodation.create({
    data: { tripDayId: day2.id, name: "Casa Azul", locationLat: HOTEL_EAST.lat, locationLng: HOTEL_EAST.lng },
  });
  return { user, trip, day1, day2, westStay, eastStay, session: await sessionFor(user) };
};

export const createActivity = async (
  tripDayId: string,
  title: string,
  fromTime: string | null,
  toTime: string | null,
  point: { lat: number; lng: number } | null = null,
) =>
  prisma.dayPlanItem.create({
    data: {
      tripId: await tripIdOfDay(tripDayId), tripDayId,
      title,
      fromTime,
      toTime,
      contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: title }] }] }),
      locationLat: point?.lat ?? null,
      locationLng: point?.lng ?? null,
      createdAt: PAST,
      updatedAt: PAST,
    },
  });

export const addMember = async (tripId: string, role: "VIEWER" | "CONTRIBUTOR", userRole: "OWNER" | "ADMIN" = "OWNER") => {
  const user = await createUser(`${role.toLowerCase()}-${userRole.toLowerCase()}@example.com`, userRole);
  await prisma.tripMember.create({ data: { tripId, userId: user.id, role } });
  return { user, session: await sessionFor(user) };
};

const buildRequest = (url: string, options: { session?: string; csrf?: string; body: unknown }) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookies: string[] = [];
  if (options.session) cookies.push(`session=${options.session}`);
  if (options.csrf) {
    cookies.push(`csrf_token=${options.csrf}`);
    headers["x-csrf-token"] = options.csrf;
  }
  if (cookies.length > 0) headers.cookie = cookies.join("; ");
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(options.body) });
};

type Envelope<T> = { data: T | null; error: { code: string } | null };

const dayContext = (tripId: string, dayId: string) => ({ params: Promise.resolve({ id: tripId, dayId }) });

export const postPreview = async (
  tripId: string,
  dayId: string,
  session: string,
  body: unknown,
  csrf: string | undefined = CSRF,
) => {
  const response = await PREVIEW_POST(
    buildRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/suggestions/preview`, { session, csrf, body }),
    dayContext(tripId, dayId),
  );
  return { status: response.status, body: (await response.json()) as Envelope<SuggestionPreview> };
};

export const postApply = async (
  tripId: string,
  dayId: string,
  session: string,
  body: unknown,
  csrf: string | undefined = CSRF,
) => {
  const response = await APPLY_POST(
    buildRequest(`http://localhost/api/trips/${tripId}/days/${dayId}/suggestions/apply`, { session, csrf, body }),
    dayContext(tripId, dayId),
  );
  return { status: response.status, body: (await response.json()) as Envelope<{ receipt: SignedDayChangeReceiptWire }> };
};

export const postUndo = async (tripId: string, session: string, receipt: unknown) => {
  const response = await UNDO_POST(
    buildRequest(`http://localhost/api/trips/${tripId}/day-plan-changes/undo`, { session, csrf: CSRF, body: { receipt } }),
    routeContext(tripId),
  );
  return { status: response.status, body: (await response.json()) as Envelope<{ undone: boolean }> };
};

/** The apply body the dialog sends: the preview's order applied, its legs and its basis. */
export const applyBodyFrom = (mode: string, suggestions: ApplySuggestion[], preview: SuggestionPreview) => ({
  mode,
  suggestions: preview.order.map((index) => suggestions[index]),
  legs: preview.legs,
  basis: preview.basis,
});

/** Every row an apply or its undo could touch, in a stable order. */
export const databaseState = async () => ({
  items: await prisma.dayPlanItem.findMany({ orderBy: { id: "asc" } }),
  images: await prisma.dayPlanItemImage.findMany({ orderBy: { id: "asc" } }),
  documents: await prisma.dayPlanItemDocument.findMany({ orderBy: { id: "asc" } }),
  legs: await prisma.travelSegment.findMany({ orderBy: { id: "asc" } }),
});
