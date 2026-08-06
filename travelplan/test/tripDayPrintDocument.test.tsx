// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripDayPrintDocument from "@/components/features/trips/TripDayPrintDocument";
import type { TripDayPrintPayload } from "@/lib/repositories/tripRepo";

const EMPTY_MAP = { points: [], missingLocations: [] };

/**
 * Story 9.2 adds `documents: []` to both factories, so every existing case still describes a day with no
 * documents at all - which is exactly what AC3 asks for and what the seventeen assertions below hold.
 *
 * The override types are now the payload's own types rather than hand-written approximations. The old
 * `Partial<... extends { stay: infer S } ? S : never>` resolved to `never`, and the item's spelled-out
 * shape declared `images: []`, so *every* existing call passing a non-empty `images` array or any stay
 * field at all was a type error. That made it impossible to add a `documents` case without adding to the
 * type-error baseline, and it is the reason a required field going missing from either type would not have
 * been caught here.
 */
type PrintStay = Extract<TripDayPrintPayload["timeline"][number], { kind: "currentStay" }>["stay"];
type PrintItem = Extract<TripDayPrintPayload["timeline"][number], { kind: "planItem" }>["item"];
type PrintDocument = PrintItem["documents"][number];

const makeStay = (overrides: Partial<PrintStay> = {}): PrintStay => ({
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

const makeItem = (overrides: Partial<PrintItem> = {}): PrintItem => ({
  id: "item-1",
  title: "Museum Visit",
  fromTime: "09:00",
  toTime: "11:00",
  contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Great place" }] }] }),
  costCents: null,
  linkUrl: null,
  location: null,
  images: [],
  documents: [],
  ...overrides,
});

/**
 * Default URL ends `.jpg`, so the default document is an image. Every PDF case below sets `documentUrl`
 * explicitly - the URL is the discriminator, and a fixture that flipped the kind by changing `fileName`
 * would be asserting the opposite of AC1/AC2's rule.
 */
const makeDocument = (overrides: Partial<PrintDocument> = {}): PrintDocument => ({
  id: "doc-1",
  documentUrl: "/uploads/trips/trip-1/days/day-1/day-plan-items/item-1/documents/doc-1.jpg",
  fileName: "Ticket.jpg",
  sortOrder: 0,
  ...overrides,
});

const makeSegment = () => ({
  id: "seg-1",
  fromItemType: "dayPlanItem" as const,
  fromItemId: "item-1",
  toItemType: "accommodation" as const,
  toItemId: "stay-2",
  transportType: "car" as const,
  durationMinutes: 45,
  distanceKm: 30,
  linkUrl: null,
});

const basePayload = (overrides: Partial<TripDayPrintPayload> = {}): TripDayPrintPayload => ({
  trip: { id: "trip-1", name: "Summer Road Trip" },
  day: { id: "day-1", date: "2026-08-10T00:00:00.000Z", dayIndex: 2, note: null, imageUrl: null },
  timeline: [],
  map: EMPTY_MAP,
  ...overrides,
});

describe("TripDayPrintDocument", () => {
  it("renders trip name and day heading", () => {
    render(<TripDayPrintDocument payload={basePayload()} />);
    expect(screen.getAllByText("Summer Road Trip").length).toBeGreaterThan(0);
    expect(screen.getByText(/Day 2/)).toBeInTheDocument();
  });

  it("renders timeline in chronological order: previousStay → planItem → travelSegment → currentStay", () => {
    const payload = basePayload({
      timeline: [
        { kind: "previousStay", stay: makeStay({ id: "prev", name: "Airport Inn" }) },
        { kind: "planItem", item: makeItem({ id: "item-1", title: "City Walk" }) },
        { kind: "travelSegment", segment: makeSegment() },
        { kind: "currentStay", stay: makeStay({ id: "curr", name: "Beach Hotel" }) },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    const entries = screen.getAllByTestId("print-timeline-entry");
    expect(entries).toHaveLength(4);
    expect(entries[0]).toHaveAttribute("data-kind", "previousStay");
    expect(entries[1]).toHaveAttribute("data-kind", "planItem");
    expect(entries[2]).toHaveAttribute("data-kind", "travelSegment");
    expect(entries[3]).toHaveAttribute("data-kind", "currentStay");
  });

  it("renders image thumbnails only for items that have images", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "planItem",
          item: makeItem({
            id: "item-with-img",
            title: "Gallery",
            images: [{ id: "img-1", imageUrl: "/img/gallery.jpg", sortOrder: 0 }],
          }),
        },
        {
          kind: "planItem",
          item: makeItem({ id: "item-no-img", title: "Walk" }),
        },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    const thumbnails = screen.getAllByTestId("print-thumbnail");
    expect(thumbnails).toHaveLength(1);
    expect(thumbnails[0]).toHaveAttribute("src", "/img/gallery.jpg");
  });

  it("does not leave empty image blocks for items without images", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-no-img", title: "Plain activity" }) },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.queryByTestId("print-thumbnail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("print-image-strip")).not.toBeInTheDocument();
  });

  it("renders the map section with a navigation link when map points are present", () => {
    const payload = basePayload({
      map: {
        points: [
          { id: "stay-1", label: "Hotel", kind: "currentStay", position: [48.1, 11.5], order: 0 },
          { id: "item-1", label: "Museum", kind: "planItem", position: [48.2, 11.6], order: 1 },
        ],
        missingLocations: [],
      },
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.getByTestId("print-map-section")).toBeInTheDocument();
    expect(screen.queryByTestId("print-map-img")).not.toBeInTheDocument();
  });

  it("renders a Google Maps navigation link when map points are present", () => {
    const payload = basePayload({
      map: {
        points: [
          { id: "stay-1", label: "Hotel", kind: "currentStay", position: [48.1, 11.5], order: 0 },
          { id: "item-1", label: "Museum", kind: "planItem", position: [48.2, 11.6], order: 1 },
        ],
        missingLocations: [],
      },
    });

    render(<TripDayPrintDocument payload={payload} />);

    const mapLink = screen.getByTestId("print-map-link");
    expect(mapLink).toBeInTheDocument();
    const href = mapLink.getAttribute("href")!;
    expect(href).toContain("google.com/maps/dir");
    expect(href.indexOf("48.100000")).toBeLessThan(href.indexOf("48.200000"));
  });

  it("falls back to text-only itinerary when no map points are present", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-1", title: "Sightseeing" }) },
      ],
      map: EMPTY_MAP,
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.queryByTestId("print-map-section")).not.toBeInTheDocument();
    expect(screen.getByText("Sightseeing")).toBeInTheDocument();
  });

  it("renders travel segment transport type and duration compactly", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "travelSegment",
          segment: { ...makeSegment(), transportType: "car", durationMinutes: 45, distanceKm: 30 },
        },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    const allEntries = screen.getAllByTestId("print-timeline-entry");
    const segEntry = allEntries.find((el) => el.getAttribute("data-kind") === "travelSegment");
    expect(segEntry).toBeInTheDocument();
    expect(screen.getByText(/45/)).toBeInTheDocument();
  });

  it("shows from and to location names derived from adjacent timeline entries", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-a", title: "City Museum" }) },
        { kind: "travelSegment", segment: makeSegment() },
        { kind: "currentStay", stay: makeStay({ id: "stay-b", name: "Harbor Hotel" }) },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    const routeLabel = screen.getByTestId("print-segment-route");
    expect(routeLabel).toBeInTheDocument();
    expect(routeLabel).toHaveTextContent("City Museum");
    expect(routeLabel).toHaveTextContent("Harbor Hotel");
    expect(routeLabel).toHaveTextContent("→");
  });

  it("omits route label when adjacent entries have no usable names", () => {
    const payload = basePayload({
      timeline: [
        { kind: "travelSegment", segment: makeSegment() },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.queryByTestId("print-segment-route")).not.toBeInTheDocument();
  });

  it("renders the full timeline even when all stays and items have no images or locations", () => {
    const payload = basePayload({
      timeline: [
        { kind: "previousStay", stay: makeStay({ id: "prev", name: "Simple Hotel", images: [], location: null }) },
        { kind: "planItem", item: makeItem({ id: "item-1", title: "Walk", images: [], location: null }) },
        { kind: "currentStay", stay: makeStay({ id: "curr", name: "Motel", images: [], location: null }) },
      ],
      map: EMPTY_MAP,
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.getByText("Simple Hotel")).toBeInTheDocument();
    expect(screen.getByText("Walk")).toBeInTheDocument();
    expect(screen.getByText("Motel")).toBeInTheDocument();
  });

  it("shows toTime even when fromTime is null", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-1", title: "Closing time", fromTime: null, toTime: "18:00" }) },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.getByText("18:00")).toBeInTheDocument();
  });

  it("shows a positional fallback label when plan item has no title and empty content", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-1", title: null, contentJson: '{"type":"doc","content":[]}' }) },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.getByText(/Plan item/i)).toBeInTheDocument();
  });

  it("does not render '0 km' for zero-distance car segments", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "travelSegment",
          segment: { ...makeSegment(), transportType: "car", durationMinutes: 5, distanceKm: 0 },
        },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.queryByText(/0 km/)).not.toBeInTheDocument();
  });

  it("shows distance for non-car transport types when distanceKm is populated", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "travelSegment",
          segment: { ...makeSegment(), transportType: "flight", durationMinutes: 90, distanceKm: 450 },
        },
      ],
    });

    render(<TripDayPrintDocument payload={payload} />);

    expect(screen.getByText(/450 km/)).toBeInTheDocument();
  });

  /**
   * Story 9.2, AC1-AC3.
   *
   * **Nothing here asserts a height, a page break or any other computed layout value.** jsdom resolves
   * `height` to `""` for every element and applies no `@media print` rule at all, so an assertion about
   * either passes whether the code is right, wrong or absent - the defect Story 6.26's review found
   * masquerading as proof. What is testable here is which blocks exist, what they say, and in what order;
   * the page geometry is the browser verification pass's job.
   */
  describe("story 9.2 document pages and PDF appendix", () => {
    it("renders one captioned page per image document, in timeline order across entry kinds", () => {
      const payload = basePayload({
        timeline: [
          {
            kind: "previousStay",
            stay: makeStay({
              id: "prev",
              name: "Airport Inn",
              documents: [
                makeDocument({
                  id: "doc-stay",
                  documentUrl: "/uploads/trips/trip-1/days/day-1/accommodations/prev/documents/doc-a.png",
                  fileName: "Hotel voucher.png",
                }),
              ],
            }),
          },
          {
            kind: "planItem",
            item: makeItem({
              id: "item-1",
              title: "Museum",
              documents: [
                makeDocument({ id: "doc-item-1", fileName: "Entry ticket.jpg", sortOrder: 0 }),
                makeDocument({
                  id: "doc-item-2",
                  documentUrl: "/uploads/trips/trip-1/days/day-1/day-plan-items/item-1/documents/doc-2.jpeg",
                  fileName: "Audio guide.jpeg",
                  sortOrder: 1,
                }),
              ],
            }),
          },
        ],
      });

      render(<TripDayPrintDocument payload={payload} />);

      const pages = screen.getAllByTestId("print-document-page");
      expect(pages).toHaveLength(3);
      // Timeline order, not per-entry order: the stay's document comes before both of the activity's.
      expect(pages[0]).toHaveTextContent("Airport Inn");
      expect(pages[0]).toHaveTextContent("Hotel voucher.png");
      expect(pages[1]).toHaveTextContent("Museum");
      expect(pages[1]).toHaveTextContent("Entry ticket.jpg");
      expect(pages[2]).toHaveTextContent("Audio guide.jpeg");

      const images = screen.getAllByTestId("print-document-image");
      expect(images.map((image) => image.getAttribute("src"))).toEqual([
        "/uploads/trips/trip-1/days/day-1/accommodations/prev/documents/doc-a.png",
        "/uploads/trips/trip-1/days/day-1/day-plan-items/item-1/documents/doc-1.jpg",
        "/uploads/trips/trip-1/days/day-1/day-plan-items/item-1/documents/doc-2.jpeg",
      ]);
      // An image document is a page, never an appendix entry.
      expect(screen.queryByTestId("print-document-appendix")).not.toBeInTheDocument();
    });

    it("names PDF documents in an appendix that states they are absent, and gives them no page", () => {
      const payload = basePayload({
        timeline: [
          {
            kind: "planItem",
            item: makeItem({
              id: "item-1",
              title: "Flight to Rome",
              documents: [
                makeDocument({
                  id: "doc-pdf",
                  documentUrl: "/uploads/trips/trip-1/days/day-1/day-plan-items/item-1/documents/doc-1.pdf",
                  fileName: "Boarding pass.pdf",
                }),
              ],
            }),
          },
          {
            kind: "currentStay",
            stay: makeStay({
              id: "curr",
              name: "Hotel Roma",
              documents: [
                makeDocument({
                  id: "doc-pdf-2",
                  documentUrl: "/uploads/trips/trip-1/days/day-1/accommodations/curr/documents/doc-2.PDF",
                  fileName: "Booking confirmation.pdf",
                }),
              ],
            }),
          },
        ],
      });

      render(<TripDayPrintDocument payload={payload} />);

      expect(screen.queryByTestId("print-document-page")).not.toBeInTheDocument();

      const items = screen.getAllByTestId("print-document-appendix-item");
      // `.PDF` upper case counts: the extension is lowercased before it is compared.
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("Flight to Rome — Boarding pass.pdf");
      expect(items[1]).toHaveTextContent("Hotel Roma — Booking confirmation.pdf");

      // AC2's whole point: the sheet has to say in print that these files are not in it. Matched on the
      // claim rather than the exact sentence, so a reword stays free and a deletion does not.
      const appendix = screen.getByTestId("print-document-appendix");
      expect(appendix).toHaveTextContent(/not part of this printout/i);
      expect(appendix).toHaveTextContent(/packet/i);
    });

    it("decides PDF from the URL, never from the file name", () => {
      const payload = basePayload({
        timeline: [
          {
            kind: "planItem",
            item: makeItem({
              id: "item-1",
              title: "Ferry",
              documents: [
                // A `.jpg` URL whose user-supplied name claims `.pdf`. `fileName` is client input and may
                // lie; the URL's extension is what the upload route generated from its own allow-list.
                makeDocument({
                  id: "doc-liar",
                  documentUrl: "/uploads/trips/trip-1/days/day-1/day-plan-items/item-1/documents/doc-1.jpg",
                  fileName: "Ferry ticket.pdf",
                }),
              ],
            }),
          },
        ],
      });

      render(<TripDayPrintDocument payload={payload} />);

      expect(screen.getAllByTestId("print-document-page")).toHaveLength(1);
      expect(screen.queryByTestId("print-document-appendix")).not.toBeInTheDocument();
    });

    it("adds neither block when the day has no documents at all", () => {
      const payload = basePayload({
        timeline: [
          { kind: "previousStay", stay: makeStay({ id: "prev", name: "Airport Inn" }) },
          { kind: "planItem", item: makeItem({ id: "item-1", title: "City Walk" }) },
          { kind: "travelSegment", segment: makeSegment() },
          { kind: "currentStay", stay: makeStay({ id: "curr", name: "Beach Hotel" }) },
        ],
      });

      render(<TripDayPrintDocument payload={payload} />);

      expect(screen.queryByTestId("print-document-page")).not.toBeInTheDocument();
      expect(screen.queryByTestId("print-document-image")).not.toBeInTheDocument();
      expect(screen.queryByTestId("print-document-appendix")).not.toBeInTheDocument();
      expect(screen.queryByTestId("print-document-appendix-item")).not.toBeInTheDocument();
    });

    it("labels a document page from the same positional fallback its itinerary card shows", () => {
      const payload = basePayload({
        timeline: [
          { kind: "previousStay", stay: makeStay({ id: "prev", name: "Airport Inn" }) },
          {
            kind: "planItem",
            item: makeItem({
              id: "item-1",
              title: null,
              contentJson: '{"type":"doc","content":[]}',
              documents: [makeDocument({ fileName: "Unnamed ticket.jpg" })],
            }),
          },
        ],
      });

      render(<TripDayPrintDocument payload={payload} />);

      // Index 1 in the timeline, so "Plan item 2" - the card's own number, which is the whole point of
      // sharing `getPrintEntryLabel`: a loose printed page has to name the card it belongs to.
      const card = screen.getAllByTestId("print-timeline-entry").find((entry) => entry.dataset.kind === "planItem");
      expect(card).toHaveTextContent("Plan item 2");
      expect(screen.getByTestId("print-document-page")).toHaveTextContent("Plan item 2");
    });
  });

  describe("onReady callback", () => {
    it("calls onReady after mount when there are no map points", async () => {
      const onReady = vi.fn();
      render(<TripDayPrintDocument payload={basePayload()} onReady={onReady} />);
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    });

    it("waits for a document image to load before firing, so the print dialog does not snapshot a blank page", async () => {
      // `onReady` is what fires `window.print()`, and the dialog captures the page at the moment it opens -
      // a later image load never reaches the preview. The day view renders documents as chips, never as
      // `<img>`, so a document image's bytes are always cold on the first print. Firing on mount therefore
      // prints AC1's full-page ticket blank. Without the wait, onReady is called before the load event.
      const onReady = vi.fn();
      render(
        <TripDayPrintDocument
          payload={basePayload({
            timeline: [
              {
                kind: "planItem",
                item: makeItem({
                  documents: [
                    { id: "d1", documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/doc-1.jpg", fileName: "Ticket.jpg", sortOrder: 1 },
                  ],
                }),
              },
            ],
          })}
          onReady={onReady}
        />,
      );

      const image = screen.getByTestId("print-document-image");
      // jsdom never loads an `<img>`, so `complete` stays false and nothing has fired yet.
      expect(onReady).not.toHaveBeenCalled();

      fireEvent.load(image);
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    });

    it("fires once a document image fails, so a broken document cannot hold the print dialog shut", async () => {
      // The itinerary is still worth printing when a ticket image 404s, so `error` settles the wait exactly
      // as `load` does. Asserting the negative matters here: an implementation that waited only for `load`
      // would leave the user on a page with no print dialog at all.
      const onReady = vi.fn();
      render(
        <TripDayPrintDocument
          payload={basePayload({
            timeline: [
              {
                kind: "planItem",
                item: makeItem({
                  documents: [
                    { id: "d1", documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/doc-1.png", fileName: "Map.png", sortOrder: 1 },
                  ],
                }),
              },
            ],
          })}
          onReady={onReady}
        />,
      );

      expect(onReady).not.toHaveBeenCalled();
      fireEvent.error(screen.getByTestId("print-document-image"));
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    });

    it("gives up after a ceiling scaled by how many images are outstanding, and not before", async () => {
      // The third path through the wait, and the one no assertion covered: an `<img>` that neither loads
      // nor errors, which on an authenticated media route is a stalled connection. Two things are pinned
      // here. That the wait ends at all - without it a stalled ticket leaves the user on a page with no
      // print dialog, worse than the blank page the wait exists to prevent. And that the budget is *per
      // outstanding image*: with one flat 8s for the whole set, six 3 MB tickets share it and the dialog
      // opens over three still-blank pages, silently. Fake timers rather than a real 16s wait.
      vi.useFakeTimers();
      try {
        const onReady = vi.fn();
        render(
          <TripDayPrintDocument
            payload={basePayload({
              timeline: [
                {
                  kind: "planItem",
                  item: makeItem({
                    documents: [
                      makeDocument({ id: "d1", documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/a.jpg" }),
                      makeDocument({ id: "d2", documentUrl: "/uploads/trips/t/days/d/day-plan-items/i/documents/b.jpg" }),
                    ],
                  }),
                },
              ],
            })}
            onReady={onReady}
          />,
        );

        // jsdom loads no `<img>`, so both document images are outstanding and nothing else on this fixture
        // renders one: the budget is two images' worth.
        expect(screen.getAllByTestId("print-document-image")).toHaveLength(2);
        await act(async () => {
          vi.advanceTimersByTime(8000);
        });
        expect(onReady).not.toHaveBeenCalled();

        await act(async () => {
          vi.advanceTimersByTime(8000);
        });
        expect(onReady).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("calls onReady after mount when map points are present", async () => {
      const onReady = vi.fn();
      const payload = basePayload({
        map: {
          points: [
            { id: "p1", label: "A", kind: "planItem", position: [48.0, 11.0], order: 0 },
            { id: "p2", label: "B", kind: "planItem", position: [48.1, 11.1], order: 1 },
          ],
          missingLocations: [],
        },
      });

      render(<TripDayPrintDocument payload={payload} onReady={onReady} />);
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    });
  });
});
