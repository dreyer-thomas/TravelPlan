import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createBucketListItemForTrip,
  deleteBucketListItemForTrip,
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
});
