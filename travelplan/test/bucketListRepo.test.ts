import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createParkedDayPlanItem,
  deleteParkedDayPlanItem,
  listParkedDayPlanItemsForTrip,
  updateParkedDayPlanItem,
} from "@/lib/repositories/bucketListRepo";

/**
 * Story 14.1 rewrote this suite for the parked activity (`DayPlanItem` with no day). The old scenarios
 * stay: create, alphabetical list, refusals for a foreign trip, update, delete, `missing` for an unknown
 * item, and the writer clause (contributor in, viewer out). The two in-transaction lookups the old
 * conversion used are gone with it; their scope rule lives on in "never writes a planned activity".
 */

const doc = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

let counter = 0;
const createUser = (label: string) =>
  prisma.user.create({
    data: { email: `bucket-repo-${label}-${counter++}@example.com`, passwordHash: "hashed", role: "OWNER" },
  });

const createTrip = (userId: string) =>
  prisma.trip.create({
    data: {
      userId,
      name: "Bucket Repo Trip",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-03T00:00:00.000Z"),
    },
  });

const base = (userId: string, tripId: string, title: string) => ({
  userId,
  tripId,
  title,
  contentJson: doc(title),
  origin: "user" as const,
});

describe("bucketListRepo (Story 14.1)", () => {
  beforeEach(async () => {
    await prisma.dayPlanItem.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates a parked activity for a trip", async () => {
    const user = await createUser("create");
    const trip = await createTrip(user.id);

    const item = await createParkedDayPlanItem({
      ...base(user.id, trip.id, "  Museum  "),
      durationMinutes: 90,
      costCents: 1200,
      payments: [{ amountCents: 1200, dueDate: "2026-11-01" }],
      linkUrl: "https://example.com",
      location: { lat: 48.1, lng: 11.5, label: "  Pinakothek  " },
    });

    expect(item).toMatchObject({
      tripId: trip.id,
      title: "Museum",
      durationMinutes: 90,
      costCents: 1200,
      payments: [{ amountCents: 1200, dueDate: "2026-11-01" }],
      linkUrl: "https://example.com",
      location: { lat: 48.1, lng: 11.5, label: "Pinakothek" },
      firstImageUrl: null,
    });
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: item!.id } })).toMatchObject({
      tripDayId: null,
      scheduleMode: "FLEXIBLE",
      fromTime: null,
      toTime: null,
      sortOrder: 0,
    });
  });

  it("lists parked activities ordered alphabetically by title, and never a planned one", async () => {
    const user = await createUser("list");
    const trip = await createTrip(user.id);
    const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 } });
    await createParkedDayPlanItem(base(user.id, trip.id, "Zoo"));
    await createParkedDayPlanItem(base(user.id, trip.id, "Aquarium"));
    await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Aaa planned", fromTime: "09:00", toTime: "10:00", contentJson: doc("x") },
    });

    const items = await listParkedDayPlanItemsForTrip({ userId: user.id, tripId: trip.id });
    expect(items?.map((item) => item.title)).toEqual(["Aquarium", "Zoo"]);
  });

  it("rejects listing items for a non-owned trip", async () => {
    const owner = await createUser("list-owner");
    const other = await createUser("list-other");
    const trip = await createTrip(owner.id);
    expect(await listParkedDayPlanItemsForTrip({ userId: other.id, tripId: trip.id })).toBeNull();
  });

  it("updates a parked activity, replacing its payments", async () => {
    const user = await createUser("update");
    const trip = await createTrip(user.id);
    const created = await createParkedDayPlanItem({
      ...base(user.id, trip.id, "Alt"),
      costCents: 500,
      payments: [{ amountCents: 500, dueDate: "2026-11-01" }],
    });

    const result = await updateParkedDayPlanItem({
      ...base(user.id, trip.id, "Neu"),
      itemId: created!.id,
      durationMinutes: 30,
      costCents: 800,
      payments: [
        { amountCents: 300, dueDate: "2026-11-02" },
        { amountCents: 500, dueDate: "2026-11-03" },
      ],
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.item).toMatchObject({ title: "Neu", durationMinutes: 30, costCents: 800 });
    expect(result.item.payments.map((payment) => payment.amountCents)).toEqual([300, 500]);
    expect(await prisma.costPayment.count({ where: { dayPlanItemId: created!.id } })).toBe(2);
  });

  it("drops the payments when an update clears the cost, even without a payments list", async () => {
    const user = await createUser("clear-cost");
    const trip = await createTrip(user.id);
    const created = await createParkedDayPlanItem({
      ...base(user.id, trip.id, "Alt"),
      costCents: 500,
      payments: [{ amountCents: 500, dueDate: "2026-11-01" }],
    });

    const result = await updateParkedDayPlanItem({ ...base(user.id, trip.id, "Alt"), itemId: created!.id, costCents: null });

    expect(result.status).toBe("updated");
    expect(await prisma.costPayment.count({ where: { dayPlanItemId: created!.id } })).toBe(0);
  });

  it("returns missing when updating an unknown item", async () => {
    const user = await createUser("update-missing");
    const trip = await createTrip(user.id);
    expect(await updateParkedDayPlanItem({ ...base(user.id, trip.id, "x"), itemId: "nope" })).toEqual({ status: "missing" });
  });

  it("returns not_found when updating a non-owned trip", async () => {
    const owner = await createUser("update-owner");
    const other = await createUser("update-other");
    const trip = await createTrip(owner.id);
    const created = await createParkedDayPlanItem(base(owner.id, trip.id, "Alt"));
    expect(await updateParkedDayPlanItem({ ...base(other.id, trip.id, "Neu"), itemId: created!.id })).toEqual({
      status: "not_found",
    });
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: created!.id } })).title).toBe("Alt");
  });

  it("deletes a parked activity and returns the media urls the cascade took", async () => {
    const user = await createUser("delete");
    const trip = await createTrip(user.id);
    const created = await createParkedDayPlanItem(base(user.id, trip.id, "Weg"));
    await prisma.dayPlanItemImage.create({ data: { dayPlanItemId: created!.id, imageUrl: "/uploads/a.webp", sortOrder: 1 } });
    await prisma.dayPlanItemDocument.create({
      data: { dayPlanItemId: created!.id, documentUrl: "/uploads/d.pdf", fileName: "d.pdf", sortOrder: 1 },
    });

    expect(await deleteParkedDayPlanItem({ userId: user.id, tripId: trip.id, itemId: created!.id })).toEqual({
      status: "deleted",
      imageUrls: ["/uploads/a.webp"],
      documentUrls: ["/uploads/d.pdf"],
    });
    expect(await prisma.dayPlanItem.count()).toBe(0);
    expect(await prisma.dayPlanItemImage.count()).toBe(0);
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);
  });

  it("returns missing when deleting an unknown item", async () => {
    const user = await createUser("delete-missing");
    const trip = await createTrip(user.id);
    expect(await deleteParkedDayPlanItem({ userId: user.id, tripId: trip.id, itemId: "nope" })).toEqual({ status: "missing" });
  });

  it("rejects deletion for non-owned trip", async () => {
    const owner = await createUser("delete-owner");
    const other = await createUser("delete-other");
    const trip = await createTrip(owner.id);
    const created = await createParkedDayPlanItem(base(owner.id, trip.id, "Bleibt"));
    expect(await deleteParkedDayPlanItem({ userId: other.id, tripId: trip.id, itemId: created!.id })).toEqual({
      status: "not_found",
    });
    expect(await prisma.dayPlanItem.count()).toBe(1);
  });

  it("never edits or deletes a planned activity, nor one of another trip", async () => {
    const user = await createUser("planned");
    const trip = await createTrip(user.id);
    const otherTrip = await createTrip(user.id);
    const day = await prisma.tripDay.create({ data: { tripId: trip.id, date: new Date("2026-12-01T00:00:00.000Z"), dayIndex: 1 } });
    const planned = await prisma.dayPlanItem.create({
      data: { tripId: trip.id, tripDayId: day.id, title: "Geplant", fromTime: "09:00", toTime: "10:00", contentJson: doc("x") },
    });
    const foreign = await createParkedDayPlanItem(base(user.id, otherTrip.id, "Fremd"));

    for (const itemId of [planned.id, foreign!.id]) {
      expect(await updateParkedDayPlanItem({ ...base(user.id, trip.id, "Umbenannt"), itemId })).toEqual({ status: "missing" });
      expect(await deleteParkedDayPlanItem({ userId: user.id, tripId: trip.id, itemId })).toEqual({ status: "missing" });
    }
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: planned.id } })).toMatchObject({
      title: "Geplant",
      tripDayId: day.id,
      fromTime: "09:00",
    });
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: foreign!.id } })).title).toBe("Fremd");
  });

  it("admits a contributor to all four bucket-list operations and refuses a viewer every one", async () => {
    const owner = await createUser("role-owner");
    const contributor = await createUser("role-contributor");
    const viewer = await createUser("role-viewer");
    const trip = await createTrip(owner.id);
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" } });
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: viewer.id, role: "VIEWER" } });

    const created = await createParkedDayPlanItem(base(contributor.id, trip.id, "Beitrag"));
    expect(created).not.toBeNull();
    expect(await listParkedDayPlanItemsForTrip({ userId: contributor.id, tripId: trip.id })).toHaveLength(1);
    expect((await updateParkedDayPlanItem({ ...base(contributor.id, trip.id, "Beitrag 2"), itemId: created!.id })).status).toBe(
      "updated",
    );

    expect(await listParkedDayPlanItemsForTrip({ userId: viewer.id, tripId: trip.id })).toBeNull();
    expect(await createParkedDayPlanItem(base(viewer.id, trip.id, "Nein"))).toBeNull();
    expect(await updateParkedDayPlanItem({ ...base(viewer.id, trip.id, "Nein"), itemId: created!.id })).toEqual({
      status: "not_found",
    });
    expect(await deleteParkedDayPlanItem({ userId: viewer.id, tripId: trip.id, itemId: created!.id })).toEqual({
      status: "not_found",
    });

    expect((await deleteParkedDayPlanItem({ userId: contributor.id, tripId: trip.id, itemId: created!.id })).status).toBe(
      "deleted",
    );
  });
});
