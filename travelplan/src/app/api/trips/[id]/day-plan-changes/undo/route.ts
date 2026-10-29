import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { requireSession } from "@/lib/auth/sessionGuard";
import { fromDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { runDayChangeUndo } from "@/lib/trips/dayChangeUndo";
import { verifyDayChangeReceipt } from "@/lib/trips/dayChangeReceiptSignature";
import { dayChangeUndoSchema } from "@/lib/validation/dayChangeReceiptSchemas";

/**
 * Story 11.1 AC5/AC6/AC8/AC12. `POST /api/trips/{id}/day-plan-changes/undo` with `{ receipt }` takes a
 * day-plan change back in one transaction.
 *
 * The check order is `day-plan-items/route.ts`'s POST, so this endpoint refuses exactly who and what
 * that one refuses, in the same order: CSRF, session, the owner-or-contributor gate (404, not 403, so a
 * viewer learns nothing), JSON, then the schema. Then the signature: a receipt this server did not
 * issue for this trip and this user, or one altered since, is a `400` before anything reads it (AC12).
 * The repository adds the writer clause on the day and the ownership checks on every row (`invalid` →
 * 400), then staleness (`409 undo_stale`).
 *
 * Story 12.4: undoing an apply of suggestions deletes image rows whose files nothing else names; they are
 * unlinked after the commit. Story 15.4 moved that cleanup, with the repository call, into the shared undo
 * core (`runDayChangeUndo`); this route keeps the signature check in front of it.
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

  const parsed = dayChangeUndoSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid change receipt", parsed.error.flatten()), 400);
  }

  const receipt = verifyDayChangeReceipt(parsed.data.receipt, { tripId, userId });
  if (!receipt) {
    return fail(apiError("validation_error", "Invalid change receipt"), 400);
  }

  try {
    const result = await runDayChangeUndo({
      userId,
      tripId,
      receipt: fromDayChangeReceiptWire(receipt),
    });

    switch (result.status) {
      case "not_found":
        return fail(apiError("not_found", "Trip day not found"), 404);
      case "invalid":
        return fail(apiError("validation_error", "Invalid change receipt"), 400);
      case "stale":
        return fail(apiError("undo_stale", "The day has changed since this change was made"), 409);
      case "undone":
        return ok({ undone: true });
      default: {
        const unhandled: never = result;
        throw new Error(`Unhandled undo result: ${String(unhandled)}`);
      }
    }
  } catch {
    return fail(apiError("server_error", "Unable to undo the change"), 500);
  }
};
