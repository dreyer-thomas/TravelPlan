// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripDayPrintDocument from "@/components/features/trips/TripDayPrintDocument";
import type { Language } from "@/i18n";
import type { TripDayPrintPayload } from "@/lib/repositories/tripRepo";
import { renderWithProviders } from "./helpers/renderWithProviders";

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
  // Story 10.2. Null by default, so every existing case still describes an entry with no cost and no
  // receipt - which is what the assertions written before this story hold.
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
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
  // Story 10.2. See `makeStay` above.
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
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

/**
 * DW-230. The sheet is a `useI18n` consumer now, so it needs a provider - `useI18n` throws without one.
 *
 * Every existing case goes through this at `language = "en"` and keeps its expectation exactly as it was
 * written: the English rendered output has to stay byte-identical, and these thirty-three assertions are
 * what says so. A failure here on an *expectation* rather than on provider plumbing means the English
 * output moved, which is a bug in the code and never a reason to edit the assertion.
 *
 * The provider tree itself comes from `helpers/renderWithProviders`, which twenty-odd suites already share,
 * rather than being written a second time here. Its own docblock is the reason: it wraps in `ThemeProvider`
 * as well as `I18nProvider` and says the theme wrapper "is not optional", and keeping the tree in one place
 * is what makes adding the next provider a one-line change instead of a sweep. A local copy that named only
 * the provider this sheet happens to need today is precisely how a suite ends up rendering under a
 * different tree from the app. This wrapper stays only because a positional `language` reads better than an
 * options bag across ~40 call sites.
 */
const renderSheet = (
  props: ComponentProps<typeof TripDayPrintDocument>,
  language: Language = "en",
) => renderWithProviders(<TripDayPrintDocument {...props} />, { language });

describe("TripDayPrintDocument", () => {
  it("renders trip name and day heading", () => {
    renderSheet({ payload: basePayload() });
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

    renderSheet({ payload });

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

    renderSheet({ payload });

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

    renderSheet({ payload });

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

    renderSheet({ payload });

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

    renderSheet({ payload });

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

    renderSheet({ payload });

    expect(screen.queryByTestId("print-map-section")).not.toBeInTheDocument();
    expect(screen.getByText("Sightseeing")).toBeInTheDocument();
  });

  /**
   * DW-1. `buildGoogleMapsUrl` joins only the points it has, so a stop with no coordinates is silently
   * skipped and the drawn route runs straight past it. On screen the day view lists those stops by name and
   * the reader can go fix them; on paper the sheet is the end of the line, so the count is the only thing
   * that stops the printed route from reading as the whole day.
   *
   * The copy names the *route*, not the sheet, and these assertions pin that: a printed page carrying a URL
   * and no map "shows" nothing at all, so "not shown" alone would leave the reader guessing what the number
   * refers to. Scoped to stops with no coordinates - `buildGoogleMapsUrl`'s own 9-stop sampling drops placed
   * stops too, which is a separate and milder omission and deliberately not folded into this count.
   */
  describe("missing-location note", () => {
    const twoPoints = [
      { id: "stay-1", label: "Hotel", kind: "currentStay" as const, position: [48.1, 11.5] as [number, number], order: 0 },
      { id: "item-1", label: "Museum", kind: "planItem" as const, position: [48.2, 11.6] as [number, number], order: 1 },
    ];

    it("renders no missing-location note when every stop has coordinates", () => {
      const payload = basePayload({ map: { points: twoPoints, missingLocations: [] } });

      renderSheet({ payload });

      expect(screen.getByTestId("print-map-section")).toBeInTheDocument();
      expect(screen.queryByTestId("print-map-missing")).not.toBeInTheDocument();
    });

    it("states how many stops the drawn route skipped, pluralised, beside the navigation link", () => {
      const payload = basePayload({
        map: {
          points: twoPoints,
          missingLocations: [
            { id: "item-2", label: "Market", kind: "planItem", location: null },
            { id: "item-3", label: "Viewpoint", kind: "planItem", location: null },
          ],
        },
      });

      renderSheet({ payload });

      const note = screen.getByTestId("print-map-missing");
      expect(note).toHaveTextContent("Route omits 2 stops with no saved location");
      // Inside the map block, not loose on the sheet: the note only means anything next to the link whose
      // route it is qualifying.
      expect(screen.getByTestId("print-map-section")).toContainElement(note);
    });

    it("uses the singular when exactly one stop is missing coordinates", () => {
      const payload = basePayload({
        map: {
          points: twoPoints,
          missingLocations: [{ id: "item-2", label: "Market", kind: "planItem", location: null }],
        },
      });

      renderSheet({ payload });

      expect(screen.getByTestId("print-map-missing")).toHaveTextContent(
        "Route omits 1 stop with no saved location",
      );
    });

    it("renders no note when there is no route to qualify, even with stops missing coordinates", () => {
      // One point draws no line - `buildGoogleMapsUrl` returns null below two - so the whole map section is
      // absent and nothing on the sheet claims a route at all. A note here would be a warning about a
      // drawing that was never made.
      const payload = basePayload({
        map: {
          points: [twoPoints[0]],
          missingLocations: [
            { id: "item-2", label: "Market", kind: "planItem", location: null },
            { id: "item-3", label: "Viewpoint", kind: "planItem", location: null },
          ],
        },
      });

      renderSheet({ payload });

      expect(screen.queryByTestId("print-map-section")).not.toBeInTheDocument();
      expect(screen.queryByTestId("print-map-missing")).not.toBeInTheDocument();
    });
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

    renderSheet({ payload });

    const allEntries = screen.getAllByTestId("print-timeline-entry");
    const segEntry = allEntries.find((el) => el.getAttribute("data-kind") === "travelSegment");
    expect(segEntry).toBeInTheDocument();
    // The whole composed label, not just `/45/`: car is the one mode a distance is expected on, and a
    // duration-only assertion would still pass if `transportTypeAllowsDistance` ever stopped allowing it.
    expect(segEntry).toHaveTextContent("Car · 45m · 30 km");
  });

  it("shows from and to location names derived from adjacent timeline entries", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-a", title: "City Museum" }) },
        { kind: "travelSegment", segment: makeSegment() },
        { kind: "currentStay", stay: makeStay({ id: "stay-b", name: "Harbor Hotel" }) },
      ],
    });

    renderSheet({ payload });

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

    renderSheet({ payload });

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

    renderSheet({ payload });

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

    renderSheet({ payload });

    expect(screen.getByText("18:00")).toBeInTheDocument();
  });

  it("shows a positional fallback label when plan item has no title and empty content", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-1", title: null, contentJson: '{"type":"doc","content":[]}' }) },
      ],
    });

    renderSheet({ payload });

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

    renderSheet({ payload });

    expect(screen.queryByText(/0 km/)).not.toBeInTheDocument();
  });

  /**
   * DW-109. `transportTypeAllowsDistance` is the single Story 6.16 / AC6 rule - car, walking, cycling -
   * and the day view already labels its rows through it. The sheet used to print any stored `distanceKm`
   * regardless of mode, so the same flight row read `Flight · 5h` on screen and `Flight · 5h · 800 km` on
   * paper. The stored value is not hypothetical: `tripImportSchemas.ts` does not enforce the coupling, so
   * an imported backup can restore a distance on a mode the form would never have accepted one for.
   *
   * These cases assert the *rendered label*, not the rule itself - the rule's own boundary is pinned by
   * `travelSegmentSchemas.test.ts` ("still rejects a distance on ship and flight"). What is pinned here is
   * that this sheet asks it at all.
   */
  it("shows distance for cycling, a mode the shared rule allows to carry one", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "travelSegment",
          segment: { ...makeSegment(), transportType: "cycling", durationMinutes: 90, distanceKm: 450 },
        },
      ],
    });

    renderSheet({ payload });

    expect(screen.getByText(/450 km/)).toBeInTheDocument();
  });

  it("shows distance for a short walking leg", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "travelSegment",
          segment: { ...makeSegment(), transportType: "walking", durationMinutes: 25, distanceKm: 2 },
        },
      ],
    });

    renderSheet({ payload });

    expect(screen.getByText(/Walking · 25m · 2 km/)).toBeInTheDocument();
  });

  it("hides an imported flight's distance, which the day view already refuses to show", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "travelSegment",
          segment: { ...makeSegment(), transportType: "flight", durationMinutes: 300, distanceKm: 800 },
        },
      ],
    });

    renderSheet({ payload });

    // Asserting on the composed label rather than on a bare /km/ query: the sheet's other copy is free to
    // grow a "km" of its own, and `queryBy*` throws on more than one match rather than failing an
    // assertion. `toHaveTextContent` on the segment's own label says exactly what is meant - this row
    // carries a mode and a duration and nothing else.
    const segment = screen
      .getAllByTestId("print-timeline-entry")
      .find((entry) => entry.dataset.kind === "travelSegment");
    expect(segment).toHaveTextContent("Flight · 5h");
    expect(segment).not.toHaveTextContent("800 km");
    expect(segment).not.toHaveTextContent("km");
  });

  it("hides a ship leg's distance for the same reason", () => {
    const payload = basePayload({
      timeline: [
        {
          kind: "travelSegment",
          segment: { ...makeSegment(), transportType: "ship", durationMinutes: 180, distanceKm: 120 },
        },
      ],
    });

    renderSheet({ payload });

    expect(screen.getByText(/Ship · 3h/)).toBeInTheDocument();
    expect(screen.queryByText(/120 km/)).not.toBeInTheDocument();
  });

  /**
   * DW-2. The two labellers on this sheet answer different questions and must keep disagreeing here.
   *
   * `getEntryDisplayName` (route label) takes the plan item's *title* and nothing else, so an untitled item
   * yields null and the `from → to` line is dropped entirely rather than printed as `— → —`, which would
   * claim a journey between two unnamed nowheres. `getPrintEntryLabel` (card and document page) falls back
   * past the empty body text to a positional `Plan item N`, because a card with no heading at all is worse
   * than a numbered one and a loose document page needs something to be matched back to.
   *
   * Nothing pins that today, so a well-meant "share the labeller" refactor would silently start printing
   * `Plan item 1 → Plan item 3` as if those were places.
   */
  it("drops the route label between two untitled empty plan items while their cards keep the positional fallback", () => {
    const payload = basePayload({
      timeline: [
        { kind: "planItem", item: makeItem({ id: "item-a", title: null, contentJson: '{"type":"doc","content":[]}' }) },
        { kind: "travelSegment", segment: makeSegment() },
        { kind: "planItem", item: makeItem({ id: "item-b", title: null, contentJson: '{"type":"doc","content":[]}' }) },
      ],
    });

    renderSheet({ payload });

    expect(screen.queryByTestId("print-segment-route")).not.toBeInTheDocument();

    const cards = screen.getAllByTestId("print-timeline-entry").filter((entry) => entry.dataset.kind === "planItem");
    expect(cards).toHaveLength(2);
    // Timeline indices 0 and 2, so "Plan item 1" and "Plan item 3" - the segment is counted.
    expect(cards[0]).toHaveTextContent("Plan item 1");
    expect(cards[1]).toHaveTextContent("Plan item 3");
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

      renderSheet({ payload });

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

      renderSheet({ payload });

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

      renderSheet({ payload });

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

      renderSheet({ payload });

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

      renderSheet({ payload });

      // Index 1 in the timeline, so "Plan item 2" - the card's own number, which is the whole point of
      // sharing `getPrintEntryLabel`: a loose printed page has to name the card it belongs to.
      const card = screen.getAllByTestId("print-timeline-entry").find((entry) => entry.dataset.kind === "planItem");
      expect(card).toHaveTextContent("Plan item 2");
      expect(screen.getByTestId("print-document-page")).toHaveTextContent("Plan item 2");
    });
  });

  /**
   * DW-230. The same sheet on the German dictionary.
   *
   * The complaint DW-230 records is that a user who reaches this page through a fully translated UI gets
   * an English sheet, so what is pinned here is the *rendered* German - not that the keys exist, which
   * `i18nDictionaries.test.ts` answers, and not that `t` was called, which any wiring satisfies.
   *
   * These are additional cases, never relaxations of the English ones above: every assertion in this file
   * outside this block still asserts the exact English string it always did.
   *
   * Nothing here asserts a height, a page break or any computed layout value, for the reason the 9.2 block
   * above gives - jsdom resolves `height` to `""` and applies no `@media print` rule, so such an assertion
   * would pass whether the code were right, wrong or absent.
   */
  describe("DW-230 localisation", () => {
    it("renders the day heading and the date in German", () => {
      renderSheet({ payload: basePayload() }, "de");

      expect(screen.getByText("Tag 2")).toBeInTheDocument();
      // The same `2026-08-10` the English cases format as `August 10, 2026`. This is the whole of what
      // `Intl.DateTimeFormat(INTL_LOCALES[language], …)` changed, and the reason a hardcoded `en-US`
      // survived every other localisation pass: a date is still a date, so it never looks untranslated.
      expect(screen.getAllByText("10. August 2026").length).toBeGreaterThan(0);
    });

    it("keeps the user's own day note beside the translated heading", () => {
      // The note is appended after a colon rather than interpolated, so this pins that a German heading
      // still carries the traveller's untranslated text and in the right order.
      const payload = basePayload({
        day: { id: "day-1", date: "2026-08-10T00:00:00.000Z", dayIndex: 2, note: "Anreise", imageUrl: null },
      });

      renderSheet({ payload }, "de");

      expect(screen.getByText("Tag 2: Anreise")).toBeInTheDocument();
    });

    it("renders both section captions and the empty state in German", () => {
      const payload = basePayload({
        map: {
          points: [
            { id: "stay-1", label: "Hotel", kind: "currentStay", position: [48.1, 11.5], order: 0 },
            { id: "item-1", label: "Museum", kind: "planItem", position: [48.2, 11.6], order: 1 },
          ],
          missingLocations: [{ id: "item-2", label: "Markt", kind: "planItem", location: null }],
        },
      });

      renderSheet({ payload }, "de");

      expect(screen.getByText("Tagesroute")).toBeInTheDocument();
      expect(screen.getByText("Reiseverlauf")).toBeInTheDocument();
      expect(screen.getByTestId("print-map-link")).toHaveTextContent("In Google Maps navigieren");
      expect(screen.getByTestId("print-map-missing")).toHaveTextContent(
        "Die Route lässt 1 Station ohne gespeicherten Ort aus",
      );
      expect(screen.getByText("Für diesen Tag sind keine Details erfasst.")).toBeInTheDocument();
    });

    it("uses the German plural for more than one stop with no saved location", () => {
      // The singular and the plural are two keys, so one of them can be German while the other is not.
      const payload = basePayload({
        map: {
          points: [
            { id: "stay-1", label: "Hotel", kind: "currentStay", position: [48.1, 11.5], order: 0 },
            { id: "item-1", label: "Museum", kind: "planItem", position: [48.2, 11.6], order: 1 },
          ],
          missingLocations: [
            { id: "item-2", label: "Markt", kind: "planItem", location: null },
            { id: "item-3", label: "Aussicht", kind: "planItem", location: null },
          ],
        },
      });

      renderSheet({ payload }, "de");

      expect(screen.getByTestId("print-map-missing")).toHaveTextContent(
        "Die Route lässt 2 Stationen ohne gespeicherten Ort aus",
      );
    });

    it("names both stay kinds and both check times in German", () => {
      const payload = basePayload({
        timeline: [
          { kind: "previousStay", stay: makeStay({ id: "prev", name: "Airport Inn", checkOutTime: "10:00" }) },
          { kind: "currentStay", stay: makeStay({ id: "curr", name: "Beach Hotel", checkInTime: "15:00" }) },
        ],
      });

      renderSheet({ payload }, "de");

      expect(screen.getByText("Unterkunft der Vornacht")).toBeInTheDocument();
      expect(screen.getByText("Unterkunft heute Nacht")).toBeInTheDocument();
      // The two stay names are the user's own and stay exactly as entered.
      expect(screen.getByText("Airport Inn")).toBeInTheDocument();
      expect(screen.getByText("Beach Hotel")).toBeInTheDocument();
      expect(screen.getByText("Check-out: 10:00")).toBeInTheDocument();
      expect(screen.getByText("Check-in: 15:00")).toBeInTheDocument();
    });

    it("labels a travel segment with the German transport name and German duration units", () => {
      const payload = basePayload({
        timeline: [
          {
            kind: "travelSegment",
            segment: { ...makeSegment(), transportType: "car", durationMinutes: 45, distanceKm: 30 },
          },
        ],
      });

      renderSheet({ payload }, "de");

      const segment = screen
        .getAllByTestId("print-timeline-entry")
        .find((entry) => entry.dataset.kind === "travelSegment");
      // The whole composed label. `km` is the same word in both dictionaries and is asserted through the
      // shared `trips.travelSegment.kmSuffix` key rather than being left as a literal in the component.
      expect(segment).toHaveTextContent("Auto · 45 Min. · 30 km");
    });

    it("composes both duration halves in German for a leg carrying hours and minutes", () => {
      // `1h 30m` against `1 Std. 30 Min.`: the unit is a suffix in English and a separate word in German,
      // which is why the two halves are two keys joined by a space rather than one interpolated string.
      const payload = basePayload({
        timeline: [
          {
            kind: "travelSegment",
            segment: { ...makeSegment(), transportType: "flight", durationMinutes: 90, distanceKm: null },
          },
        ],
      });

      renderSheet({ payload }, "de");

      const segment = screen
        .getAllByTestId("print-timeline-entry")
        .find((entry) => entry.dataset.kind === "travelSegment");
      expect(segment).toHaveTextContent("Flug · 1 Std. 30 Min.");
    });

    it("prints an unknown transport type raw rather than a missing-key string", () => {
      // `transportType` comes out of the database and `tripImportSchemas.ts` does not constrain it to the
      // five known modes, so a restored backup can carry anything. `t()` returns the *key* for a miss,
      // so without the membership check this row would read
      // `trips.travelSegment.transport.hovercraft` on paper. Asserted in German because that is the
      // configuration in which the lookup happens at all.
      const payload = basePayload({
        timeline: [
          {
            kind: "travelSegment",
            segment: { ...makeSegment(), transportType: "hovercraft" as never, durationMinutes: 20, distanceKm: null },
          },
        ],
      });

      renderSheet({ payload }, "de");

      const segment = screen
        .getAllByTestId("print-timeline-entry")
        .find((entry) => entry.dataset.kind === "travelSegment");
      expect(segment).toHaveTextContent("hovercraft · 20 Min.");
      expect(segment).not.toHaveTextContent("trips.travelSegment");
    });

    it("gives a titleless activity the German positional name, on its card and on its document page", () => {
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

      renderSheet({ payload }, "de");

      // Timeline index 1, so "Programmpunkt 2" in both places - the card and the loose document page have
      // to agree on the wording *and* the number, which is what makes a printed sheet matchable.
      const card = screen.getAllByTestId("print-timeline-entry").find((entry) => entry.dataset.kind === "planItem");
      expect(card).toHaveTextContent("Programmpunkt 2");
      expect(screen.getByTestId("print-document-page")).toHaveTextContent("Programmpunkt 2");
    });

    it("renders the PDF appendix heading and its explanation in German", () => {
      const payload = basePayload({
        timeline: [
          {
            kind: "planItem",
            item: makeItem({
              id: "item-1",
              title: "Flug nach Rom",
              documents: [
                makeDocument({
                  id: "doc-pdf",
                  documentUrl: "/uploads/trips/trip-1/days/day-1/day-plan-items/item-1/documents/doc-1.pdf",
                  fileName: "Bordkarte.pdf",
                }),
              ],
            }),
          },
        ],
      });

      renderSheet({ payload }, "de");

      const appendix = screen.getByTestId("print-document-appendix");
      expect(appendix).toHaveTextContent("Nicht im Ausdruck enthaltene Dokumente");
      // AC2's claim, in German: the sheet has to say in print that these files are not in it and where to
      // get them. Matched on the claim rather than the whole sentence, so a reword stays free.
      expect(appendix).toHaveTextContent(/nicht Teil dieses Ausdrucks/i);
      expect(appendix).toHaveTextContent(/Dokumentenpaket/i);
      expect(screen.getByTestId("print-document-appendix-item")).toHaveTextContent(
        "Flug nach Rom — Bordkarte.pdf",
      );
    });
  });

  describe("onReady callback", () => {
    it("calls onReady after mount when there are no map points", async () => {
      const onReady = vi.fn();
      renderSheet({ payload: basePayload(), onReady });
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    });

    it("waits for a document image to load before firing, so the print dialog does not snapshot a blank page", async () => {
      // `onReady` is what fires `window.print()`, and the dialog captures the page at the moment it opens -
      // a later image load never reaches the preview. The day view renders documents as chips, never as
      // `<img>`, so a document image's bytes are always cold on the first print. Firing on mount therefore
      // prints AC1's full-page ticket blank. Without the wait, onReady is called before the load event.
      const onReady = vi.fn();
      renderSheet({
        payload: basePayload({
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
        }),
        onReady,
      });

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
      renderSheet({
        payload: basePayload({
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
        }),
        onReady,
      });

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
        renderSheet({
          payload: basePayload({
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
          }),
          onReady,
        });

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

      renderSheet({ payload, onReady });
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    });
  });

  /**
   * Story 10.2. Two claims, and the second is the one a reader gets wrong.
   *
   * First: this sheet rendered no money at all before this story - it never imported `formatCost` and
   * never read `costCents`, although the payload carried it. So AC5 adds the figure and annotates it,
   * rather than annotating a figure that does not exist.
   *
   * Second: the sheet draws **both** stay kinds through one block and separates them only inside it.
   * Rendering the cost unconditionally would print the same nightly rate on two consecutive days'
   * sheets - once as tonight's stay, again as tomorrow's previous night - which reads as a double
   * charge on the artefact least able to explain itself. The previous-night case below is what holds
   * that line; without it the shared-block trap regresses in silence.
   */
  describe("Story 10.2 cost and conversion receipt", () => {
    const NZD = {
      costOriginalAmount: 20000,
      costCurrency: "NZD",
      costRate: 1.8563,
      costRateDate: "2026-08-28",
    };

    it("prints the cost for tonight's stay and for a plan item", () => {
      const payload = basePayload({
        timeline: [
          { kind: "planItem", item: makeItem({ costCents: 5387 }) },
          { kind: "currentStay", stay: makeStay({ costCents: 10774 }) },
        ],
      });

      renderSheet({ payload });

      expect(screen.getByText("Cost: €53.87")).toBeInTheDocument();
      expect(screen.getByText("Cost: €107.74")).toBeInTheDocument();
      // A euro entry gets the figure and nothing beneath it (AC3).
      expect(screen.queryByTestId("cost-original-annotation")).toBeNull();
    });

    it("prints the receipt beneath the cost for a converted entry", () => {
      const payload = basePayload({
        timeline: [
          { kind: "planItem", item: makeItem({ costCents: 5387, ...NZD, costOriginalAmount: 10000 }) },
          { kind: "currentStay", stay: makeStay({ costCents: 10774, ...NZD }) },
        ],
      });

      renderSheet({ payload });

      const annotations = screen.getAllByTestId("cost-original-annotation");
      expect(annotations).toHaveLength(2);
      expect(screen.getByText("NZ$100.00 at 1.8563/EUR")).toBeInTheDocument();
      expect(screen.getByText("NZ$200.00 at 1.8563/EUR")).toBeInTheDocument();
    });

    it("prints neither the cost nor a receipt when costCents is null", () => {
      // The value both existing fixtures default to, so this is also the claim that every assertion
      // written before this story still describes the same sheet.
      const payload = basePayload({
        timeline: [
          { kind: "planItem", item: makeItem() },
          { kind: "currentStay", stay: makeStay() },
        ],
      });

      renderSheet({ payload });

      expect(screen.queryByText(/^Cost:/)).toBeNull();
      expect(screen.queryByTestId("cost-original-annotation")).toBeNull();
    });

    it("prints no cost on the previous-night stay, even when one is recorded", () => {
      // The shared-block trap. Tonight's stay only, matching the screen - where the previous-night
      // card is separate JSX that renders no cost at all.
      const payload = basePayload({
        timeline: [
          { kind: "previousStay", stay: makeStay({ id: "prev", name: "Airport Inn", costCents: 12000, ...NZD }) },
          { kind: "currentStay", stay: makeStay({ id: "curr", name: "Beach Hotel", costCents: 10774, ...NZD }) },
        ],
      });

      renderSheet({ payload });

      const entries = screen.getAllByTestId("print-timeline-entry");
      const previous = entries.find((entry) => entry.getAttribute("data-kind") === "previousStay")!;
      const current = entries.find((entry) => entry.getAttribute("data-kind") === "currentStay")!;

      expect(previous.textContent).not.toContain("Cost:");
      expect(previous.querySelector('[data-testid="cost-original-annotation"]')).toBeNull();
      expect(current.textContent).toContain("Cost: €107.74");
      expect(current.querySelector('[data-testid="cost-original-annotation"]')).not.toBeNull();
    });

    it("translates the cost label and the receipt's figures into German", () => {
      // DW-230 made the whole sheet translated; the amount, the rate and the label all move.
      const payload = basePayload({
        timeline: [{ kind: "currentStay", stay: makeStay({ costCents: 10774, ...NZD }) }],
      });

      renderSheet({ payload }, "de");

      // Plain spaces, not the NO-BREAK SPACE `Intl` actually emits: testing-library's default
      // normaliser collapses whitespace in the rendered text but not in the query string.
      expect(screen.getByText("Kosten: 107,74 €")).toBeInTheDocument();
      expect(screen.getByTestId("cost-original-annotation")).toHaveTextContent("200,00 NZ$ zu 1,8563/EUR");
    });

    it("prints a zero-exponent currency with no fraction digits", () => {
      // The sheet is a read surface like any other, so AC1's JPY rule reaches paper too.
      const payload = basePayload({
        timeline: [
          {
            kind: "currentStay",
            stay: makeStay({
              costCents: 2899,
              costOriginalAmount: 500000,
              costCurrency: "JPY",
              costRate: 172.5,
              costRateDate: "2026-08-28",
            }),
          },
        ],
      });

      renderSheet({ payload });

      expect(screen.getByTestId("cost-original-annotation")).toHaveTextContent("¥5,000 at 172.50/EUR");
    });
  });
});
