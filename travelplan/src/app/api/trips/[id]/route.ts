import type { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { deleteTripForUser, getTripWithDaysForUser, updateTripWithDays } from "@/lib/repositories/tripRepo";
import { updateTripSchema } from "@/lib/validation/tripSchemas";
import { verifySessionJwt } from "@/lib/auth/jwt";

export const runtime = "nodejs";

const getSessionUserId = async (request: NextRequest) => {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return null;
  }

  try {
    const payload = await verifySessionJwt(token);
    return payload.sub;
  } catch {
    return null;
  }
};

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

const removeTripUploads = async (tripId: string) => {
  const uploadDir = path.join(process.cwd(), "public", "uploads", "trips", tripId);
  await fs.rm(uploadDir, { recursive: true, force: true });
};

export const GET = async (request: NextRequest, context: RouteContext) => {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  try {
    const trip = await getTripWithDaysForUser(userId, tripId);
    if (!trip) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({
      trip: {
        id: trip.id,
        name: trip.name,
        startDate: trip.startDate.toISOString(),
        endDate: trip.endDate.toISOString(),
        dayCount: trip.dayCount,
        plannedCostTotal: trip.plannedCostTotal,
        accommodationCostTotalCents: trip.accommodationCostTotalCents,
        heroImageUrl: trip.heroImageUrl,
      },
      days: trip.days.map((day) => ({
        id: day.id,
        date: day.date.toISOString(),
        dayIndex: day.dayIndex,
        imageUrl: day.imageUrl,
        note: day.note,
        plannedCostSubtotal: day.plannedCostSubtotal,
        missingAccommodation: day.missingAccommodation,
        missingPlan: day.missingPlan,
        accommodation: day.accommodation
          ? {
              id: day.accommodation.id,
              name: day.accommodation.name,
              notes: day.accommodation.notes,
              status: day.accommodation.status,
              costCents: day.accommodation.costCents,
              link: day.accommodation.link,
              location: day.accommodation.location,
            }
          : null,
        dayPlanItems: day.dayPlanItems.map((item) => ({
          id: item.id,
          title: item.title,
          fromTime: item.fromTime,
          toTime: item.toTime,
          contentJson: item.contentJson,
          costCents: item.costCents,
          linkUrl: item.linkUrl,
          location: item.location,
        })),
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load trip"), 500);
  }
};

export const PATCH = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = updateTripSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid trip details", parsed.error.flatten()), 400);
  }

  try {
    const { name, startDate, endDate } = parsed.data;
    const updated = await updateTripWithDays({
      userId,
      tripId,
      name,
      startDate,
      endDate,
    });

    if (!updated) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    const detail = await getTripWithDaysForUser(userId, tripId);
    if (!detail) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({
      trip: {
        id: detail.id,
        name: detail.name,
        startDate: detail.startDate.toISOString(),
        endDate: detail.endDate.toISOString(),
        dayCount: detail.dayCount,
        plannedCostTotal: detail.plannedCostTotal,
        accommodationCostTotalCents: detail.accommodationCostTotalCents,
        heroImageUrl: detail.heroImageUrl,
      },
      days: detail.days.map((day) => ({
        id: day.id,
        date: day.date.toISOString(),
        dayIndex: day.dayIndex,
        imageUrl: day.imageUrl,
        note: day.note,
        plannedCostSubtotal: day.plannedCostSubtotal,
        missingAccommodation: day.missingAccommodation,
        missingPlan: day.missingPlan,
        accommodation: day.accommodation
          ? {
              id: day.accommodation.id,
              name: day.accommodation.name,
              notes: day.accommodation.notes,
              status: day.accommodation.status,
              costCents: day.accommodation.costCents,
              link: day.accommodation.link,
              location: day.accommodation.location,
            }
          : null,
        dayPlanItems: day.dayPlanItems.map((item) => ({
          id: item.id,
          title: item.title,
          fromTime: item.fromTime,
          toTime: item.toTime,
          contentJson: item.contentJson,
          costCents: item.costCents,
          linkUrl: item.linkUrl,
          location: item.location,
        })),
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to update trip"), 500);
  }
};

export const DELETE = async (request: NextRequest, context: RouteContext) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  if (!validateCsrf(csrfCookie, csrfHeader)) {
    return fail(apiError("csrf_invalid", "Invalid CSRF token"), 403);
  }

  const userId = await getSessionUserId(request);
  if (!userId) {
    return fail(apiError("unauthorized", "Authentication required"), 401);
  }

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  try {
    const deleted = await deleteTripForUser(userId, tripId);
    if (!deleted) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    try {
      await removeTripUploads(tripId);
    } catch {
      // Best-effort cleanup only.
    }

    return ok({ deleted: true });
  } catch {
    return fail(apiError("server_error", "Unable to delete trip"), 500);
  }
};
