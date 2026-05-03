// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripDayPrintDocument from "@/components/features/trips/TripDayPrintDocument";
import type { TripDayPrintPayload } from "@/lib/repositories/tripRepo";

const EMPTY_MAP = { points: [], missingLocations: [] };

const makeStay = (overrides: Partial<TripDayPrintPayload["timeline"][number] extends { stay: infer S } ? S : never> = {}) => ({
  id: "stay-1",
  name: "Grand Hotel",
  notes: null,
  status: "booked" as const,
  costCents: null,
  link: null,
  checkInTime: null,
  checkOutTime: null,
  location: null,
  images: [],
  ...overrides,
});

const makeItem = (overrides: Partial<{
  id: string; title: string | null; fromTime: string | null; toTime: string | null;
  contentJson: string; costCents: number | null; linkUrl: string | null;
  location: null; images: [];
}> = {}) => ({
  id: "item-1",
  title: "Museum Visit",
  fromTime: "09:00",
  toTime: "11:00",
  contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Great place" }] }] }),
  costCents: null,
  linkUrl: null,
  location: null,
  images: [],
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

  describe("onReady callback", () => {
    it("calls onReady after mount when there are no map points", async () => {
      const onReady = vi.fn();
      render(<TripDayPrintDocument payload={basePayload()} onReady={onReady} />);
      await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
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
