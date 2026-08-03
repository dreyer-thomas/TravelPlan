// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TripCostOverview from "@/components/features/trips/TripCostOverview";
import { renderWithProviders } from "./helpers/renderWithProviders";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const renderOverview = async (data: TripDetailResponse, options: { language?: "en" | "de" } = {}) => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data,
      error: null,
    }),
  })) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchMock);

  // The theme wrapper is not optional here: the component reads `theme.palette.tokens.*`, which is
  // absent from MUI's bare default theme, so a plain `render` would throw on the first token access.
  renderWithProviders(<TripCostOverview tripId="trip-1" />, options);

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());

  return { fetchMock, user: userEvent.setup() };
};

// jsdom reports computed colours as `rgb(r, g, b)`; the palette stores hex. Same helper shape as
// `tripDayViewLayout.test.tsx:13`.
const toRgb = (hex: string) => {
  const value = parseInt(hex.replace("#", ""), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

// All three card wrappers here previously painted themselves `#ffffff`, and the page shell around
// them `#2f343d` (guarded separately in `tripCostOverviewPage.test.tsx`), so opening the cost
// overview inverted the app's value scheme on the way in. This source-text guard is a *negative*
// check and deliberately paired with the positive style assertions below it: on its own it would pass
// just as happily if a surface lost its `backgroundColor` altogether, or took the wrong token.
// Comments are stripped first so an issue reference like `// see #1234` cannot fail the guard, and
// named colours plus every colour function notation are matched so the literal cannot come back in
// another spelling. What it cannot see: a colour lifted into a constant in another file, and a hex
// sitting after a `//` inside a string literal on the same line (`stripComments` truncates there).
// `__dirname`, not `process.cwd()`, so the path holds however vitest was invoked.
const HARDCODED_COLOUR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|["'](?:white|black|whitesmoke|gainsboro|silver|gr[ae]y|ivory|snow)["']/;
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const repoRoot = resolve(__dirname, "..");

describe("trip cost overview colours", () => {
  it("carries no hardcoded colour in the component", () => {
    const source = readFileSync(resolve(repoRoot, "src/components/features/trips/TripCostOverview.tsx"), "utf8");
    expect(stripComments(source)).not.toMatch(HARDCODED_COLOUR);
  });
});

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
    // Story 7.13 (DW-27): amounts come from the shared currency-aware `formatCost`, so the old
    // "Cost: 150.00" wrapper from `trips.stay.costSummary` is gone on this screen.
    expect(screen.getAllByText("€150.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Cost: 150.00")).not.toBeInTheDocument();
    expect(screen.getByText("Trip total: €300.00")).toBeInTheDocument();
    expect(screen.getByTestId("cost-overview-table-wrapper")).toHaveStyle({ overflowX: "auto" });

    // AC5: the restyle must not quietly drop the table semantics - this is tabular data, and the
    // element plus its three column headers is what conveys that to assistive technology.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Day" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cost positions" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Day total" })).toBeInTheDocument();

    // AC2, positively. The hex guard above only proves no literal is present; this proves the card
    // actually carries the shipped token bundle, so dropping `backgroundColor` or reaching for the
    // wrong token fails here rather than shipping.
    expect(screen.getByTestId("cost-overview-card")).toHaveStyle({
      backgroundColor: toRgb("#FFFFFF"),
      borderColor: toRgb("#D9D0BE"),
      borderRadius: "8px",
      padding: "18px",
    });

    // AC4, Trap 2. `labelCaps` has no variantMapping, so losing `component="h1"` silently demotes the
    // card label to a <span> and the screen ends up with no heading at all - invisible in a text
    // assertion, caught here. The caps treatment is asserted on the header cells for the same reason.
    expect(screen.getByRole("heading", { level: 1, name: "Cost overview" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Day" })).toHaveStyle({
      textTransform: "uppercase",
      fontWeight: "800",
    });

    vi.unstubAllGlobals();
  });

  it("renders German amounts with the symbol in the locale's position", async () => {
    // AC6 is a *currency* switch, not a number switch: `style: "currency"` exists so German reads
    // "150,00 €" and English "€150.00". A single-locale test would pass on a formatter that hardcodes
    // the symbol in front, which is the bug the shared helper's docblock is about.
    await renderOverview(
      {
        trip: {
          id: "trip-1",
          name: "Winterflucht",
          startDate: "2026-12-01T00:00:00.000Z",
          endDate: "2026-12-01T00:00:00.000Z",
          dayCount: 1,
          plannedCostTotal: 123450,
          accommodationCostTotalCents: null,
          heroImageUrl: null,
        },
        days: [
          {
            id: "day-1",
            date: "2026-12-01T00:00:00.000Z",
            dayIndex: 1,
            note: null,
            plannedCostSubtotal: 123450,
            accommodation: null,
            dayPlanItems: [
              {
                id: "plan-1",
                title: "Museum",
                contentJson: "invalid",
                costCents: 123450,
                payments: [],
              },
            ],
          },
        ],
      },
      { language: "de" },
    );

    // Intl emits a non-breaking space before the symbol; Testing Library's default normalizer
    // collapses it to a plain space, so these are written with an ordinary one.
    expect(screen.getAllByText("1.234,50 €").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Reise gesamt: 1.234,50 €")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows the error alert on a failed load without dropping the card shell", async () => {
    // AC8 names the error alert, and nothing on this screen covered it before. `detail` stays null, so
    // this also pins what the card renders in that state.
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<TripCostOverview tripId="trip-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.getByRole("heading", { level: 1, name: "Cost overview" })).toBeInTheDocument();
    expect(screen.getByTestId("cost-overview-card")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

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
    expect(screen.getByText("Month total: €250.00")).toBeInTheDocument();
    expect(screen.getByText("Month total: €570.00")).toBeInTheDocument();
    expect(screen.getByText("Trip total: €700.00")).toBeInTheDocument();
    expect(screen.queryByText("Day 1")).not.toBeInTheDocument();
    expect(screen.getAllByText("Harbor Hotel")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // AC3: a month group sits inside the card, so it must read as a nested group rather than a second
    // card - the quieter `cardAlt` fill, the plain `border` token, and a 6px radius that does not
    // compete with the card's 8px. Asserted positively; the hex guard cannot see any of it.
    const [firstMonthGroup] = screen.getAllByTestId("cost-overview-month-group");
    expect(firstMonthGroup).toHaveStyle({
      backgroundColor: toRgb("#FBF9F4"),
      borderColor: toRgb("#E4DFD3"),
      borderRadius: "6px",
    });
    expect(firstMonthGroup).not.toHaveStyle({ borderRadius: "8px" });
    // AC4: the outline descends h1 -> h2 rather than skipping.
    expect(screen.getByRole("heading", { level: 2, name: "December 2026" })).toBeInTheDocument();

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
    expect(screen.getByText("Trip total: €0.00")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
