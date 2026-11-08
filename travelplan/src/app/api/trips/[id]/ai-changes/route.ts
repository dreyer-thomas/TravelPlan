import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess } from "@/lib/auth/tripAccess";
import { requireSession } from "@/lib/auth/sessionGuard";
import { listAiChangesForTrip, PACKING_AI_CHANGE_ACTIONS } from "@/lib/repositories/aiChangeRepo";

/** The notice shows the newest changes; more than this on one day is not worth listing. */
const AI_CHANGES_LIST_LIMIT = 50;

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

/**
 * Story 15.4. `GET /api/trips/{id}/ai-changes?tripDayId=` lists the connector's changes not yet undone
 * nor acknowledged (the notice's OK, `acknowledge/route.ts`), newest first (at most 50), within the 14-day retention, for the day view's notice. `tripDayId` narrows to one day.
 *
 * Session, then the owner-or-contributor gate (404, not 403, so a viewer learns nothing), as the undo
 * routes check. `undoable` means a receipt is stored; whether the undo is still possible is only known by
 * trying it (`409 undo_stale`).
 *
 * Story 16.4: `?scope=packing` lists the packing list's changes instead (every `packing*` action of the
 * trip, day-scoped adds included), for the packing page's notice. `scope` together with `tripDayId` is
 * `400 validation_error`; any other `scope` value too.
 */
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
  if (!(await hasTripOwnerOrContributorAccess(userId, tripId))) {
    return fail(apiError("not_found", "Trip not found"), 404);
  }

  const tripDayId = request.nextUrl.searchParams.get("tripDayId") || undefined;
  const scope = request.nextUrl.searchParams.get("scope") || undefined;
  if (scope !== undefined && (scope !== "packing" || tripDayId !== undefined)) {
    return fail(apiError("validation_error", "Use either scope=packing or tripDayId"), 400);
  }

  try {
    const entries = await listAiChangesForTrip({
      tripId,
      tripDayId,
      ...(scope === "packing" ? { actions: PACKING_AI_CHANGE_ACTIONS } : {}),
      now: new Date(),
      notUndone: true,
      notAcknowledged: true,
      take: AI_CHANGES_LIST_LIMIT,
    });
    return ok({
      changes: entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        subject: entry.subject,
        createdAt: entry.createdAt.toISOString(),
        undoable: entry.hasReceipt,
      })),
    });
  } catch {
    return fail(apiError("server_error", "Unable to load AI changes"), 500);
  }
};
