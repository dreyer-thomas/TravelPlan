import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { hasTripOwnerOrContributorAccess } from "@/lib/auth/tripAccess";
import { CSRF_COOKIE_NAME, validateCsrf } from "@/lib/security/csrf";
import { prisma } from "@/lib/db/prisma";
import { moveDayPlanItemsBetweenTripDays, swapDayPlanItemsBetweenTripDays } from "@/lib/repositories/dayPlanItemRepo";
import { dayActivityTransferSchema } from "@/lib/validation/dayPlanItemSchemas";
import { requireSession } from "@/lib/auth/sessionGuard";

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
    return fail(apiError("unauthorized", "Trip write access required"), 403);
  }

  const rawPayload = await parseJson(request);
  if (!rawPayload) {
    return fail(apiError("invalid_json", "Request body must be valid JSON"), 400);
  }

  const parsed = dayActivityTransferSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid day activity transfer", parsed.error.flatten()), 400);
  }

  if (parsed.data.operation === "move") {
    const targetDay = await prisma.tripDay.findFirst({
      where: {
        id: parsed.data.targetTripDayId,
        tripId,
      },
      select: {
        id: true,
        _count: {
          select: {
            dayPlanItems: true,
          },
        },
      },
    });

    if (!targetDay) {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }
    if (targetDay._count.dayPlanItems > 0 && parsed.data.confirmOverwrite !== true) {
      return fail(
        apiError("validation_error", "Move transfers require overwrite confirmation", {
          fieldErrors: {
            confirmOverwrite: ["Move transfers require overwrite confirmation"],
          },
        }),
        400,
      );
    }

    const result = await moveDayPlanItemsBetweenTripDays({
      userId,
      tripId,
      sourceTripDayId: parsed.data.sourceTripDayId,
      targetTripDayId: parsed.data.targetTripDayId,
    });

    if (result.status === "not_found") {
      return fail(apiError("not_found", "Trip day not found"), 404);
    }
    if (result.status === "validation_error") {
      return fail(apiError("validation_error", result.message), 400);
    }

    return ok({
      operation: "move" as const,
      sourceTripDayId: parsed.data.sourceTripDayId,
      targetTripDayId: parsed.data.targetTripDayId,
      movedItemIds: result.movedItemIds,
      removedTargetItemIds: result.removedTargetItemIds,
    });
  }

  const result = await swapDayPlanItemsBetweenTripDays({
    userId,
    tripId,
    firstTripDayId: parsed.data.sourceTripDayId,
    secondTripDayId: parsed.data.targetTripDayId,
  });

  if (result.status === "not_found") {
    return fail(apiError("not_found", "Trip day not found"), 404);
  }
  if (result.status === "validation_error") {
    return fail(apiError("validation_error", result.message), 400);
  }

  return ok({
    operation: "swap" as const,
    sourceTripDayId: parsed.data.sourceTripDayId,
    targetTripDayId: parsed.data.targetTripDayId,
    firstDayItemIds: result.firstDayItemIds,
    secondDayItemIds: result.secondDayItemIds,
  });
};
