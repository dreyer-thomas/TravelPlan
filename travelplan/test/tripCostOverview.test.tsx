// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripCostOverview from "@/components/features/trips/TripCostOverview";
import { I18nProvider } from "@/i18n/provider";

type TripDetailResponse = {
  trip: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    dayCount: number;
    plannedCostTotal: number;
    accommodationCostTotalCents: number | null;
    heroImageUrl: string | null;
  };
  days: Array<{
    id: string;
    date: string;
    dayIndex: number;
    note: string | null;
    plannedCostSubtotal: number;
    accommodation: {
      id: string;
      name: string;
      costCents: number | null;
      payments?: { amountCents: number; dueDate: string }[];
    } | null;
    dayPlanItems: Array<{
      id: string;
      title: string | null;
      contentJson: string;
      costCents: number | null;
      payments?: { amountCents: number; dueDate: string }[];
    }>;
  }>;
};

const renderOverview = async (data: TripDetailResponse) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data,
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

  return { fetchMock, user: userEvent.setup() };
};

describe("TripCostOverview", () => {
  it("renders day costs, missing cost labels, and the trip total", async () => {
    await renderOverview({
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
            payments: [{ amountCents: 10000, dueDate: "2026-12-01" }],
          },
          dayPlanItems: [
            {
              id: "plan-1",
              title: "Museum",
              contentJson: "invalid",
              costCents: 5000,
              payments: [{ amountCents: 5000, dueDate: "2026-12-01" }],
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
            payments: [{ amountCents: 15000, dueDate: "2026-12-02" }],
          },
          dayPlanItems: [
            {
              id: "plan-2",
              title: null,
              contentJson: "invalid",
              costCents: null,
              payments: [],
            },
          ],
        },
      ],
    });

    expect(screen.getByRole("tab", { name: "Days" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "false");
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

  it("switches to months view, groups entries chronologically, keeps unscheduled costs single, and preserves day mode state", async () => {
    const { user, fetchMock } = await renderOverview({
      trip: {
        id: "trip-1",
        name: "Winter Escape",
        startDate: "2026-12-01T00:00:00.000Z",
        endDate: "2027-01-12T00:00:00.000Z",
        dayCount: 3,
        plannedCostTotal: 70000,
        accommodationCostTotalCents: 40000,
        heroImageUrl: null,
      },
      days: [
        {
          id: "day-1",
          date: "2026-12-15T00:00:00.000Z",
          dayIndex: 1,
          note: null,
          plannedCostSubtotal: 35000,
          accommodation: {
            id: "stay-1",
            name: "Harbor Hotel",
            costCents: 30000,
            payments: [{ amountCents: 10000, dueDate: "2026-12-20" }, { amountCents: 20000, dueDate: "2027-01-05" }],
          },
          dayPlanItems: [
            {
              id: "plan-1",
              title: "Museum",
              contentJson: "invalid",
              costCents: 5000,
              payments: [],
            },
          ],
        },
        {
          id: "day-2",
          date: "2026-12-28T00:00:00.000Z",
          dayIndex: 2,
          note: null,
          plannedCostSubtotal: 30000,
          accommodation: null,
          dayPlanItems: [
            {
              id: "plan-2",
              title: "Train to Alps",
              contentJson: "invalid",
              costCents: 20000,
              payments: [{ amountCents: 20000, dueDate: "2027-01-10" }],
            },
            {
              id: "plan-3",
              title: "Deposit",
              contentJson: "invalid",
              costCents: 10000,
              payments: [{ amountCents: 10000, dueDate: "2026-12-29" }],
            },
          ],
        },
        {
          id: "day-3",
          date: "2027-01-12T00:00:00.000Z",
          dayIndex: 3,
          note: null,
          plannedCostSubtotal: 17000,
          accommodation: {
            id: "stay-2",
            name: "Cabin Night",
            costCents: 12000,
            payments: [],
          },
          dayPlanItems: [
            {
              id: "plan-4",
              title: "Walking tour",
              contentJson: "invalid",
              costCents: 5000,
              payments: [],
            },
          ],
        },
      ],
    });

    await user.click(screen.getByRole("tab", { name: "Months" }));

    expect(screen.getByRole("tab", { name: "Days" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "true");

    const monthTotals = screen.getAllByText(/Month total:/);
    expect(monthTotals).toHaveLength(2);
    expect(screen.getByText("December 2026")).toBeInTheDocument();
    expect(screen.getByText("January 2027")).toBeInTheDocument();
    expect(screen.getByText("Museum")).toBeInTheDocument();
    expect(screen.getByText("Dec 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Deposit")).toBeInTheDocument();
    expect(screen.getByText("Dec 29, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jan 5, 2027")).toBeInTheDocument();
    expect(screen.getByText("Train to Alps")).toBeInTheDocument();
    expect(screen.getByText("Cabin Night")).toBeInTheDocument();
    expect(screen.getAllByText("Jan 12, 2027")).toHaveLength(2);
    expect(screen.getByText("Walking tour")).toBeInTheDocument();
    expect(screen.getByText("Month total: 250.00")).toBeInTheDocument();
    expect(screen.getByText("Month total: 570.00")).toBeInTheDocument();
    expect(screen.getByText("Trip total: 700.00")).toBeInTheDocument();
    expect(screen.queryByText("Day 1")).not.toBeInTheDocument();
    expect(screen.getAllByText("Harbor Hotel")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: "Days" }));

    expect(screen.getByRole("tab", { name: "Days" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Months" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Day 1")).toBeInTheDocument();
    expect(screen.getByText("Day 3")).toBeInTheDocument();
    expect(screen.getByText("Current night: Cabin Night")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("shows a monthly empty state when no payable entries exist", async () => {
    const { user } = await renderOverview({
      trip: {
        id: "trip-1",
        name: "Quiet Weekend",
        startDate: "2026-12-01T00:00:00.000Z",
        endDate: "2026-12-01T00:00:00.000Z",
        dayCount: 1,
        plannedCostTotal: 0,
        accommodationCostTotalCents: 0,
        heroImageUrl: null,
      },
      days: [
        {
          id: "day-1",
          date: "2026-12-01T00:00:00.000Z",
          dayIndex: 1,
          note: null,
          plannedCostSubtotal: 0,
          accommodation: null,
          dayPlanItems: [
            {
              id: "plan-1",
              title: "Free walk",
              contentJson: "invalid",
              costCents: null,
              payments: [],
            },
          ],
        },
      ],
    });

    await user.click(screen.getByRole("tab", { name: "Months" }));

    expect(screen.getByText("No open costs scheduled yet.")).toBeInTheDocument();
    expect(screen.getByText("Trip total: 0.00")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
