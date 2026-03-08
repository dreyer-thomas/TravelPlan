// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripCostOverview from "@/components/features/trips/TripCostOverview";
import { I18nProvider } from "@/i18n/provider";

describe("TripCostOverview", () => {
  it("renders day costs, missing cost labels, and the trip total", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          trip: {
            id: "trip-1",
            name: "Winter Escape",
            startDate: "2026-12-01T00:00:00.000Z",
            endDate: "2026-12-02T00:00:00.000Z",
            dayCount: 2,
            plannedCostTotal: 30000,
            accommodationCostTotalCents: null,
            heroImageUrl: null,
          },
          days: [
            {
              id: "day-1",
              date: "2026-12-01T00:00:00.000Z",
              dayIndex: 1,
              note: null,
              plannedCostSubtotal: 15000,
              accommodation: {
                id: "stay-1",
                name: "Hotel One",
                costCents: 10000,
              },
              dayPlanItems: [
                {
                  id: "plan-1",
                  title: "Museum",
                  contentJson: "invalid",
                  costCents: 5000,
                },
              ],
            },
            {
              id: "day-2",
              date: "2026-12-02T00:00:00.000Z",
              dayIndex: 2,
              note: null,
              plannedCostSubtotal: 15000,
              accommodation: {
                id: "stay-2",
                name: "Hotel Two",
                costCents: 15000,
              },
              dayPlanItems: [
                {
                  id: "plan-2",
                  title: null,
                  contentJson: "invalid",
                  costCents: null,
                },
              ],
            },
          ],
        },
        error: null,
      }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripCostOverview tripId="trip-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText("Day 1")).toBeInTheDocument();
    expect(screen.getByText("Dec 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Day 2")).toBeInTheDocument();
    expect(screen.getByText("Dec 2, 2026")).toBeInTheDocument();

    expect(screen.getByText("Current night: Hotel One")).toBeInTheDocument();
    expect(screen.getByText("Current night: Hotel Two")).toBeInTheDocument();
    expect(screen.getByText("Museum")).toBeInTheDocument();
    expect(screen.getByText("Activity 1")).toBeInTheDocument();
    expect(screen.getAllByTestId("cost-missing")).toHaveLength(1);

    expect(screen.getAllByText("Cost: 150.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Trip total: 300.00")).toBeInTheDocument();
    expect(screen.getByTestId("cost-overview-table-wrapper")).toHaveStyle({ overflowX: "auto" });

    vi.unstubAllGlobals();
  });
});
