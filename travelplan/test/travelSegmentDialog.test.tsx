// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripDayTravelSegmentDialog from "@/components/features/trips/TripDayTravelSegmentDialog";
import { I18nProvider } from "@/i18n/provider";

const baseProps = {
  open: true,
  tripId: "trip-1",
  tripDayId: "day-1",
  fromItem: {
    id: "item-1",
    type: "dayPlanItem" as const,
    label: "Morning",
    location: null,
  },
  toItem: {
    id: "stay-1",
    type: "accommodation" as const,
    label: "Hotel",
    location: null,
  },
  segment: null,
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

describe("TripDayTravelSegmentDialog", () => {
  it("validates distance for car travel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { segment: { id: "segment-1" } }, error: null }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayTravelSegmentDialog {...baseProps} />
      </I18nProvider>,
    );

    const saveButton = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Distance is required for car travel")).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });
});
