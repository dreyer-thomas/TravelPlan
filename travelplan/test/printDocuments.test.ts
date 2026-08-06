import { describe, expect, it } from "vitest";
import {
  PRINT_MAX_CHARS,
  collectTimelineDocuments,
  getPrintEntryLabel,
  truncateText,
} from "@/lib/trips/printDocuments";
import type { TripDayPrintPayload } from "@/lib/repositories/tripRepo";

/**
 * Story 9.2. The module both halves of the story import, tested at unit level.
 *
 * It is tested here and not only through the two surfaces because it is the *shared* definition: through
 * the component you can only see what the sheet does with the list, and through the route only what the
 * packet does. The property that matters - that there is one traversal and one label rule, and that they
 * order and name things a particular way - is a property of this module.
 */

type TimelineEntry = TripDayPrintPayload["timeline"][number];
type PrintStay = Extract<TimelineEntry, { kind: "currentStay" }>["stay"];
type PrintItem = Extract<TimelineEntry, { kind: "planItem" }>["item"];
type PrintDocument = PrintItem["documents"][number];

const doc = (overrides: Partial<PrintDocument> = {}): PrintDocument => ({
  id: "doc-1",
  documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/doc-1.jpg",
  fileName: "Ticket.jpg",
  sortOrder: 0,
  ...overrides,
});

const stay = (overrides: Partial<PrintStay> = {}): PrintStay => ({
  id: "stay-1",
  name: "Grand Hotel",
  notes: null,
  status: "booked",
  costCents: null,
  link: null,
  checkInTime: null,
  checkOutTime: null,
  location: null,
  images: [],
  documents: [],
  ...overrides,
});

const item = (overrides: Partial<PrintItem> = {}): PrintItem => ({
  id: "item-1",
  title: "Museum",
  fromTime: null,
  toTime: null,
  contentJson: '{"type":"doc","content":[]}',
  costCents: null,
  linkUrl: null,
  location: null,
  images: [],
  documents: [],
  ...overrides,
});

const segment = (): Extract<TimelineEntry, { kind: "travelSegment" }>["segment"] => ({
  id: "seg-1",
  fromItemType: "dayPlanItem",
  fromItemId: "item-1",
  toItemType: "accommodation",
  toItemId: "stay-1",
  transportType: "car",
  durationMinutes: 20,
  distanceKm: 5,
  linkUrl: null,
});

const planTextOf = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("getPrintEntryLabel", () => {
  it("names a stay by its own name, for both stay kinds", () => {
    expect(getPrintEntryLabel({ kind: "previousStay", stay: stay({ name: "Airport Inn" }) }, 0)).toBe("Airport Inn");
    expect(getPrintEntryLabel({ kind: "currentStay", stay: stay({ name: "Hotel Roma" }) }, 3)).toBe("Hotel Roma");
  });

  it("truncates an over-long stay name, because the packet's label page lays out from a fixed height", () => {
    // `Accommodation.name` has no `.max()` in its schema and no limit in Prisma. The packet's label page
    // subtracts each drawn line from a fixed page height, so a name of a few hundred characters pushes the
    // file name and AC5's "could not be included" sentence below y = 0, where they are drawn and invisible.
    // Without the truncation this returns the whole 1,500 characters.
    const long = "Grand Hotel ".repeat(125); // 1,500 characters
    const label = getPrintEntryLabel({ kind: "currentStay", stay: stay({ name: long }) }, 0);
    expect(label.length).toBeLessThan(long.length);
    expect(label.length).toBeLessThanOrEqual(301); // PRINT_MAX_CHARS plus the ellipsis
    expect(label.endsWith("…")).toBe(true);
  });

  it("prefers an explicit plan item title, trimmed", () => {
    expect(getPrintEntryLabel({ kind: "planItem", item: item({ title: "  City Walk  " }) }, 0)).toBe("City Walk");
  });

  it("falls back to the item's own body text when there is no title", () => {
    const entry: TimelineEntry = {
      kind: "planItem",
      item: item({ title: null, contentJson: planTextOf("Breakfast at the market hall") }),
    };
    expect(getPrintEntryLabel(entry, 0)).toBe("Breakfast at the market hall");
  });

  it("truncates the body-text fallback at the sheet's own limit", () => {
    const long = "x".repeat(PRINT_MAX_CHARS + 50);
    const label = getPrintEntryLabel({ kind: "planItem", item: item({ title: null, contentJson: planTextOf(long) }) }, 0);

    expect(label).toBe(truncateText(long));
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBe(PRINT_MAX_CHARS + 1);
  });

  it("falls back to the position in the timeline when there is neither a title nor body text", () => {
    // The *timeline* index, segments included - the number the itinerary card prints. A per-plan-item
    // counter would name the card "Plan item 1" and the document page "Plan item 3" on the same day.
    const entry: TimelineEntry = { kind: "planItem", item: item({ title: null }) };
    expect(getPrintEntryLabel(entry, 0)).toBe("Plan item 1");
    expect(getPrintEntryLabel(entry, 4)).toBe("Plan item 5");
  });

  it("treats whitespace-only content as absent rather than as a label", () => {
    const entry: TimelineEntry = { kind: "planItem", item: item({ title: "   ", contentJson: planTextOf("   ") }) };
    expect(getPrintEntryLabel(entry, 1)).toBe("Plan item 2");
  });

  it("gives a travel segment no label, because nothing attaches to one", () => {
    expect(getPrintEntryLabel({ kind: "travelSegment", segment: segment() }, 1)).toBe("");
  });
});

describe("collectTimelineDocuments", () => {
  it("returns an empty list for an empty timeline", () => {
    expect(collectTimelineDocuments([])).toEqual([]);
  });

  it("returns an empty list when every entry carries no documents", () => {
    expect(
      collectTimelineDocuments([
        { kind: "previousStay", stay: stay() },
        { kind: "planItem", item: item() },
        { kind: "travelSegment", segment: segment() },
        { kind: "currentStay", stay: stay() },
      ]),
    ).toEqual([]);
  });

  it("flattens all four entry kinds in timeline order, keeping each entry's own document order", () => {
    const collected = collectTimelineDocuments([
      {
        kind: "previousStay",
        stay: stay({ name: "Airport Inn", documents: [doc({ id: "a", fileName: "Voucher.jpg" })] }),
      },
      {
        kind: "planItem",
        item: item({
          id: "first",
          title: "Museum",
          documents: [
            doc({ id: "b", fileName: "Second.jpg", sortOrder: 1 }),
            doc({ id: "c", fileName: "Third.jpg", sortOrder: 2 }),
          ],
        }),
      },
      { kind: "travelSegment", segment: segment() },
      {
        kind: "planItem",
        item: item({ id: "second", title: "Ferry", documents: [doc({ id: "d", fileName: "Ferry.jpg" })] }),
      },
      {
        kind: "currentStay",
        stay: stay({ id: "stay-2", name: "Hotel Roma", documents: [doc({ id: "e", fileName: "Booking.jpg" })] }),
      },
    ]);

    expect(collected.map((entry) => entry.fileName)).toEqual([
      "Voucher.jpg",
      "Second.jpg",
      "Third.jpg",
      "Ferry.jpg",
      "Booking.jpg",
    ]);
    expect(collected.map((entry) => entry.entryLabel)).toEqual([
      "Airport Inn",
      "Museum",
      "Museum",
      "Ferry",
      "Hotel Roma",
    ]);
  });

  it("labels a titleless item's documents with the same positional name its card carries", () => {
    const collected = collectTimelineDocuments([
      { kind: "previousStay", stay: stay() },
      { kind: "travelSegment", segment: segment() },
      { kind: "planItem", item: item({ title: null, documents: [doc()] }) },
    ]);

    expect(collected).toHaveLength(1);
    expect(collected[0].entryLabel).toBe("Plan item 3");
  });

  it("derives isPdf from the document URL and not from a .pdf-suffixed file name", () => {
    const collected = collectTimelineDocuments([
      {
        kind: "planItem",
        item: item({
          documents: [
            // A JPEG whose user-supplied name claims to be a PDF. `fileName` is client input; the URL's
            // extension was generated by the upload route from its own allow-list.
            doc({ id: "liar", documentUrl: "/uploads/trips/t/x/doc-1.jpg", fileName: "Ferry ticket.pdf" }),
            doc({ id: "real", documentUrl: "/uploads/trips/t/x/doc-2.pdf", fileName: "boarding-pass" }),
            // Upper case, because the extension is lowercased before it is compared.
            doc({ id: "shouty", documentUrl: "/uploads/trips/t/x/doc-3.PDF", fileName: "Rail.pdf" }),
            // A format `pdf-lib` cannot embed. Not a PDF either - the packet degrades it, the sheet pages it.
            doc({ id: "webp", documentUrl: "/uploads/trips/t/x/doc-4.webp", fileName: "Screenshot.webp" }),
            // No extension at all: unrecognised, and therefore not a PDF.
            doc({ id: "bare", documentUrl: "/uploads/trips/t/x/doc-5", fileName: "Mystery.pdf" }),
          ],
        }),
      },
    ]);

    expect(collected.map((entry) => entry.isPdf)).toEqual([false, true, true, false, false]);
  });

  it("carries the stored URL through untouched, because it is what resolves to a file on disk", () => {
    const url = "/uploads/trips/t/days/d/accommodations/a/documents/doc-1729-abc.pdf";
    const collected = collectTimelineDocuments([
      { kind: "currentStay", stay: stay({ documents: [doc({ documentUrl: url, fileName: "Hotel.pdf" })] }) },
    ]);

    expect(collected[0].documentUrl).toBe(url);
  });
});
