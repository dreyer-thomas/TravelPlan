import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createBucketListItemForTrip,
  deleteBucketListItemForTrip,
  findBucketListItemForTrip,
  findBucketListItemForTripInTransaction,
  listBucketListItemsForTrip,
  updateBucketListItemForTrip,
} from "@/lib/repositories/bucketListRepo";

const createUser = async (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: "hashed",
      role: "OWNER",
    },
  });

const createTrip = async (userId: string) =>
  prisma.trip.create({
    data: {
      userId,
      name: "Bucket Trip",
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-10T00:00:00.000Z"),
    },
  });

describe("bucketListRepo", () => {
  beforeEach(async () => {
    await prisma.tripBucketListItem.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates a bucket list item for a trip", async () => {
    const user = await createUser("bucket-owner@example.com");
    const trip = await createTrip(user.id);

    const item = await createBucketListItemForTrip({
      userId: user.id,
      tripId: trip.id,
      title: "Visit museum",
      description: "Morning stop",
      positionText: "Alte Pinakothek, Munich",
      location: { lat: 48.1486, lng: 11.5676, label: "Alte Pinakothek" },
    });

    expect(item).not.toBeNull();
    expect(item?.tripId).toBe(trip.id);
    expect(item?.title).toBe("Visit museum");
    expect(item?.description).toBe("Morning stop");
    expect(item?.positionText).toBe("Alte Pinakothek, Munich");
    expect(item?.location).toEqual({ lat: 48.1486, lng: 11.5676, label: "Alte Pinakothek" });
  });

  it("lists bucket list items ordered alphabetically by title", async () => {
    const user = await createUser("bucket-order@example.com");
    const trip = await createTrip(user.id);

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
      },
    });

    const items = await listBucketListItemsForTrip({
      userId: user.id,
      tripId: trip.id,
    });

    expect(items).not.toBeNull();
    expect(items?.map((entry) => entry.title)).toEqual(["Aquarium", "Zoo"]);
  });

  it("rejects listing items for a non-owned trip", async () => {
    const owner = await createUser("bucket-owner-2@example.com");
    const other = await createUser("bucket-other@example.com");
    const trip = await createTrip(owner.id);

    const items = await listBucketListItemsForTrip({
      userId: other.id,
      tripId: trip.id,
    });

    expect(items).toBeNull();
  });

  it("updates a bucket list item for a trip", async () => {
    const user = await createUser("bucket-update@example.com");
    const trip = await createTrip(user.id);

    const created = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Old title",
        description: "Old desc",
        positionText: "Old place",
      },
    });

    const updated = await updateBucketListItemForTrip({
      userId: user.id,
      tripId: trip.id,
      itemId: created.id,
      title: "New title",
      description: "New desc",
      positionText: "New place",
      location: { lat: 48.141, lng: 11.57, label: "New label" },
    });

    expect(updated.status).toBe("updated");
    if (updated.status === "updated") {
      expect(updated.item.title).toBe("New title");
      expect(updated.item.description).toBe("New desc");
      expect(updated.item.positionText).toBe("New place");
      expect(updated.item.location).toEqual({ lat: 48.141, lng: 11.57, label: "New label" });
    }
  });

  it("returns missing when updating an unknown item", async () => {
    const user = await createUser("bucket-update-missing@example.com");
    const trip = await createTrip(user.id);

    const updated = await updateBucketListItemForTrip({
      userId: user.id,
      tripId: trip.id,
      itemId: "missing-item",
      title: "New title",
      description: null,
      positionText: null,
    });

    expect(updated.status).toBe("missing");
  });

  it("returns not_found when updating a non-owned trip", async () => {
    const owner = await createUser("bucket-owner-3@example.com");
    const other = await createUser("bucket-other-3@example.com");
    const trip = await createTrip(owner.id);

    const created = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Shared",
      },
    });

    const updated = await updateBucketListItemForTrip({
      userId: other.id,
      tripId: trip.id,
      itemId: created.id,
      title: "Other edit",
      description: null,
      positionText: null,
    });

    expect(updated.status).toBe("not_found");
  });

  it("deletes a bucket list item for a trip", async () => {
    const user = await createUser("bucket-delete@example.com");
    const trip = await createTrip(user.id);

    const created = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Delete me",
      },
    });

    const deleted = await deleteBucketListItemForTrip({
      userId: user.id,
      tripId: trip.id,
      itemId: created.id,
    });

    expect(deleted.status).toBe("deleted");
    expect(await prisma.tripBucketListItem.count()).toBe(0);
  });

  it("returns missing when deleting an unknown item", async () => {
    const user = await createUser("bucket-delete-missing@example.com");
    const trip = await createTrip(user.id);

    const deleted = await deleteBucketListItemForTrip({
      userId: user.id,
      tripId: trip.id,
      itemId: "missing-item",
    });

    expect(deleted.status).toBe("missing");
  });

  it("rejects deletion for non-owned trip", async () => {
    const owner = await createUser("bucket-owner-4@example.com");
    const other = await createUser("bucket-other-4@example.com");
    const trip = await createTrip(owner.id);

    const created = await prisma.tripBucketListItem.create({
      data: {
        tripId: trip.id,
        title: "Keep",
      },
    });

    const deleted = await deleteBucketListItemForTrip({
      userId: other.id,
      tripId: trip.id,
      itemId: created.id,
    });

    expect(deleted.status).toBe("not_found");
    expect(await prisma.tripBucketListItem.count()).toBe(1);
  });

  /**
   * `findTripForTripWriter` is the single gate behind all four exported functions, so Story 5.13 moved
   * list, create, update and delete by widening one query. This case is the only thing that can tell that
   * widened clause apart from the participant *read* clause: the routes now refuse a viewer with 403 via
   * `refuseUnlessTripWriter` before the repository is ever called, so nothing at the route level reaches
   * this query with a viewer's id, and dropping `role: "CONTRIBUTOR"` from it would ship green.
   *
   * The accounts are deliberately `User.role: "OWNER"` in both cases - what decides the outcome must be
   * the `TripMember` row, not the account role.
   */
  it("admits a contributor to all four bucket-list operations and refuses a viewer every one", async () => {
    const owner = await createUser("bucket-scope-owner@example.com");
    const contributor = await createUser("bucket-scope-contributor@example.com");
    const viewer = await createUser("bucket-scope-viewer@example.com");
    const trip = await createTrip(owner.id);
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const created = await createBucketListItemForTrip({
      userId: contributor.id,
      tripId: trip.id,
      title: "Contributor idea",
    });
    expect(created).not.toBeNull();

    expect(
      (await listBucketListItemsForTrip({ userId: contributor.id, tripId: trip.id }))?.map((entry) => entry.title),
    ).toEqual(["Contributor idea"]);

    const contributorUpdate = await updateBucketListItemForTrip({
      userId: contributor.id,
      tripId: trip.id,
      itemId: created!.id,
      title: "Contributor idea, edited",
      description: null,
      positionText: null,
    });
    expect(contributorUpdate.status).toBe("updated");

    // The viewer half. `not_found`/`null` rather than a distinct refusal status is what these functions
    // return for "outside your scope"; the route above them is what turns it into 403.
    expect(await listBucketListItemsForTrip({ userId: viewer.id, tripId: trip.id })).toBeNull();
    expect(
      await createBucketListItemForTrip({ userId: viewer.id, tripId: trip.id, title: "Viewer idea" }),
    ).toBeNull();
    expect(
      (
        await updateBucketListItemForTrip({
          userId: viewer.id,
          tripId: trip.id,
          itemId: created!.id,
          title: "Viewer edit",
          description: null,
          positionText: null,
        })
      ).status,
    ).toBe("not_found");
    expect(
      (await deleteBucketListItemForTrip({ userId: viewer.id, tripId: trip.id, itemId: created!.id })).status,
    ).toBe("not_found");

    // Nothing the viewer attempted landed, and the contributor's edit survived intact.
    const remaining = await prisma.tripBucketListItem.findMany({ where: { tripId: trip.id } });
    expect(remaining.map((entry) => entry.title)).toEqual(["Contributor idea, edited"]);

    const contributorDelete = await deleteBucketListItemForTrip({
      userId: contributor.id,
      tripId: trip.id,
      itemId: created!.id,
    });
    expect(contributorDelete.status).toBe("deleted");
  });

  /**
   * The two item-level scopes, tested side by side because they are two spellings of one query and the
   * only guard against them drifting apart is that both are asserted with the same inputs.
   *
   * `findBucketListItemForTrip` has no callers at all, so nothing else in the suite touches it.
   * `findBucketListItemForTripInTransaction` has exactly one - `convertBucketListItemToDayPlanItemForTripDay`
   * - which gates on `findTripDayForTripWriter` first, so a viewer is already turned away as `not_found`
   * before this query runs. That makes a direct call the only way to observe it with a viewer's id.
   */
  it("scopes both bucket-list item lookups to writers, in and out of a transaction", async () => {
    const owner = await createUser("bucket-item-scope-owner@example.com");
    const contributor = await createUser("bucket-item-scope-contributor@example.com");
    const viewer = await createUser("bucket-item-scope-viewer@example.com");
    const stranger = await createUser("bucket-item-scope-stranger@example.com");
    const trip = await createTrip(owner.id);
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
    });
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" },
    });

    const item = await prisma.tripBucketListItem.create({
      data: { tripId: trip.id, title: "Shared idea" },
    });

    const inTransaction = (userId: string) =>
      prisma.$transaction((tx) =>
        findBucketListItemForTripInTransaction({ tx, userId, tripId: trip.id, itemId: item.id }),
      );

    for (const [label, userId, expected] of [
      ["owner", owner.id, true],
      ["contributor", contributor.id, true],
      ["viewer", viewer.id, false],
      ["stranger", stranger.id, false],
    ] as const) {
      const direct = await findBucketListItemForTrip({ userId, tripId: trip.id, itemId: item.id });
      const scoped = await inTransaction(userId);

      expect(direct !== null, `findBucketListItemForTrip for ${label}`).toBe(expected);
      expect(scoped !== null, `findBucketListItemForTripInTransaction for ${label}`).toBe(expected);
      // The anti-drift work is done by the two assertions above: each spelling is checked against the
      // same `expected` for the same id, so mutating either clause alone goes red. This one is weaker
      // than it looks - for `viewer` and `stranger` it reduces to `null` equals `null`, and for the two
      // writers both functions read the same row by the same id, so equality is nearly given. It earns
      // its place only by pinning the *selection*: if one spelling ever grows an `include` or narrows a
      // `select` the other does not, the two stop being interchangeable even while both still admit
      // exactly the right people.
      expect(scoped, `both lookups select the same shape for ${label}`).toEqual(direct);
    }
  });
});
