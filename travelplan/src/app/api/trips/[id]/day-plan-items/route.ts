import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess, hasTripReadAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  createDayPlanItemForTripDay,
  convertBucketListItemToDayPlanItemForTripDay,
  deleteDayPlanItemForTripDay,
  listDayPlanItemsForTripDay,
  updateDayPlanItemForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import {
  dayPlanItemDeleteSchema,
  dayPlanItemMutationSchema,
  dayPlanItemUpdateSchema,
} from "@/lib/validation/dayPlanItemSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";
import { toDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { signDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayChangedResponse, pastMidnightResponse, withPushConflict } from "@/lib/http/dayPlanPushResponses";

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

const requireCsrf = (request: NextRequest) => {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token") ?? undefined;
  return validateCsrf(csrfCookie, csrfHeader);
};

const parseJson = async (request: NextRequest) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
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
  if (!(await hasTripReadAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const tripDayId = request.nextUrl.searchParams.get("tripDayId") ?? "";
  if (!tripDayId.trim()) {
    return fail(apiError("validation_error", "Trip day is required"), 400);
  }

  try {
    const items = await listDayPlanItemsForTripDay({ userId, tripId, tripDayId });
    if (!items) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }

    return ok({
      items: items.map((item) => ({
        id: item.id,
        tripDayId: item.tripDayId,
        title: item.title,
        fromTime: item.fromTime,
        toTime: item.toTime,
        contentJson: item.contentJson,
        costCents: item.costCents,
        costOriginalAmount: item.costOriginalAmount,
        costCurrency: item.costCurrency,
        costRate: item.costRate,
        costRateDate: item.costRateDate,
        payments: item.payments ?? [],
        linkUrl: item.linkUrl,
        location: item.location,
        createdAt: item.createdAt.toISOString(),
        scheduleMode: item.scheduleMode,
        durationMinutes: item.durationMinutes,
        sortOrder: item.sortOrder,
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load day plan items"), 500);
  }
};

export const POST = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
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
  if (!(await hasTripOwnerOrContributorAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemMutationSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day plan item", parsed.error.flatten()), 400);
  }

  const linkUrl = parsed.data.linkUrl?.trim() ?? null;
  const location = parsed.data.location ?? null;
  const normalizedLocation =
    location && typeof location.lat === "number" && typeof location.lng === "number"
      ? {
          lat: location.lat,
          lng: location.lng,
          label: location.label?.trim() || null,
        }
      : null;

  const bucketListItemId = parsed.data.bucketListItemId ?? null;
  const resolvedLinkUrl = linkUrl && linkUrl.length > 0 ? linkUrl : null;
  const mutationParams = {
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    title: parsed.data.title,
    scheduleMode: parsed.data.scheduleMode,
    durationMinutes: parsed.data.durationMinutes ?? null,
    fromTime: parsed.data.fromTime ?? null,
    toTime: parsed.data.toTime ?? null,
    contentJson: parsed.data.contentJson,
    costCents: parsed.data.costCents ?? null,
    /*
      Story 10.1. Params are built field by field here, so a validated field not named on this list
      is dropped silently - the single most likely way a currency receipt ships half-working.
    */
    costOriginalAmount: parsed.data.costOriginalAmount ?? null,
    costCurrency: parsed.data.costCurrency ?? null,
    costRate: parsed.data.costRate ?? null,
    costRateDate: parsed.data.costRateDate ?? null,
    payments: parsed.data.payments ?? null,
    linkUrl: resolvedLinkUrl,
    location: normalizedLocation,
  };

  const attempt = bucketListItemId
    ? await withPushConflict(() =>
        convertBucketListItemToDayPlanItemForTripDay({
          ...mutationParams,
          bucketListItemId,
        }),
      )
    : await withPushConflict(() => createDayPlanItemForTripDay(mutationParams));
  if ("conflict" in attempt) {
    return dayChangedResponse();
  }
  const created = attempt.result;

  if (!created) {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if ("status" in created) {
    if (created.status === "not_found") {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }
    if (created.status === "bucket_missing") {
      return fail(apiError("not_found", "Bucket list item not found"), 404);
    }
    if (created.status === "past_midnight") {
      return pastMidnightResponse(created.item);
    }
  }

  const resolvedItem = created.item;

  return ok({
    dayPlanItem: {
      id: resolvedItem.id,
      tripDayId: resolvedItem.tripDayId,
      title: resolvedItem.title,
      fromTime: resolvedItem.fromTime,
      toTime: resolvedItem.toTime,
      contentJson: resolvedItem.contentJson,
      costCents: resolvedItem.costCents,
      costOriginalAmount: resolvedItem.costOriginalAmount,
      costCurrency: resolvedItem.costCurrency,
      costRate: resolvedItem.costRate,
      costRateDate: resolvedItem.costRateDate,
      payments: resolvedItem.payments ?? [],
      linkUrl: resolvedItem.linkUrl,
      location: resolvedItem.location,
      createdAt: resolvedItem.createdAt.toISOString(),
      scheduleMode: resolvedItem.scheduleMode,
      durationMinutes: resolvedItem.durationMinutes,
      sortOrder: resolvedItem.sortOrder,
    },
    // Story 11.1 AC2: always present, even when the write swept nothing. `dayPlanItem` is unchanged.
    // Signed for this trip and this user, so the undo route can refuse anything it did not issue.
    receipt: signDayChangeReceipt(toDayChangeReceiptWire(created.receipt), { tripId, userId }),
  });
};

export const PATCH = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
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
  if (!(await hasTripOwnerOrContributorAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemUpdateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day plan item", parsed.error.flatten()), 400);
  }

  const linkUrl = parsed.data.linkUrl?.trim() ?? null;
  const location = parsed.data.location ?? null;
  const normalizedLocation =
    location && typeof location.lat === "number" && typeof location.lng === "number"
      ? {
          lat: location.lat,
          lng: location.lng,
          label: location.label?.trim() || null,
        }
      : null;

  const attempt = await withPushConflict(() => updateDayPlanItemForTripDay({
    userId,
    tripId,
    tripDayId: parsed.data.tripDayId,
    itemId: parsed.data.itemId,
    title: parsed.data.title,
    scheduleMode: parsed.data.scheduleMode,
    durationMinutes: parsed.data.durationMinutes ?? null,
    fromTime: parsed.data.fromTime ?? null,
    toTime: parsed.data.toTime ?? null,
    contentJson: parsed.data.contentJson,
    costCents: parsed.data.costCents ?? null,
    // Story 10.1 - see the note on the POST handler above.
    costOriginalAmount: parsed.data.costOriginalAmount ?? null,
    costCurrency: parsed.data.costCurrency ?? null,
    costRate: parsed.data.costRate ?? null,
    costRateDate: parsed.data.costRateDate ?? null,
    payments: parsed.data.payments ?? null,
    linkUrl: linkUrl && linkUrl.length > 0 ? linkUrl : null,
    location: normalizedLocation,
  }));
  if ("conflict" in attempt) {
    return dayChangedResponse();
  }
  const updated = attempt.result;

  if (updated.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if (updated.status === "missing") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }

  if (updated.status === "past_midnight") {
    return pastMidnightResponse(updated.item);
  }

  return ok({
    dayPlanItem: {
      id: updated.item.id,
      tripDayId: updated.item.tripDayId,
      title: updated.item.title,
      fromTime: updated.item.fromTime,
      toTime: updated.item.toTime,
      contentJson: updated.item.contentJson,
      costCents: updated.item.costCents,
      costOriginalAmount: updated.item.costOriginalAmount,
      costCurrency: updated.item.costCurrency,
      costRate: updated.item.costRate,
      costRateDate: updated.item.costRateDate,
      payments: updated.item.payments ?? [],
      linkUrl: updated.item.linkUrl,
      location: updated.item.location,
      createdAt: updated.item.createdAt.toISOString(),
      scheduleMode: updated.item.scheduleMode,
      durationMinutes: updated.item.durationMinutes,
      sortOrder: updated.item.sortOrder,
    },
    receipt: signDayChangeReceipt(toDayChangeReceiptWire(updated.receipt), { tripId, userId }),
  });
};

export const DELETE = async (request: NextRequest, context: RouteContext) => {
  if (!requireCsrf(request)) {
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

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayPlanItemDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day plan item", parsed.error.flatten()), 400);
  }

  // Story 13.1: a delete recomputes the day now, so it can lose the race the other writes can.
  const attempt = await withPushConflict(() =>
    deleteDayPlanItemForTripDay({
      userId,
      tripId,
      tripDayId: parsed.data.tripDayId,
      itemId: parsed.data.itemId,
    }),
  );
  if ("conflict" in attempt) {
    return dayChangedResponse();
  }
  const deleted = attempt.result;

  if (deleted.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }

  if (deleted.status === "missing") {
    return fail(apiError("not_found", "Day plan item not found"), 404);
  }
  if (deleted.status === "past_midnight") {
    return pastMidnightResponse(deleted.item);
  }

  // Story 6.23 AC6: deleting an activity now also removes the travel segments that pointed at it.
  // The ids are load-bearing, not decoration: `handleDeletePlan` removes the item optimistically and
  // never reloads the day, so without them the client would keep the deleted segments in state and
  // "Fahrzeit" would go on counting their minutes for the rest of the session.
  // Story 11.1: the list now includes the legs the delete un-drew as well as those referencing the item.
  return ok({
    deleted: true,
    removedTravelSegmentIds: deleted.removedTravelSegmentIds,
    receipt: signDayChangeReceipt(toDayChangeReceiptWire(deleted.receipt), { tripId, userId }),
  });
};
