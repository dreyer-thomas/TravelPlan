import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { refuseUnlessTripWriter } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import {
  createParkedDayPlanItem,
  deleteParkedDayPlanItem,
  listParkedDayPlanItemsForTrip,
  type ParkedDayPlanItemDetail,
  updateParkedDayPlanItem,
} from "@/lib/repositories/bucketListRepo";
import {
  bucketListDeleteSchema,
  bucketListMutationSchema,
  bucketListUpdateSchema,
  type BucketListMutationInput,
} from "@/lib/validation/bucketListSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";
import { removeManagedMediaFile } from "@/lib/trips/mediaCleanup";
import {
  getParkedDayPlanItemDocumentUploadDir,
  getParkedDayPlanItemImageUploadDir,
  resolveManagedItemMediaDir,
} from "@/lib/trips/uploadPaths";

/**
 * Story 14.1 (FR30, FR31). The bucket list: the trip's parked activities (`DayPlanItem` with no day).
 * Same four methods and the same gate as before (`refuseUnlessTripWriter`: viewer 403, outsider 404,
 * plus the repository's writer clause), now with the activity payload. These writes recompute no day,
 * so they answer `{ data: { item } }` / `{ data: { items } }` and never a receipt. Scheduling an idea
 * onto a day is `day-plan-items/schedule`.
 */

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

const normalizeLocation = (location: { lat: number; lng: number; label?: string | null } | null | undefined) =>
  location && typeof location.lat === "number" && typeof location.lng === "number"
    ? {
        lat: location.lat,
        lng: location.lng,
        label: location.label?.trim() || null,
      }
    : null;

/** Field by field, as `day-plan-items/route.ts` does, so a validated field cannot be dropped unnoticed. */
const toMutationParams = (data: BucketListMutationInput) => {
  const linkUrl = data.linkUrl?.trim() ?? "";
  return {
    title: data.title,
    contentJson: data.contentJson,
    durationMinutes: data.durationMinutes ?? null,
    costCents: data.costCents ?? null,
    costOriginalAmount: data.costOriginalAmount ?? null,
    costCurrency: data.costCurrency ?? null,
    costRate: data.costRate ?? null,
    costRateDate: data.costRateDate ?? null,
    payments: data.payments ?? null,
    linkUrl: linkUrl.length > 0 ? linkUrl : null,
    location: normalizeLocation(data.location ?? null),
  };
};

const toWire = (item: ParkedDayPlanItemDetail) => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

/**
 * After the commit: each file from the folder its own URL names (`resolveManagedItemMediaDir`), so a
 * picture the activity got on an earlier day goes too; a URL outside the item's folders is logged and
 * skipped. Then every folder a file came from (and an item folder above a documents folder) and the parked
 * folders, deepest first, each only if empty. Never throws: the row is already gone.
 */
const removeParkedItemFiles = async (
  tripId: string,
  itemId: string,
  urls: { imageUrls: string[]; documentUrls: string[] },
) => {
  const files = [
    ...urls.imageUrls.map((storedUrl) => ({ storedUrl, kind: "image" as const })),
    ...urls.documentUrls.map((storedUrl) => ({ storedUrl, kind: "document" as const })),
  ];
  const dirs = new Set([getParkedDayPlanItemDocumentUploadDir(tripId, itemId), getParkedDayPlanItemImageUploadDir(tripId, itemId)]);
  for (const { storedUrl, kind } of files) {
    const allowedDir = resolveManagedItemMediaDir({ storedUrl, tripId, itemId, kind });
    if (!allowedDir) {
      console.error("bucket list item delete: stored media url names no folder of this activity", {
        tripId,
        itemId,
        storedUrl,
      });
      continue;
    }
    await removeManagedMediaFile({ storedUrl, allowedDir, context: "bucket list item delete" });
    dirs.add(allowedDir);
    // A document sits in `<item>/documents`; the item's own folder above it may be empty now too.
    if (kind === "document") dirs.add(path.dirname(allowedDir));
  }
  // Deepest first, so a documents folder goes before the item folder that holds it.
  for (const dir of [...dirs].sort((left, right) => right.length - left.length)) {
    await fs.rmdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
        console.error("bucket list item delete: could not remove folder", { tripId, itemId, dir, code: error.code });
      }
    });
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return refusal;
  }

  try {
    const items = await listParkedDayPlanItemsForTrip({ userId, tripId });
    if (!items) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({ items: items.map(toWire) });
  } catch {
    return fail(apiError("server_error", "Unable to load bucket list items"), 500);
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return refusal;
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = bucketListMutationSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid bucket list item", parsed.error.flatten()), 400);
  }

  try {
    const item = await createParkedDayPlanItem({ userId, tripId, ...toMutationParams(parsed.data) });

    if (!item) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    return ok({ item: toWire(item) });
  } catch {
    return fail(apiError("server_error", "Unable to save bucket list item"), 500);
  }
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
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return refusal;
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = bucketListUpdateSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid bucket list item", parsed.error.flatten()), 400);
  }

  try {
    const updated = await updateParkedDayPlanItem({
      userId,
      tripId,
      itemId: parsed.data.itemId,
      ...toMutationParams(parsed.data),
    });

    if (updated.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    if (updated.status === "missing") {
      return fail(apiError("not_found", "Bucket list item not found"), 404);
    }

    return ok({ item: toWire(updated.item) });
  } catch {
    return fail(apiError("server_error", "Unable to update bucket list item"), 500);
  }
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
  // `DELETE` alone carried no route gate before Story 5.13; it was safe only because
  // `deleteBucketListItemForTrip` resolved through an owner-only trip lookup. That lookup is now the
  // writer clause, so without a gate here a viewer's refusal would come back from the repository as a
  // 404 while the sibling verbs answer 403.
  const refusal = await refuseUnlessTripWriter(userId, tripId, "Trip not found");
  if (refusal) {
    return refusal;
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = bucketListDeleteSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid bucket list item", parsed.error.flatten()), 400);
  }

  try {
    const deleted = await deleteParkedDayPlanItem({
      userId,
      tripId,
      itemId: parsed.data.itemId,
    });

    if (deleted.status === "not_found") {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    if (deleted.status === "missing") {
      return fail(apiError("not_found", "Bucket list item not found"), 404);
    }

    await removeParkedItemFiles(tripId, parsed.data.itemId, deleted);
    return ok({ deleted: true });
  } catch {
    return fail(apiError("server_error", "Unable to delete bucket list item"), 500);
  }
};
