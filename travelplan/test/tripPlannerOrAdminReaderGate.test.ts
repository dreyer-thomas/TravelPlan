import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { refuseUnlessTripPlannerOrAdminReader } from "@/lib/auth/tripAccess";

/**
 * Story 12.1, Task 3. The gate for the AI day-suggestion search: a trip writer, or an ADMIN who can at
 * least read the trip. An admin who is not on the trip is a non-participant like any other (404).
 */
describe("refuseUnlessTripPlannerOrAdminReader", () => {
  let counter = 0;
  const makeUser = (role: "OWNER" | "ADMIN" = "OWNER") =>
    prisma.user.create({
      data: { email: `gate-${Date.now()}-${counter++}@example.com`, passwordHash: "hashed", role },
    });

  const makeTrip = async (ownerId: string) =>
    prisma.trip.create({
      data: {
        userId: ownerId,
        name: "Gate trip",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-02T00:00:00.000Z"),
      },
    });

  const addMember = (tripId: string, userId: string, role: "VIEWER" | "CONTRIBUTOR") =>
    prisma.tripMember.create({ data: { tripId, userId, role } });

  const statusOf = async (refusal: Response | null) =>
    refusal ? { status: refusal.status, body: (await refusal.json()) as { error: { code: string; message: string } } } : null;

  beforeEach(async () => {
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("admits the owner", async () => {
    const owner = await makeUser();
    const trip = await makeTrip(owner.id);
    expect(await refuseUnlessTripPlannerOrAdminReader(owner.id, trip.id, "Trip day not found")).toBeNull();
  });

  it("admits a contributor", async () => {
    const owner = await makeUser();
    const contributor = await makeUser();
    const trip = await makeTrip(owner.id);
    await addMember(trip.id, contributor.id, "CONTRIBUTOR");
    expect(await refuseUnlessTripPlannerOrAdminReader(contributor.id, trip.id, "Trip day not found")).toBeNull();
  });

  it("admits an admin who is a viewer of the trip", async () => {
    const owner = await makeUser();
    const admin = await makeUser("ADMIN");
    const trip = await makeTrip(owner.id);
    await addMember(trip.id, admin.id, "VIEWER");
    expect(await refuseUnlessTripPlannerOrAdminReader(admin.id, trip.id, "Trip day not found")).toBeNull();
  });

  it("refuses a viewer who is not an admin with 403 forbidden", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const trip = await makeTrip(owner.id);
    await addMember(trip.id, viewer.id, "VIEWER");

    const refusal = await statusOf(await refuseUnlessTripPlannerOrAdminReader(viewer.id, trip.id, "Trip day not found"));
    expect(refusal?.status).toBe(403);
    expect(refusal?.body.error).toMatchObject({ code: "forbidden", message: "Trip write access required" });
  });

  it("refuses an admin who is not on the trip with the same 404 as anyone else", async () => {
    const owner = await makeUser();
    const admin = await makeUser("ADMIN");
    const trip = await makeTrip(owner.id);

    const refusal = await statusOf(await refuseUnlessTripPlannerOrAdminReader(admin.id, trip.id, "Trip day not found"));
    expect(refusal?.status).toBe(404);
    expect(refusal?.body.error).toMatchObject({ code: "not_found", message: "Trip day not found" });
  });

  it("refuses a stranger with 404", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const trip = await makeTrip(owner.id);

    const refusal = await statusOf(await refuseUnlessTripPlannerOrAdminReader(stranger.id, trip.id, "Trip day not found"));
    expect(refusal?.status).toBe(404);
  });
});
