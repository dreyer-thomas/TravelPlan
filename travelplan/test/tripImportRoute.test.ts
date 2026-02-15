import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/trips/import/route";
import { createSessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { createTripWithDays } from "@/lib/repositories/tripRepo";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const VALID_PAYLOAD = {
  meta: {
    exportedAt: "2026-02-14T12:00:00.000Z",
    appVersion: "0.1.0",
    formatVersion: 1,
  },
  trip: {
    id: "export-trip-1",
    name: "Imported Route Trip",
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2026-11-02T00:00:00.000Z",
    heroImageUrl: null,
    createdAt: "2026-02-14T12:00:00.000Z",
    updatedAt: "2026-02-14T12:00:00.000Z",
  },
  days: [
    {
      id: "export-day-1",
      date: "2026-11-01T00:00:00.000Z",
      dayIndex: 1,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
    },
    {
      id: "export-day-2",
      date: "2026-11-02T00:00:00.000Z",
      dayIndex: 2,
      createdAt: "2026-02-14T12:00:00.000Z",
      updatedAt: "2026-02-14T12:00:00.000Z",
      accommodation: null,
      dayPlanItems: [],
    },
  ],
};

const buildRequest = (
  body: unknown,
  options?: { session?: string; csrf?: string; rawBody?: string; contentType?: string }
) => {
  const headers: Record<string, string> = {
    "Content-Type": options?.contentType ?? "application/json",
  };

  if (options?.csrf) {
    headers["x-csrf-token"] = options.csrf;
  }

  const cookies: string[] = [];
  if (options?.session) cookies.push(`session=${options.session}`);
  if (options?.csrf) cookies.push(`csrf_token=${options.csrf}`);
  if (cookies.length > 0) headers.cookie = cookies.join("; ");

  return new NextRequest("http://localhost/api/trips/import", {
    method: "POST",
    headers,
    body: options?.rawBody ?? JSON.stringify(body),
  });
};

describe("POST /api/trips/import", () => {
  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("imports valid payload for authenticated user", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-success@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { session, csrf: "csrf-token" }));
    const payload = (await response.json()) as ApiEnvelope<{ trip: { id: string }; dayCount: number; mode: string }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.dayCount).toBe(2);
    expect(payload.data?.mode).toBe("createNew");
  });

  it("rejects unauthenticated requests", async () => {
    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { csrf: "csrf-token" }));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(401);
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("rejects invalid csrf token", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-csrf@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { session }));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("rejects invalid json body", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-json@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(
      buildRequest({}, { session, csrf: "csrf-token", rawBody: "{", contentType: "application/json" })
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("invalid_json");
  });

  it("returns validation error for malformed payload", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-validation@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const response = await POST(
      buildRequest({ payload: { ...VALID_PAYLOAD, days: [{ ...VALID_PAYLOAD.days[0], dayIndex: 0 }] } }, { session, csrf: "csrf-token" })
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("returns name conflict when no strategy is provided", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-conflict@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });

    const response = await POST(buildRequest({ payload: VALID_PAYLOAD }, { session, csrf: "csrf-token" }));
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe("trip_name_conflict");
  });

  it("supports overwrite strategy", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-overwrite@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    const target = await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-02T00:00:00.000Z",
    });

    const response = await POST(
      buildRequest(
        { payload: VALID_PAYLOAD, strategy: "overwrite", targetTripId: target.trip.id },
        { session, csrf: "csrf-token" }
      )
    );
    const payload = (await response.json()) as ApiEnvelope<{ trip: { id: string }; dayCount: number; mode: string }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.mode).toBe("overwrite");
    expect(payload.data?.trip.id).toBe(target.trip.id);
  });

  it("rejects overwrite target that is not part of same-name conflicts", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-invalid-overwrite-target@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });
    const unrelatedTarget = await createTripWithDays({
      userId: user.id,
      name: "Different Name",
      startDate: "2026-09-03T00:00:00.000Z",
      endDate: "2026-09-04T00:00:00.000Z",
    });

    const response = await POST(
      buildRequest(
        { payload: VALID_PAYLOAD, strategy: "overwrite", targetTripId: unrelatedTarget.trip.id },
        { session, csrf: "csrf-token" }
      )
    );
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe("trip_name_conflict");
  });

  it("supports create-new strategy when name conflict exists", async () => {
    const user = await prisma.user.create({
      data: { email: "import-route-create-new@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const session = await createSessionJwt({ sub: user.id, role: user.role });

    await createTripWithDays({
      userId: user.id,
      name: VALID_PAYLOAD.trip.name,
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-02T00:00:00.000Z",
    });

    const response = await POST(
      buildRequest({ payload: VALID_PAYLOAD, strategy: "createNew" }, { session, csrf: "csrf-token" })
    );
    const payload = (await response.json()) as ApiEnvelope<{ trip: { id: string }; dayCount: number; mode: string }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.mode).toBe("createNew");

    const trips = await prisma.trip.findMany({ where: { userId: user.id, name: VALID_PAYLOAD.trip.name } });
    expect(trips).toHaveLength(2);
  });
});
