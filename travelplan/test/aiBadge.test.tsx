// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiBadge from "@/components/ui/AiBadge";
import DialogShell from "@/components/ui/DialogShell";
import TripDayBucketListPanel from "@/components/features/trips/TripDayBucketListPanel";
import TripBucketListPanel from "@/components/features/trips/TripBucketListPanel";
import de from "@/i18n/de";
import en from "@/i18n/en";
import { mockFetchResponse, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 15.4. The KI/AI badge itself, its slot beside a `DialogShell` title, and its use on the two
 * bucket-list panels. The day view's cards and the two dialogs are covered in their own suites.
 */

vi.mock("@/components/features/trips/TripDayPlanDialog", () => ({
  default: () => null,
}));

const bucketItem = (id: string, title: string, aiChangedAt: string | null) => ({
  id,
  tripId: "trip-1",
  title,
  contentJson: JSON.stringify({ type: "doc", content: [] }),
  durationMinutes: 60,
  costCents: null,
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
  payments: [],
  linkUrl: null,
  location: null,
  firstImageUrl: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  aiChangedAt,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiBadge (Story 15.4)", () => {
  it("reads KI with the German tooltip as its accessible name", () => {
    renderWithProviders(<AiBadge />, { language: "de" });
    const badge = screen.getByTestId("ai-badge");
    expect(badge).toHaveTextContent(de["trips.aiBadge.label"]);
    expect(de["trips.aiBadge.label"]).toBe("KI");
    expect(screen.getByRole("img", { name: "Von KI erstellt oder geändert" })).toBe(badge);
  });

  it("reads AI with the English tooltip, and shows the tooltip on hover", async () => {
    renderWithProviders(<AiBadge />);
    const badge = screen.getByTestId("ai-badge");
    expect(badge).toHaveTextContent("AI");
    expect(badge).toHaveAccessibleName("Created or changed by AI");

    await userEvent.hover(badge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(en["trips.aiBadge.tooltip"]);
  });
});

describe("DialogShell titleAdornment (Story 15.4)", () => {
  it("renders the adornment beside the h2 and keeps the dialog's accessible name the title alone", async () => {
    renderWithProviders(
      <DialogShell
        open
        onClose={() => undefined}
        title="Edit plan item"
        subtitle="Day 1"
        width={520}
        closeLabel="Close"
        footer={null}
        titleAdornment={<AiBadge />}
      >
        body
      </DialogShell>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Edit plan item" });
    const heading = within(dialog).getByRole("heading", { level: 2, name: "Edit plan item" });
    const badge = within(dialog).getByTestId("ai-badge");
    expect(heading).not.toContainElement(badge);
  });
});

describe("bucket-list panels (Story 15.4)", () => {
  it("marks the AI-changed idea on the day's bucket list and only that one", () => {
    renderWithProviders(
      <TripDayBucketListPanel
        items={[bucketItem("a", "Louvre", "2026-10-29T08:00:00.000Z"), bucketItem("b", "Orsay", null)]}
        loading={false}
        error={null}
        onSchedule={() => undefined}
      />,
    );

    const [marked, plain] = screen.getAllByTestId("bucket-item");
    expect(within(marked).getByTestId("ai-badge")).toHaveTextContent("AI");
    expect(within(plain).queryByTestId("ai-badge")).not.toBeInTheDocument();
  });

  it("marks the AI-changed idea on the overview's bucket list and only that one", async () => {
    stubFetch(
      vi.fn(async () =>
        mockFetchResponse({
          data: { items: [bucketItem("a", "Louvre", "2026-10-29T08:00:00.000Z"), bucketItem("b", "Orsay", null)] },
          error: null,
        }),
      ),
    );
    renderWithProviders(<TripBucketListPanel tripId="trip-1" />, { language: "de" });

    await waitFor(() => expect(screen.getByText("2 Einträge")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: de["trips.bucketList.expandAction"] }));

    const rows = await screen.findAllByTestId("bucket-item");
    const marked = rows.find((row) => within(row).queryByText("Louvre"));
    const plain = rows.find((row) => within(row).queryByText("Orsay"));
    expect(within(marked!).getByTestId("ai-badge")).toHaveTextContent("KI");
    expect(within(plain!).queryByTestId("ai-badge")).not.toBeInTheDocument();
  });
});
