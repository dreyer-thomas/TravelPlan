// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminAiUsage, { type AdminAiUsageData } from "@/components/features/admin/AdminAiUsage";
import { renderWithProviders } from "./helpers/renderWithProviders";
import { expectNoHardcodedColour } from "./helpers/hardcodedColour";

/** Story 8.7. The month view's client surface, on a stubbed fetch. jsdom lays nothing out. */

const LOADED: AdminAiUsageData = {
  month: "2026-10",
  months: ["2026-10", "2026-09"],
  summary: {
    totals: {
      searches: 4,
      failed: 1,
      inputTokens: 12000,
      cacheCreationInputTokens: 3000,
      cacheReadInputTokens: 45000,
      outputTokens: 6000,
      webSearchRequests: 9,
    },
    cacheReadShare: 0.75,
    estimatedCostUsd: 0.2468,
    costPerSearchUsd: 0.0617,
    unpricedModels: [],
    perUser: [
      { userId: "u1", email: "tommy@example.com", searches: 3, pricedSearches: 3, estimatedCostUsd: 0.2 },
      { userId: null, email: null, searches: 1, pricedSearches: 1, estimatedCostUsd: 0.0468 },
    ],
  },
};

const EMPTY: AdminAiUsageData = {
  month: "2026-09",
  months: ["2026-10", "2026-09"],
  summary: {
    totals: { searches: 0, failed: 0, inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
    cacheReadShare: null,
    estimatedCostUsd: 0,
    costPerSearchUsd: null,
    unpricedModels: [],
    perUser: [],
  },
};

const stubFetch = (...answers: Array<{ status?: number; data?: AdminAiUsageData; code?: string }>) => {
  const fetchMock = vi.fn(async () => {
    const answer = answers.length > 1 ? answers.shift()! : answers[0];
    const status = answer.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () =>
        answer.data ? { data: answer.data, error: null } : { data: null, error: { code: answer.code ?? "server_error", message: "x" } },
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("AdminAiUsage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the tiles, the token table and the per-account table with a deleted-account row", async () => {
    const fetchMock = stubFetch({ data: LOADED });

    renderWithProviders(<AdminAiUsage />);

    expect(await screen.findByText("$0.25")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/ai-usage", expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("$0.0617")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("45,000")).toBeInTheDocument();

    const perUser = screen.getByRole("table", { name: "By account" });
    expect(within(perUser).getByText("tommy@example.com")).toBeInTheDocument();
    expect(within(perUser).getByText("Deleted account")).toBeInTheDocument();
    expect(screen.getByText(/The Anthropic console shows the actual bill/)).toBeInTheDocument();
  });

  it("speaks German, deleted account included", async () => {
    stubFetch({ data: LOADED });

    renderWithProviders(<AdminAiUsage />, { language: "de" });

    expect(await screen.findByText("Gelöschtes Konto")).toBeInTheDocument();
    expect(screen.getByText("45.000")).toBeInTheDocument();
    expect(screen.getByText(/Anthropic-Konsole/)).toBeInTheDocument();
  });

  it("shows a sentence, not a table of zeros, for an empty month", async () => {
    stubFetch({ data: EMPTY });

    renderWithProviders(<AdminAiUsage />);

    expect(await screen.findByText("No AI searches in this month.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("refetches with ?month= when another month is picked", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ data: LOADED }, { data: EMPTY });

    renderWithProviders(<AdminAiUsage />);
    await screen.findByText("$0.25");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "September 2026" }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/ai-usage?month=2026-09", expect.anything()));
    expect(await screen.findByText("No AI searches in this month.")).toBeInTheDocument();
  });

  it("names an unpriced model and marks the cost tiles and a partly priced account as incomplete", async () => {
    stubFetch({
      data: {
        ...LOADED,
        summary: {
          ...LOADED.summary,
          unpricedModels: ["claude-other"],
          perUser: [
            { userId: "u1", email: "tommy@example.com", searches: 3, pricedSearches: 2, estimatedCostUsd: 0.2 },
            { userId: "u2", email: "other@example.com", searches: 1, pricedSearches: 0, estimatedCostUsd: 0 },
          ],
        },
      },
    });

    renderWithProviders(<AdminAiUsage />);

    expect(await screen.findByText(/no price for model claude-other/)).toBeInTheDocument();
    // Two cost tiles plus the partly priced account.
    expect(screen.getAllByText("Incomplete: some searches have no price")).toHaveLength(3);
    const tables = screen.getAllByRole("table");
    const unpricedRow = within(tables[1]).getByText("other@example.com").closest("tr")!;
    expect(within(unpricedRow).getByText("–")).toBeInTheDocument();
    expect(within(unpricedRow).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("shows the failed count even when it is zero", async () => {
    stubFetch({ data: { ...LOADED, summary: { ...LOADED.summary, totals: { ...LOADED.summary.totals, failed: 0 } } } });

    renderWithProviders(<AdminAiUsage />);

    expect(await screen.findByText("0 failed")).toBeInTheDocument();
  });

  it("shows the picked month and no old figures while it loads", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("?month=")) await pending;
      return { ok: true, status: 200, json: async () => ({ data: url.includes("?month=") ? EMPTY : LOADED, error: null }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<AdminAiUsage />);
    await screen.findByText("$0.25");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "September 2026" }));

    expect(screen.getByRole("combobox")).toHaveTextContent("September 2026");
    expect(screen.queryByText("$0.25")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    release();
    expect(await screen.findByText("No AI searches in this month.")).toBeInTheDocument();
  });

  it("keeps the month picker after a month fails to load, so another month can be picked", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ data: LOADED }, { status: 500, code: "server_error" }, { data: LOADED });

    renderWithProviders(<AdminAiUsage />);
    await screen.findByText("$0.25");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "September 2026" }));
    expect(await screen.findByText("Unable to load AI usage. Please refresh.")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "October 2026" }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/ai-usage?month=2026-10", expect.anything()));
    expect(await screen.findByText("$0.25")).toBeInTheDocument();
  });

  it("shows the forbidden state on 403", async () => {
    stubFetch({ status: 403, code: "forbidden" });

    renderWithProviders(<AdminAiUsage />);

    expect(await screen.findByText("AI usage is only available to administrators.")).toBeInTheDocument();
  });

  it("shows the load error on a 500", async () => {
    stubFetch({ status: 500, code: "server_error" });

    renderWithProviders(<AdminAiUsage />);

    expect(await screen.findByText("Unable to load AI usage. Please refresh.")).toBeInTheDocument();
  });

  it("uses design tokens only", () => {
    expectNoHardcodedColour("src/components/features/admin/AdminAiUsage.tsx");
    expectNoHardcodedColour("src/app/(routes)/admin/ai-usage/page.tsx");
  });
});
