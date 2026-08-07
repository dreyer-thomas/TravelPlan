import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST } from "@/app/api/trips/[id]/bucket-list-items/route";
import { prisma } from "@/lib/db/prisma";
import { createSessionJwt } from "@/lib/auth/jwt";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

const buildRequest = (
  url: string,
  options?: { session?: string; csrf?: string; method?: string; body?: string },
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options?.session) {
    headers.cookie = `session=${options.session}`;
  }

  if (options?.csrf) {
    headers.cookie = headers.cookie ? `${headers.cookie}; csrf_token=${options.csrf}` : `csrf_token=${options.csrf}`;
    headers["x-csrf-token"] = options.csrf;
  }

  return new NextRequest(url, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body,
  });
};

/**
 * The handlers take `{ params: Promise<{ id?: string }> }`. The cases added by Story 5.13 build it
 * through this helper rather than the bare object literal the older cases pass, which does not
 * type-check.
 */
const routeContext = (tripId: string) => ({ params: Promise.resolve({ id: tripId }) });

describe("/api/trips/[id]/bucket-list-items", () => {
  beforeEach(async () => {
    await prisma.tripBucketListItem.deleteMany();
    // Added by Story 5.13, which gave this suite its first memberships. Without it a stale row would
    // decide the next test's role.
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("lists bucket list items for the trip ordered by title", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Bucket Route Trip",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-05T00:00:00.000Z"),
      },
    });

    await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Zoo",
        description: null,
        positionText: null,
      },
    });

    await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Aquarium",
        description: "Sea life",
        positionText: "City center",
        locationLat: 48.1372,
        locationLng: 11.5756,
        locationLabel: "Marienplatz",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      method: "GET",
    });

    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      items: {
        id: string;
        title: string;
        description: string | null;
        positionText: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      }[];
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.items.map((item) => item.title)).toEqual(["Aquarium", "Zoo"]);
    expect(payload.data?.items[0].location).toEqual({ lat: 48.1372, lng: 11.5756, label: "Marienplatz" });
  });

  it("returns 404 when listing items for a non-owned trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "bucket-route-owner-2@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const other = await prisma.user.create({
      data: { email: "bucket-route-other@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Bucket Trip",
        startDate: new Date("2026-12-02T00:00:00.000Z"),
        endDate: new Date("2026-12-02T00:00:00.000Z"),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      method: "GET",
    });

    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("blocks flagged sessions from protected bucket-list routes", async () => {
    const user = await prisma.user.create({
      data: {
        email: "bucket-route-flagged@example.com",
        passwordHash: "hashed",
        role: "VIEWER",
        mustChangePassword: true,
      },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role, mustChangePassword: true });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Flagged Bucket Trip",
        startDate: new Date("2026-12-02T00:00:00.000Z"),
        endDate: new Date("2026-12-02T00:00:00.000Z"),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      method: "GET",
    });

    const response = await GET(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("password_change_required");
  });

  it("creates a bucket list item for the trip", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-create@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Create Bucket Trip",
        startDate: new Date("2026-12-03T00:00:00.000Z"),
        endDate: new Date("2026-12-03T00:00:00.000Z"),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        title: "Visit museum",
        description: "Morning stop",
        positionText: "Alte Pinakothek, Munich",
        location: { lat: 48.1486, lng: 11.5676, label: "Alte Pinakothek" },
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      item: {
        id: string;
        tripId: string;
        title: string;
        description: string | null;
        positionText: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.item.tripId).toBe(trip.id);
    expect(payload.data?.item.title).toBe("Visit museum");
    expect(payload.data?.item.description).toBe("Morning stop");
    expect(payload.data?.item.positionText).toBe("Alte Pinakothek, Munich");
    expect(payload.data?.item.location).toEqual({ lat: 48.1486, lng: 11.5676, label: "Alte Pinakothek" });
  });

  it("rejects empty title on create", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-empty-title@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Empty Title Bucket Trip",
        startDate: new Date("2026-12-04T00:00:00.000Z"),
        endDate: new Date("2026-12-04T00:00:00.000Z"),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        title: " ",
        description: "Hidden",
        positionText: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("validation_error");
  });

  it("rejects create without CSRF token", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-create-no-csrf@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "No CSRF Bucket Trip",
        startDate: new Date("2026-12-07T00:00:00.000Z"),
        endDate: new Date("2026-12-07T00:00:00.000Z"),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      method: "POST",
      body: JSON.stringify({
        title: "No CSRF item",
        description: null,
        positionText: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("rejects create for non-owned trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "bucket-route-owner-create@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const other = await prisma.user.create({
      data: { email: "bucket-route-other-create@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Bucket Trip Create",
        startDate: new Date("2026-12-08T00:00:00.000Z"),
        endDate: new Date("2026-12-08T00:00:00.000Z"),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        title: "Not allowed",
        description: null,
        positionText: null,
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("rejects partial location coordinates on create", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-location-invalid@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Invalid Location Bucket Trip",
        startDate: new Date("2026-12-04T00:00:00.000Z"),
        endDate: new Date("2026-12-04T00:00:00.000Z"),
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        title: "Invalid location",
        description: null,
        positionText: null,
        location: { lat: 48.145 },
      }),
    });

    const response = await POST(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("validation_error");
  });

  it("updates a bucket list item for the trip", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-update@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Update Bucket Trip",
        startDate: new Date("2026-12-05T00:00:00.000Z"),
        endDate: new Date("2026-12-05T00:00:00.000Z"),
      },
    });

    const item = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Original",
        description: "Old desc",
        positionText: "Old place",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        itemId: item.id,
        title: "Updated",
        description: "New desc",
        positionText: "New place",
        location: { lat: 48.13, lng: 11.56, label: "Center" },
      }),
    });

    const response = await PATCH(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{
      item: {
        id: string;
        title: string;
        description: string | null;
        positionText: string | null;
        location: { lat: number; lng: number; label: string | null } | null;
      };
    }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.item.title).toBe("Updated");
    expect(payload.data?.item.description).toBe("New desc");
    expect(payload.data?.item.positionText).toBe("New place");
    expect(payload.data?.item.location).toEqual({ lat: 48.13, lng: 11.56, label: "Center" });
  });

  it("rejects update without CSRF token", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-update-no-csrf@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "No CSRF Update Trip",
        startDate: new Date("2026-12-09T00:00:00.000Z"),
        endDate: new Date("2026-12-09T00:00:00.000Z"),
      },
    });

    const item = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Original",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      method: "PATCH",
      body: JSON.stringify({
        itemId: item.id,
        title: "Updated",
        description: null,
        positionText: null,
      }),
    });

    const response = await PATCH(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("rejects update for non-owned trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "bucket-route-owner-update@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const other = await prisma.user.create({
      data: { email: "bucket-route-other-update@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Bucket Trip Update",
        startDate: new Date("2026-12-10T00:00:00.000Z"),
        endDate: new Date("2026-12-10T00:00:00.000Z"),
      },
    });

    const item = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Original",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "PATCH",
      body: JSON.stringify({
        itemId: item.id,
        title: "Updated",
        description: null,
        positionText: null,
      }),
    });

    const response = await PATCH(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("deletes a bucket list item for the trip", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-delete@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "Delete Bucket Trip",
        startDate: new Date("2026-12-06T00:00:00.000Z"),
        endDate: new Date("2026-12-06T00:00:00.000Z"),
      },
    });

    const item = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Delete title",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "DELETE",
      body: JSON.stringify({ itemId: item.id }),
    });

    const response = await DELETE(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<{ deleted: boolean }>;

    expect(response.status).toBe(200);
    expect(payload.error).toBeNull();
    expect(payload.data?.deleted).toBe(true);
  });

  it("rejects delete without CSRF token", async () => {
    const user = await prisma.user.create({
      data: { email: "bucket-route-delete-no-csrf@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: user.id, role: user.role });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        name: "No CSRF Delete Trip",
        startDate: new Date("2026-12-11T00:00:00.000Z"),
        endDate: new Date("2026-12-11T00:00:00.000Z"),
      },
    });

    const item = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Delete title",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      method: "DELETE",
      body: JSON.stringify({ itemId: item.id }),
    });

    const response = await DELETE(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(403);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("csrf_invalid");
  });

  it("rejects delete for non-owned trip", async () => {
    const owner = await prisma.user.create({
      data: { email: "bucket-route-owner-delete@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const other = await prisma.user.create({
      data: { email: "bucket-route-other-delete@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const token = await createSessionJwt({ sub: other.id, role: other.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Private Bucket Trip Delete",
        startDate: new Date("2026-12-12T00:00:00.000Z"),
        endDate: new Date("2026-12-12T00:00:00.000Z"),
      },
    });

    const item = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Delete title",
      },
    });

    const request = buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
      session: token,
      csrf: "csrf-token",
      method: "DELETE",
      body: JSON.stringify({ itemId: item.id }),
    });

    const response = await DELETE(request, { params: { id: trip.id } });
    const payload = (await response.json()) as ApiEnvelope<null>;

    expect(response.status).toBe(404);
    expect(payload.data).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });
  /**
   * Story 5.13, AC2/AC4/AC6. This suite had no `TripMember` rows at all before, because every
   * bucket-list verb was owner-only; all four now resolve through the same widened trip lookup
   * (`findTripForTripWriter`), so all four are asserted together for each of the three roles.
   *
   * The contributor's account row is `role: "VIEWER"` on purpose: the route must decide on
   * `TripMember.role` and never on `User.role`.
   */
  it("lets a contributor list, create, update and delete ideas", async () => {
    const owner = await prisma.user.create({
      data: { email: "bucket-route-role-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const contributor = await prisma.user.create({
      data: { email: "bucket-route-role-contributor@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const token = await createSessionJwt({ sub: contributor.id, role: contributor.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Bucket Route Roles",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-05T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });

    const created = await POST(
      buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
        session: token,
        csrf: "csrf-token",
        method: "POST",
        body: JSON.stringify({ title: "Night market" }),
      }),
      routeContext(trip.id),
    );
    const createdPayload = (await created.json()) as ApiEnvelope<{ item: { id: string; title: string } }>;
    expect(created.status).toBe(200);
    expect(createdPayload.error).toBeNull();
    const itemId = createdPayload.data!.item.id;

    const listed = await GET(
      buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, { session: token, method: "GET" }),
      routeContext(trip.id),
    );
    const listedPayload = (await listed.json()) as ApiEnvelope<{ items: { title: string }[] }>;
    expect(listed.status).toBe(200);
    expect(listedPayload.data?.items.map((entry) => entry.title)).toEqual(["Night market"]);

    const updated = await PATCH(
      buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
        session: token,
        csrf: "csrf-token",
        method: "PATCH",
        body: JSON.stringify({ itemId, title: "Night market at dusk" }),
      }),
      routeContext(trip.id),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as ApiEnvelope<{ item: { title: string } }>).data?.item.title).toBe(
      "Night market at dusk",
    );

    const deleted = await DELETE(
      buildRequest(`http://localhost/api/trips/${trip.id}/bucket-list-items`, {
        session: token,
        csrf: "csrf-token",
        method: "DELETE",
        body: JSON.stringify({ itemId }),
      }),
      routeContext(trip.id),
    );
    expect(deleted.status).toBe(200);
    expect(await prisma.tripBucketListItem.count()).toBe(0);
  });

  it("refuses a viewer 403 forbidden on all four verbs and keeps 404 for a non-participant", async () => {
    const owner = await prisma.user.create({
      data: { email: "bucket-route-refusal-owner@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const viewer = await prisma.user.create({
      data: { email: "bucket-route-refusal-viewer@example.com", passwordHash: "hashed", role: "VIEWER" },
    });
    const viewerToken = await createSessionJwt({ sub: viewer.id, role: viewer.role });
    const stranger = await prisma.user.create({
      data: { email: "bucket-route-refusal-stranger@example.com", passwordHash: "hashed", role: "OWNER" },
    });
    const strangerToken = await createSessionJwt({ sub: stranger.id, role: stranger.role });

    const trip = await prisma.trip.create({
      data: {
        userId: owner.id,
        name: "Bucket Route Refusals",
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        endDate: new Date("2026-12-05T00:00:00.000Z"),
      },
    });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });
    const item = await prisma.tripBucketListItem.create({ data: { tripId: trip.id, title: "Owner idea" } });

    const callEveryVerb = async (sessionToken: string) => {
      const url = `http://localhost/api/trips/${trip.id}/bucket-list-items`;
      return [
        await GET(buildRequest(url, { session: sessionToken, method: "GET" }), routeContext(trip.id)),
        await POST(
          buildRequest(url, {
            session: sessionToken,
            csrf: "csrf-token",
            method: "POST",
            body: JSON.stringify({ title: "Uninvited" }),
          }),
          routeContext(trip.id),
        ),
        await PATCH(
          buildRequest(url, {
            session: sessionToken,
            csrf: "csrf-token",
            method: "PATCH",
            body: JSON.stringify({ itemId: item.id, title: "Renamed" }),
          }),
          routeContext(trip.id),
        ),
        await DELETE(
          buildRequest(url, {
            session: sessionToken,
            csrf: "csrf-token",
            method: "DELETE",
            body: JSON.stringify({ itemId: item.id }),
          }),
          routeContext(trip.id),
        ),
      ];
    };

    for (const response of await callEveryVerb(viewerToken)) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("forbidden");
    }

    // A membership is what earns the 403. Without one the answer is still "there is no such trip".
    for (const response of await callEveryVerb(strangerToken)) {
      expect(response.status).toBe(404);
      expect(((await response.json()) as ApiEnvelope<null>).error?.code).toBe("not_found");
    }

    // Nothing refused above touched the owner's list.
    expect(await prisma.tripBucketListItem.count()).toBe(1);
    expect(await prisma.tripBucketListItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      title: "Owner idea",
    });
  });
});
