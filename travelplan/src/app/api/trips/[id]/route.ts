import type { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { deleteTripForUser, getTripWithDaysForUser, updateTripWithDays } from "@/lib/repositories/tripRepo";
import { updateTripSchema } from "@/lib/validation/tripSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

export const runtime = "nodejs";

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
  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

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
        accessRole: trip.accessRole,
        startDate: trip.startDate.toISOString(),
        endDate: trip.endDate.toISOString(),
        dayCount: trip.dayCount,
        plannedCostTotal: trip.plannedCostTotal,
        accommodationCostTotalCents: trip.accommodationCostTotalCents,
        heroImageUrl: trip.heroImageUrl,
        feedback: {
          targetType: trip.feedback.targetType,
          targetId: trip.feedback.targetId,
          comments: trip.feedback.comments.map((comment) => ({
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            author: comment.author,
          })),
          voteSummary: trip.feedback.voteSummary,
        },
      },
      days: trip.days.map((day) => {
        const dayUpdatedAt = (day as { updatedAt?: Date }).updatedAt ?? day.date;

        return {
          id: day.id,
          date: day.date.toISOString(),
          dayIndex: day.dayIndex,
          imageUrl: day.imageUrl,
          note: day.note,
          updatedAt: dayUpdatedAt.toISOString(),
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
                payments: day.accommodation.payments ?? [],
                link: day.accommodation.link,
                checkInTime: day.accommodation.checkInTime ?? null,
                checkOutTime: day.accommodation.checkOutTime ?? null,
                location: day.accommodation.location,
                feedback: {
                  targetType: day.accommodation.feedback.targetType,
                  targetId: day.accommodation.feedback.targetId,
                  comments: day.accommodation.feedback.comments.map((comment) => ({
                    id: comment.id,
                    body: comment.body,
                    createdAt: comment.createdAt.toISOString(),
                    updatedAt: comment.updatedAt.toISOString(),
                    author: comment.author,
                  })),
                  voteSummary: day.accommodation.feedback.voteSummary,
                },
              }
            : null,
          dayPlanItems: day.dayPlanItems.map((item) => ({
            id: item.id,
            title: item.title,
            fromTime: item.fromTime,
            toTime: item.toTime,
            contentJson: item.contentJson,
            costCents: item.costCents,
            payments: item.payments ?? [],
            linkUrl: item.linkUrl,
            location: item.location,
            feedback: {
              targetType: item.feedback.targetType,
              targetId: item.feedback.targetId,
              comments: item.feedback.comments.map((comment) => ({
                id: comment.id,
                body: comment.body,
                createdAt: comment.createdAt.toISOString(),
                updatedAt: comment.updatedAt.toISOString(),
                author: comment.author,
              })),
              voteSummary: item.feedback.voteSummary,
            },
          })),
          travelSegments: day.travelSegments.map((segment) => ({
            id: segment.id,
            fromItemType: segment.fromItemType,
            fromItemId: segment.fromItemId,
            toItemType: segment.toItemType,
            toItemId: segment.toItemId,
            transportType: segment.transportType,
            durationMinutes: segment.durationMinutes,
            distanceKm: segment.distanceKm,
            linkUrl: segment.linkUrl,
          })),
          feedback: {
            targetType: day.feedback.targetType,
            targetId: day.feedback.targetId,
            comments: day.feedback.comments.map((comment) => ({
              id: comment.id,
              body: comment.body,
              createdAt: comment.createdAt.toISOString(),
              updatedAt: comment.updatedAt.toISOString(),
              author: comment.author,
            })),
            voteSummary: day.feedback.voteSummary,
          },
        };
      }),
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

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

  const { id: tripId } = await context.params;
  if (!tripId) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }
  if (!(await hasTripOwnerAccess(userId, tripId))) {
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
        accessRole: detail.accessRole,
        startDate: detail.startDate.toISOString(),
        endDate: detail.endDate.toISOString(),
        dayCount: detail.dayCount,
        plannedCostTotal: detail.plannedCostTotal,
        accommodationCostTotalCents: detail.accommodationCostTotalCents,
        heroImageUrl: detail.heroImageUrl,
        feedback: {
          targetType: detail.feedback.targetType,
          targetId: detail.feedback.targetId,
          comments: detail.feedback.comments.map((comment) => ({
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            author: comment.author,
          })),
          voteSummary: detail.feedback.voteSummary,
        },
      },
      days: detail.days.map((day) => {
        const dayUpdatedAt = (day as { updatedAt?: Date }).updatedAt ?? day.date;

        return {
          id: day.id,
          date: day.date.toISOString(),
          dayIndex: day.dayIndex,
          imageUrl: day.imageUrl,
          note: day.note,
          updatedAt: dayUpdatedAt.toISOString(),
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
                payments: day.accommodation.payments ?? [],
                link: day.accommodation.link,
                checkInTime: day.accommodation.checkInTime ?? null,
                checkOutTime: day.accommodation.checkOutTime ?? null,
                location: day.accommodation.location,
                feedback: {
                  targetType: day.accommodation.feedback.targetType,
                  targetId: day.accommodation.feedback.targetId,
                  comments: day.accommodation.feedback.comments.map((comment) => ({
                    id: comment.id,
                    body: comment.body,
                    createdAt: comment.createdAt.toISOString(),
                    updatedAt: comment.updatedAt.toISOString(),
                    author: comment.author,
                  })),
                  voteSummary: day.accommodation.feedback.voteSummary,
                },
              }
            : null,
          dayPlanItems: day.dayPlanItems.map((item) => ({
            id: item.id,
            title: item.title,
            fromTime: item.fromTime,
            toTime: item.toTime,
            contentJson: item.contentJson,
            costCents: item.costCents,
            payments: item.payments ?? [],
            linkUrl: item.linkUrl,
            location: item.location,
            feedback: {
              targetType: item.feedback.targetType,
              targetId: item.feedback.targetId,
              comments: item.feedback.comments.map((comment) => ({
                id: comment.id,
                body: comment.body,
                createdAt: comment.createdAt.toISOString(),
                updatedAt: comment.updatedAt.toISOString(),
                author: comment.author,
              })),
              voteSummary: item.feedback.voteSummary,
            },
          })),
          travelSegments: day.travelSegments.map((segment) => ({
            id: segment.id,
            fromItemType: segment.fromItemType,
            fromItemId: segment.fromItemId,
            toItemType: segment.toItemType,
            toItemId: segment.toItemId,
            transportType: segment.transportType,
            durationMinutes: segment.durationMinutes,
            distanceKm: segment.distanceKm,
            linkUrl: segment.linkUrl,
          })),
          feedback: {
            targetType: day.feedback.targetType,
            targetId: day.feedback.targetId,
            comments: day.feedback.comments.map((comment) => ({
              id: comment.id,
              body: comment.body,
              createdAt: comment.createdAt.toISOString(),
              updatedAt: comment.updatedAt.toISOString(),
              author: comment.author,
            })),
            voteSummary: day.feedback.voteSummary,
          },
        };
      }),
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

  const auth = await requireSession(request);
  if (auth.response) {
    return auth.response;
  }
  const userId = auth.session.sub;

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
