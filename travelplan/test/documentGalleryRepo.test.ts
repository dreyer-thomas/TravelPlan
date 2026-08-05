import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createAccommodationDocument,
  deleteAccommodationDocument,
  listAccommodationDocuments,
} from "@/lib/repositories/accommodationRepo";
import {
  createDayPlanItemDocument,
  deleteDayPlanItemDocument,
  listDayPlanItemDocuments,
  listDayPlanItemDocumentsForTripDay,
} from "@/lib/repositories/dayPlanItemRepo";
import { MAX_DOCUMENTS_PER_ENTRY } from "@/lib/trips/documentUploads";

const createUser = async (email: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: "hashed",
      role: "OWNER",
    },
  });

const createTripWithDay = async (userId: string) => {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Document Repo Trip",
      startDate: new Date("2026-12-11T00:00:00.000Z"),
      endDate: new Date("2026-12-11T00:00:00.000Z"),
    },
  });

  const day = await prisma.tripDay.create({
    data: {
      tripId: trip.id,
      date: new Date("2026-12-11T00:00:00.000Z"),
      dayIndex: 1,
    },
  });

  return { trip, day };
};

describe("document gallery repositories", () => {
  beforeEach(async () => {
    await prisma.accommodationDocument.deleteMany();
    await prisma.dayPlanItemDocument.deleteMany();
    await prisma.accommodationImage.deleteMany();
    await prisma.dayPlanItemImage.deleteMany();
    await prisma.dayPlanItem.deleteMany();
    await prisma.accommodation.deleteMany();
    await prisma.tripDay.deleteMany();
    await prisma.tripMember.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates/lists/deletes accommodation documents with ownership scope", async () => {
    const owner = await createUser("document-repo-owner@example.com");
    const other = await createUser("document-repo-other@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Scoped Stay" },
    });

    const first = await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/stay-doc-1.pdf",
      fileName: "Booking.pdf",
    });
    const second = await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/stay-doc-2.pdf",
      fileName: "Invoice.pdf",
    });

    expect(first.status).toBe("created");
    // Insertion order, appended: `(last?.sortOrder ?? 0) + 1`, the same arithmetic the galleries use.
    expect(first.status === "created" && first.document.sortOrder).toBe(1);
    expect(second.status === "created" && second.document.sortOrder).toBe(2);
    expect(first.status === "created" && first.document.fileName).toBe("Booking.pdf");

    const unauthorizedCreate = await createAccommodationDocument({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/nope.pdf",
      fileName: "Nope.pdf",
    });
    expect(unauthorizedCreate.status).toBe("not_found");

    const listed = await listAccommodationDocuments({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
    });
    expect(listed?.map((entry) => entry.fileName)).toEqual(["Booking.pdf", "Invoice.pdf"]);

    const unauthorizedList = await listAccommodationDocuments({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
    });
    expect(unauthorizedList).toBeNull();

    const unauthorizedDelete = await deleteAccommodationDocument({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentId: first.status === "created" ? first.document.id : "",
    });
    expect(unauthorizedDelete.status).toBe("not_found");

    const deleted = await deleteAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentId: second.status === "created" ? second.document.id : "",
    });
    expect(deleted.status).toBe("deleted");

    // A second delete of the same id is `missing`, not `not_found` - the entry is still there.
    const again = await deleteAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentId: second.status === "created" ? second.document.id : "",
    });
    expect(again.status).toBe("missing");
  });

  /**
   * AC7's read half. The write gate is owner-only, mirroring the image routes; the read gate is not,
   * because a contributor who can see the day must be able to see what is attached to it. Copying the
   * write scope onto the read - the easy mistake, since they sit next to each other - would hide
   * every document from every member of a shared trip while leaving the owner's own view perfect.
   */
  it("admits a contributor on the read and refuses one on the write", async () => {
    const owner = await createUser("document-repo-scope-owner@example.com");
    const contributor = await createUser("document-repo-contributor@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    await prisma.tripMember.create({
      data: { tripId: trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
    });
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Shared Stay" },
    });

    await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/shared.pdf",
      fileName: "Shared.pdf",
    });

    const contributorRead = await listAccommodationDocuments({
      userId: contributor.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
    });
    expect(contributorRead?.map((entry) => entry.fileName)).toEqual(["Shared.pdf"]);

    const contributorWrite = await createAccommodationDocument({
      userId: contributor.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/contributor.pdf",
      fileName: "Contributor.pdf",
    });
    expect(contributorWrite.status).toBe("not_found");
  });

  /**
   * The cap, enforced here rather than in the dialog. A cap the client alone enforces is not a cap:
   * the route writes the file before it calls this, so `limit_reached` has to be distinguishable from
   * `not_found` for the file to be rolled back and for the user to be told the actual reason.
   */
  it("refuses the eleventh document on one entry", async () => {
    const owner = await createUser("document-repo-cap@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Full Stay" },
    });

    for (let index = 0; index < MAX_DOCUMENTS_PER_ENTRY; index += 1) {
      const created = await createAccommodationDocument({
        userId: owner.id,
        tripId: trip.id,
        tripDayId: day.id,
        accommodationId: accommodation.id,
        documentUrl: `/uploads/cap-${index}.pdf`,
        fileName: `Cap ${index}.pdf`,
      });
      expect(created.status, `document ${index}`).toBe("created");
    }

    const eleventh = await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/cap-overflow.pdf",
      fileName: "Overflow.pdf",
    });
    expect(eleventh.status).toBe("limit_reached");
    expect(await prisma.accommodationDocument.count()).toBe(MAX_DOCUMENTS_PER_ENTRY);

    // And the cap is per entry, not per trip: a second stay on the same day starts from zero.
    const secondDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-12T00:00:00.000Z"), dayIndex: 2 },
    });
    const secondAccommodation = await prisma.accommodation.create({
      data: { tripDayId: secondDay.id, name: "Empty Stay" },
    });
    const onOther = await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: secondDay.id,
      accommodationId: secondAccommodation.id,
      documentUrl: "/uploads/other-stay.pdf",
      fileName: "Other.pdf",
    });
    expect(onOther.status).toBe("created");

    // Deleting one makes room again, and the next `sortOrder` continues past the gap rather than
    // reusing it - the unique index is on `(accommodationId, sortOrder)`, so reuse would collide with
    // nothing here but would silently reorder the chips.
    const rows = await listAccommodationDocuments({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
    });
    await deleteAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentId: rows![0].id,
    });
    const afterDelete = await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/cap-refill.pdf",
      fileName: "Refill.pdf",
    });
    expect(afterDelete.status).toBe("created");
    expect(afterDelete.status === "created" && afterDelete.document.sortOrder).toBe(
      MAX_DOCUMENTS_PER_ENTRY + 1,
    );
  });

  it("creates/lists/deletes day plan item documents with ownership scope", async () => {
    const owner = await createUser("document-plan-repo-owner@example.com");
    const other = await createUser("document-plan-repo-other@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Document stop" }] }],
        }),
      },
    });

    const first = await createDayPlanItemDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      documentUrl: "/uploads/plan-doc-1.pdf",
      fileName: "Museum ticket.pdf",
    });
    const second = await createDayPlanItemDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      documentUrl: "/uploads/plan-doc-2.pdf",
      fileName: "Audio guide.pdf",
    });

    expect(first.status === "created" && first.document.sortOrder).toBe(1);
    expect(second.status === "created" && second.document.sortOrder).toBe(2);

    const unauthorizedList = await listDayPlanItemDocuments({
      userId: other.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
    });
    expect(unauthorizedList).toBeNull();

    const listed = await listDayPlanItemDocuments({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
    });
    expect(listed?.map((entry) => entry.fileName)).toEqual(["Museum ticket.pdf", "Audio guide.pdf"]);

    const deleted = await deleteDayPlanItemDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      documentId: first.status === "created" ? first.document.id : "",
    });
    expect(deleted.status).toBe("deleted");
  });

  /**
   * The day-wide read the timeline uses: one request for every activity on the day, rather than one
   * per card. Two items, so the `dayPlanItemId` ordering is actually exercised.
   */
  it("lists every activity's documents for one trip day in a single call", async () => {
    const owner = await createUser("document-plan-repo-day@example.com");
    const stranger = await createUser("document-plan-repo-day-stranger@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    const contentJson = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Stop" }] }],
    });
    const itemA = await prisma.dayPlanItem.create({ data: { tripDayId: day.id, contentJson } });
    const itemB = await prisma.dayPlanItem.create({ data: { tripDayId: day.id, contentJson } });

    // A second day with its own document, so "for this trip day" is a real filter rather than
    // "everything in the database".
    const otherDay = await prisma.tripDay.create({
      data: { tripId: trip.id, date: new Date("2026-12-13T00:00:00.000Z"), dayIndex: 2 },
    });
    const otherItem = await prisma.dayPlanItem.create({ data: { tripDayId: otherDay.id, contentJson } });

    for (const [item, tripDayId, fileName] of [
      [itemA, day.id, "A1.pdf"],
      [itemA, day.id, "A2.pdf"],
      [itemB, day.id, "B1.pdf"],
      [otherItem, otherDay.id, "Other.pdf"],
    ] as const) {
      await createDayPlanItemDocument({
        userId: owner.id,
        tripId: trip.id,
        tripDayId,
        dayPlanItemId: item.id,
        documentUrl: `/uploads/${fileName}`,
        fileName,
      });
    }

    const dayWide = await listDayPlanItemDocumentsForTripDay({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
    });
    expect(dayWide?.map((entry) => entry.fileName).sort()).toEqual(["A1.pdf", "A2.pdf", "B1.pdf"]);
    // Grouped by item, then by insertion order within an item, which is what the timeline renders.
    const forItemA = dayWide!.filter((entry) => entry.dayPlanItemId === itemA.id);
    expect(forItemA.map((entry) => entry.fileName)).toEqual(["A1.pdf", "A2.pdf"]);

    const refused = await listDayPlanItemDocumentsForTripDay({
      userId: stranger.id,
      tripId: trip.id,
      tripDayId: day.id,
    });
    expect(refused).toBeNull();
  });

  /**
   * The cascade, which is the only thing standing between deleting a stay and leaving its documents
   * behind as unreachable rows. It is declared in `schema.prisma` and enforced by the migration's
   * `ON DELETE CASCADE`; nothing in the application code deletes these rows explicitly, so if the
   * foreign key were ever written without it no other test in the suite would notice.
   */
  it("removes documents when the parent entry goes", async () => {
    const owner = await createUser("document-repo-cascade@example.com");
    const { trip, day } = await createTripWithDay(owner.id);
    const accommodation = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Doomed Stay" },
    });
    const item = await prisma.dayPlanItem.create({
      data: {
        tripDayId: day.id,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Doomed stop" }] }],
        }),
      },
    });

    await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: accommodation.id,
      documentUrl: "/uploads/doomed-stay.pdf",
      fileName: "Stay.pdf",
    });
    await createDayPlanItemDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      dayPlanItemId: item.id,
      documentUrl: "/uploads/doomed-item.pdf",
      fileName: "Item.pdf",
    });
    expect(await prisma.accommodationDocument.count()).toBe(1);
    expect(await prisma.dayPlanItemDocument.count()).toBe(1);

    await prisma.accommodation.delete({ where: { id: accommodation.id } });
    expect(await prisma.accommodationDocument.count()).toBe(0);

    await prisma.dayPlanItem.delete({ where: { id: item.id } });
    expect(await prisma.dayPlanItemDocument.count()).toBe(0);

    // And the day above them, which cascades through both parents at once.
    const survivor = await prisma.accommodation.create({
      data: { tripDayId: day.id, name: "Also Doomed" },
    });
    await createAccommodationDocument({
      userId: owner.id,
      tripId: trip.id,
      tripDayId: day.id,
      accommodationId: survivor.id,
      documentUrl: "/uploads/via-day.pdf",
      fileName: "ViaDay.pdf",
    });
    await prisma.tripDay.delete({ where: { id: day.id } });
    expect(await prisma.accommodationDocument.count()).toBe(0);
  });
});
