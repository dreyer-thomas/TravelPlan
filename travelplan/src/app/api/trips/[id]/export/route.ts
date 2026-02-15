import type { NextRequest } from "next/server";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { getTripExportForUser } from "@/lib/repositories/tripRepo";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

const APP_VERSION = process.env.npm_package_version ?? "0.1.0";
const FORMAT_VERSION = 1;

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

const toSafeSlug = (name: string) => {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized || "trip";
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
    const exported = await getTripExportForUser(userId, tripId);
    if (!exported) {
      return fail(apiError("not_found", "Trip not found"), 404);
    }

    const generatedAt = new Date().toISOString();
    const datePart = generatedAt.slice(0, 10);
    // Keep export payload deterministic for unchanged trip data.
    const exportedAt = exported.trip.updatedAt;
    const fileName = `trip-${toSafeSlug(exported.trip.name)}-${datePart}.json`;

    const body = JSON.stringify({
      meta: {
        exportedAt,
        appVersion: APP_VERSION,
        formatVersion: FORMAT_VERSION,
      },
      trip: exported.trip,
      days: exported.days,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch {
    return fail(apiError("server_error", "Unable to export trip"), 500);
  }
};
