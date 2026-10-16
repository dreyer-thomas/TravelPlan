// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DialogShell from "@/components/ui/DialogShell";
import TripDaySuggestionsDialog, {
  type TripDaySuggestionsDialogProps,
} from "@/components/features/trips/TripDaySuggestionsDialog";
import type { DaySuggestion } from "@/lib/validation/daySuggestionSchemas";
import type { SuggestionPreview } from "@/lib/validation/daySuggestionApplySchemas";
import type { SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 12.3 AC2–AC9. The dialog rendered on its own, against a stubbed `fetch`; `TripDayView`'s entry
 * point is `tripDayViewSuggestionsEntry.test.tsx`. Assertions read the English dictionary the provider
 * renders by default.
 */

const suggestion = (overrides: Partial<DaySuggestion> = {}): DaySuggestion => ({
  title: "Old Harbour",
  description: "Walk the quay.\nThen the fish market.",
  locationLabel: "Harbour, Porto",
  lat: 41.14,
  lng: -8.61,
  durationMinutes: 90,
  verified: true,
  images: [],
  ...overrides,
});

const threeSuggestions = (): DaySuggestion[] => [
  suggestion({
    title: "Old Harbour",
    images: [
      { thumbnailUrl: "https://upload.wikimedia.org/a-250.jpg", originalUrl: "https://upload.wikimedia.org/a-original.jpg" },
      { thumbnailUrl: "https://upload.wikimedia.org/b-250.jpg", originalUrl: "https://upload.wikimedia.org/b-original.jpg" },
      { thumbnailUrl: "https://upload.wikimedia.org/c-250.jpg", originalUrl: "https://upload.wikimedia.org/c-original.jpg" },
    ],
  }),
  suggestion({ title: "Tile Museum", locationLabel: "Museu, Porto", durationMinutes: 45, verified: false }),
  suggestion({ title: "Garden Walk", locationLabel: "Jardim, Porto", durationMinutes: 120 }),
];

const ok = (suggestions: DaySuggestion[]) => mockFetchResponse({ data: { suggestions }, error: null });

/**
 * Story 12.4. The preview of [Old Harbour, Garden Walk] ticked in that order: Garden Walk first, then the
 * harbour, which runs past midnight, with an unknown leg between them.
 */
const previewData = (overrides: Partial<SuggestionPreview> = {}): SuggestionPreview => ({
  order: [1, 0],
  rows: [{ fromTime: "09:45", toTime: "11:45" }, null],
  legs: [{ durationMinutes: 12, distanceKm: 8.4 }, null],
  basis: { afterItemId: null, startTime: "09:30" },
  overflow: true,
  routingUnavailable: false,
  origin: { kind: "stay", label: "Hotel Ribeira" },
  ...overrides,
});
const previewReply = (overrides: Partial<SuggestionPreview> = {}) =>
  mockFetchResponse({ data: previewData(overrides), error: null });
const RECEIPT = { version: 2, tripDayId: "day-2", signature: "a".repeat(64) } as unknown as SignedDayChangeReceiptWire;

const renderDialog = (props: Partial<TripDaySuggestionsDialogProps> = {}) => {
  const onClose = vi.fn();
  const ensureCsrfToken = vi.fn(async () => "csrf-token");
  const view = renderWithProviders(
    <TripDaySuggestionsDialog
      open
      onClose={onClose}
      tripId="trip-1"
      dayId="day-2"
      dayLabel="Day 2"
      start={{ label: "Hotel Ribeira" }}
      end={{ label: "Casa Azul" }}
      ensureCsrfToken={ensureCsrfToken}
      {...props}
    />,
  );
  return { ...view, onClose, ensureCsrfToken };
};

const typeWishAndSearch = async (user: ReturnType<typeof userEvent.setup>, wish = "Something with tiles") => {
  await user.type(screen.getByLabelText("What would you like to do today?"), wish);
  await user.click(screen.getByRole("button", { name: "Search" }));
};

/** A fetch that hangs until released, and rejects with an `AbortError` when its signal aborts. */
const hangingFetch = () => {
  let release: (response: Response) => void = () => {};
  const mock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        release = resolve;
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  return { mock, release: (response: Response) => release(response) };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TripDaySuggestionsDialog", () => {
  it("shows the day's start and end, read-only", () => {
    renderDialog();
    const route = screen.getByTestId("suggestions-route");
    expect(route).toHaveTextContent("Start");
    expect(route).toHaveTextContent("Hotel Ribeira");
    expect(route).toHaveTextContent("End");
    expect(route).toHaveTextContent("Casa Azul");
    expect(within(route).queryByRole("textbox")).toBeNull();
  });

  it("falls back to the trip's start and to no stay when either end is missing", () => {
    renderDialog({ start: null, end: null });
    const route = screen.getByTestId("suggestions-route");
    expect(route).toHaveTextContent("The trip's starting point");
    expect(route).toHaveTextContent("No stay");
  });

  it("names the dialog by its title, with the day as the sub-line and one close", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Ideas for the day" })).toBeInTheDocument();
    expect(screen.getByText("Day 2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("caps the wish at 500 characters", () => {
    renderDialog();
    expect(screen.getByLabelText("What would you like to do today?")).toHaveAttribute("maxlength", "500");
  });

  it("defaults to car, keeps a mode set when the active one is pressed again, and sends the mode", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => ok(threeSuggestions())),
    );
    renderDialog();

    const group = screen.getByRole("group", { name: "Getting around" });
    expect(within(group).getByRole("button", { name: "Car" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "Car" }));
    expect(within(group).getByRole("button", { name: "Car" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(group).getByRole("button", { name: "On foot" }));
    await typeWishAndSearch(user, "  Tiles and coffee  ");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl(input!)).toBe("/api/trips/trip-1/days/day-2/suggestions");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: "Tiles and coffee", mode: "walking" });
  });

  it("shows the field error for an empty or blank wish and sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(vi.fn(async () => ok(threeSuggestions())));
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Say briefly what you would like to do.")).toBeInTheDocument();

    await typeWishAndSearch(user, "   ");
    expect(screen.getByText("Say briefly what you would like to do.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the wish and the mode while searching and says it may take a while", async () => {
    const user = userEvent.setup();
    const hanging = hangingFetch();
    stubFetch(hanging.mock);
    renderDialog();

    await typeWishAndSearch(user);

    expect(await screen.findByRole("button", { name: "Searching …" })).toBeDisabled();
    expect(screen.getByLabelText("What would you like to do today?")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Car" })).toBeDisabled();
    expect(screen.getByText("This can take up to a minute.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();

    hanging.release(ok(threeSuggestions()));
    expect(await screen.findByText("3 ideas found")).toBeInTheDocument();
    expect(screen.getByLabelText("What would you like to do today?")).toBeEnabled();
    expect(screen.queryByText("This can take up to a minute.")).toBeNull();
  });

  it("aborts the request when closed mid-search, closes without asking and shows no error", async () => {
    const user = userEvent.setup();
    const hanging = hangingFetch();
    stubFetch(hanging.mock);
    const { onClose } = renderDialog();

    await typeWishAndSearch(user);
    await screen.findByRole("button", { name: "Searching …" });
    const signal = hanging.mock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
    // Let the aborted fetch settle first, so a banner raised by its rejection would already be showing.
    await act(async () => {
      await hanging.mock.mock.results[0]?.value.catch(() => undefined);
    });
    expect(screen.queryByTestId("suggestions-error")).toBeNull();
  });

  it("aborts a running search when the dialog unmounts", async () => {
    const user = userEvent.setup();
    const hanging = hangingFetch();
    stubFetch(hanging.mock);
    const { unmount } = renderDialog();

    await typeWishAndSearch(user);
    await screen.findByRole("button", { name: "Searching …" });
    const signal = hanging.mock.mock.calls[0]?.[1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("renders each suggestion as a card with its text, duration, place and at most three pictures", async () => {
    const user = userEvent.setup();
    const many = threeSuggestions();
    many[0] = {
      ...many[0],
      images: [
        ...many[0].images,
        { thumbnailUrl: "https://upload.wikimedia.org/d-250.jpg", originalUrl: "https://upload.wikimedia.org/d-original.jpg" },
      ],
    };
    stubFetch(vi.fn(async () => ok(many)));
    const { baseElement } = renderDialog();

    await typeWishAndSearch(user);
    const list = await screen.findByRole("group", { name: "3 ideas found" });
    const cards = within(list).getAllByTestId("suggestion-card");
    expect(cards).toHaveLength(3);

    const first = cards[0];
    expect(within(first).getByRole("checkbox", { name: "Old Harbour" })).not.toBeChecked();
    expect(first).toHaveTextContent("Walk the quay.");
    expect(within(first).getByText(/Walk the quay\./)).toHaveStyle({ whiteSpace: "pre-line" });
    expect(first).toHaveTextContent("Harbour, Porto");
    expect(first).toHaveTextContent("about 1½ h");
    expect(cards[1]).toHaveTextContent("about 45 min");

    const images = within(first).getAllByRole("img");
    expect(images).toHaveLength(3);
    images.forEach((image, index) => {
      expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("alt", `Photo of Old Harbour, image ${index + 1} of 3`);
    });
    expect(images[0]).toHaveAttribute("src", "https://upload.wikimedia.org/a-250.jpg");

    // A card without pictures draws no strip at all.
    expect(within(cards[2]).queryAllByRole("img")).toHaveLength(0);
    // The originals are 12.4's download source and never reach the DOM.
    expect(baseElement.innerHTML).not.toContain("original.jpg");
  });

  it("describes the checkbox with the card's place and duration line", async () => {
    const user = userEvent.setup();
    stubFetch(vi.fn(async () => ok(threeSuggestions())));
    renderDialog();
    await typeWishAndSearch(user);

    const checkbox = await screen.findByRole("checkbox", { name: "Tile Museum" });
    expect(checkbox).toHaveAccessibleDescription(/Museu, Porto.*about 45 min.*Location not confirmed/);
  });

  it("hides a picture that fails to load and leaves the rest of the card alone", async () => {
    const user = userEvent.setup();
    stubFetch(vi.fn(async () => ok(threeSuggestions())));
    renderDialog();
    await typeWishAndSearch(user);

    const [card] = await screen.findAllByTestId("suggestion-card");
    const [firstImage] = within(card).getAllByRole("img");
    firstImage.dispatchEvent(new Event("error"));

    await waitFor(() => expect(within(card).getAllByRole("img")).toHaveLength(2));
    expect(within(card).getByRole("checkbox", { name: "Old Harbour" })).toBeInTheDocument();
    // The count describes what is left on screen.
    within(card)
      .getAllByRole("img")
      .forEach((image, index) => expect(image).toHaveAttribute("alt", `Photo of Old Harbour, image ${index + 1} of 2`));

    // With every picture gone, the strip itself goes.
    within(card)
      .getAllByRole("img")
      .forEach((image) => image.dispatchEvent(new Event("error")));
    await waitFor(() => expect(within(card).queryAllByRole("img")).toHaveLength(0));
  });

  it("caps the wish at the server schema's maximum", () => {
    renderDialog();
    expect(screen.getByLabelText("What would you like to do today?")).toHaveAttribute("maxlength", "500");
  });

  it("marks only the unverified suggestion", async () => {
    const user = userEvent.setup();
    stubFetch(vi.fn(async () => ok(threeSuggestions())));
    renderDialog();
    await typeWishAndSearch(user);

    const cards = await screen.findAllByTestId("suggestion-card");
    expect(within(cards[0]).queryByText("Location not confirmed")).toBeNull();
    expect(within(cards[1]).getByText("Location not confirmed")).toBeInTheDocument();
    expect(within(cards[2]).queryByText("Location not confirmed")).toBeNull();
  });

  it("says 1 idea found for a single result", async () => {
    const user = userEvent.setup();
    stubFetch(vi.fn(async () => ok([suggestion()])));
    renderDialog();
    await typeWishAndSearch(user);
    expect(await screen.findByText("1 idea found")).toBeInTheDocument();
  });

  it("ticks a suggestion by clicking anywhere on its card and counts the ticks in the footer", async () => {
    const user = userEvent.setup();
    stubFetch(vi.fn(async () => ok(threeSuggestions())));
    renderDialog();

    expect(screen.getByText("Nothing selected yet")).toBeInTheDocument();
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");

    await user.click(within(cards[0]).getByText("Harbour, Porto"));
    expect(within(cards[0]).getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(within(cards[2]).getByText("Garden Walk"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(within(cards[0]).getByRole("checkbox"));
    expect(within(cards[0]).getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("replaces the list and clears every tick on a new search, and the old list cannot be ticked meanwhile", async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(
      vi
        .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(ok(threeSuggestions()))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    renderDialog();

    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    await user.click(within(cards[0]).getByText("Old Harbour"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(screen.getByText("Nothing selected yet")).toBeInTheDocument();
    const staleCards = screen.getAllByTestId("suggestion-card");
    expect(staleCards).toHaveLength(3);
    staleCards.forEach((card) => expect(within(card).getByRole("checkbox")).toBeDisabled());
    // The stale list keeps its name while it is still on screen.
    expect(screen.getByRole("group", { name: "3 ideas found" })).toBeInTheDocument();

    release(ok([suggestion({ title: "Port Wine Cellar" }), suggestion({ title: "Bridge Climb" })]));
    expect(await screen.findByText("2 ideas found")).toBeInTheDocument();
    expect(screen.getAllByTestId("suggestion-card")).toHaveLength(2);
    expect(screen.queryByText("Old Harbour")).toBeNull();
    screen.getAllByRole("checkbox").forEach((checkbox) => expect(checkbox).not.toBeChecked());
  });

  it("renders no apply button without onApplied", async () => {
    const user = userEvent.setup();
    stubFetch(vi.fn(async () => ok(threeSuggestions())));
    renderDialog();
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    await user.click(within(cards[0]).getByText("Old Harbour"));
    expect(screen.queryByRole("button", { name: /^Add/ })).toBeNull();
  });

  it("with onApplied, enables the apply button from one tick and previews the ticked suggestions in list order", async () => {
    const user = userEvent.setup();
    const results = threeSuggestions();
    const fetchMock = stubFetch(
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) =>
        requestUrl(input).endsWith("/preview") ? previewReply() : ok(results),
      ),
    );
    renderDialog({ onApplied: vi.fn() });

    expect(screen.getByRole("button", { name: "Add (0)" })).toBeDisabled();
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    expect(screen.getByRole("button", { name: "Add (0)" })).toBeDisabled();

    await user.click(within(cards[2]).getByText("Garden Walk"));
    await user.click(within(cards[0]).getByText("Old Harbour"));
    const apply = screen.getByRole("button", { name: "Add (2)" });
    expect(apply).toBeEnabled();

    await user.click(apply);
    await screen.findByTestId("suggestions-preview");
    const [input, init] = fetchMock.mock.calls[1] ?? [];
    expect(requestUrl(input!)).toBe("/api/trips/trip-1/days/day-2/suggestions/preview");
    expect((init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-token");
    expect(JSON.parse(String(init?.body))).toEqual({ mode: "car", suggestions: [results[0], results[2]] });
  });

  describe("errors", () => {
    const errorReply = (status: number, code: string, details?: unknown) =>
      mockFetchResponse({ data: null, error: { code, message: code, details } }, { status });

    it.each([
      ["ai_failed", 502, "No ideas could be found just now. Please try again later."],
      ["ai_limit_reached", 429, "You have used all of today's searches. Try again tomorrow."],
      ["ai_unavailable", 503, "Idea search is not set up right now."],
      ["forbidden", 403, "Your role on this trip does not allow this action."],
      ["unauthorized", 401, "Authentication required. Please sign in."],
      ["csrf_invalid", 403, "Invalid security token. Please refresh and try again."],
      ["not_found", 404, "Something went wrong. Please try again."],
      ["server_error", 500, "Something went wrong. Please try again."],
    ])("maps %s to its message and keeps the wish", async (code, status, message) => {
      const user = userEvent.setup();
      stubFetch(vi.fn(async () => errorReply(status, code)));
      renderDialog();

      await user.click(screen.getByRole("button", { name: "On foot" }));
      await typeWishAndSearch(user, "Tiles");

      expect(await screen.findByTestId("suggestions-error")).toHaveTextContent(message);
      expect(screen.getByLabelText("What would you like to do today?")).toHaveValue("Tiles");
      expect(screen.getByRole("button", { name: "On foot" })).toHaveAttribute("aria-pressed", "true");
    });

    it.each([502, 504])("maps a non-JSON %i from the proxy to the search-failed message", async (status) => {
      const user = userEvent.setup();
      stubFetch(
        vi.fn(async () =>
          mockFetchResponse(undefined, {
            status,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }),
        ),
      );
      renderDialog();
      await typeWishAndSearch(user, "Tiles");
      expect(await screen.findByTestId("suggestions-error")).toHaveTextContent(
        "No ideas could be found just now. Please try again later.",
      );
      expect(screen.getByLabelText("What would you like to do today?")).toHaveValue("Tiles");
    });

    it("maps any other non-JSON reply to the generic message", async () => {
      const user = userEvent.setup();
      stubFetch(
        vi.fn(async () =>
          mockFetchResponse(undefined, {
            status: 500,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }),
        ),
      );
      renderDialog();
      await typeWishAndSearch(user);
      expect(await screen.findByTestId("suggestions-error")).toHaveTextContent("Something went wrong. Please try again.");
    });

    it("maps a 200 without a suggestion list to the generic message", async () => {
      const user = userEvent.setup();
      stubFetch(vi.fn(async () => mockFetchResponse({ data: {}, error: null })));
      renderDialog();
      await typeWishAndSearch(user);
      expect(await screen.findByTestId("suggestions-error")).toHaveTextContent("Something went wrong. Please try again.");
    });

    it("maps a thrown fetch to the network message and keeps the wish", async () => {
      const user = userEvent.setup();
      stubFetch(vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
      renderDialog();
      await typeWishAndSearch(user, "Tiles");
      expect(await screen.findByTestId("suggestions-error")).toHaveTextContent(
        "Unable to reach the server. Please try again.",
      );
      expect(screen.getByLabelText("What would you like to do today?")).toHaveValue("Tiles");
    });

    it("puts a validation error that names the prompt on the field, and any other on the banner", async () => {
      const user = userEvent.setup();
      stubFetch(
        vi
          .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
          .mockResolvedValueOnce(errorReply(400, "validation_error", { fieldErrors: { prompt: ["too long"] } }))
          .mockResolvedValueOnce(errorReply(400, "validation_error", { fieldErrors: { mode: ["bad"] } })),
      );
      renderDialog();

      await typeWishAndSearch(user, "Tiles");
      expect(await screen.findByText("Say briefly what you would like to do.")).toBeInTheDocument();
      expect(screen.queryByTestId("suggestions-error")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Search" }));
      expect(await screen.findByTestId("suggestions-error")).toHaveTextContent("Something went wrong. Please try again.");
    });

    it("clears an earlier result list on error, and the banner on the next search", async () => {
      const user = userEvent.setup();
      stubFetch(
        vi
          .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
          .mockResolvedValueOnce(ok(threeSuggestions()))
          .mockResolvedValueOnce(errorReply(502, "ai_failed"))
          .mockResolvedValueOnce(ok(threeSuggestions())),
      );
      renderDialog();

      await typeWishAndSearch(user);
      expect(await screen.findAllByTestId("suggestion-card")).toHaveLength(3);

      await user.click(screen.getByRole("button", { name: "Search" }));
      await screen.findByTestId("suggestions-error");
      expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0);

      await user.click(screen.getByRole("button", { name: "Search" }));
      expect(await screen.findAllByTestId("suggestion-card")).toHaveLength(3);
      expect(screen.queryByTestId("suggestions-error")).toBeNull();
    });
  });

  describe("closing", () => {
    it("closes silently with nothing ticked", async () => {
      const user = userEvent.setup();
      stubFetch(vi.fn(async () => ok(threeSuggestions())));
      const { onClose } = renderDialog();
      await typeWishAndSearch(user);
      await screen.findAllByTestId("suggestion-card");

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Discard changes?")).toBeNull();
    });

    it("asks once before throwing ticks away, and keeping stays open", async () => {
      const user = userEvent.setup();
      stubFetch(vi.fn(async () => ok(threeSuggestions())));
      const { onClose } = renderDialog();
      await typeWishAndSearch(user);
      const cards = await screen.findAllByTestId("suggestion-card");
      await user.click(within(cards[0]).getByText("Old Harbour"));

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(await screen.findByText("Discard changes?")).toBeInTheDocument();
      expect(screen.getByTestId("discard-changes-body")).toHaveTextContent("Your selection will be lost.");
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(onClose).not.toHaveBeenCalled();
      expect(within(screen.getAllByTestId("suggestion-card")[0]).getByRole("checkbox", { hidden: true })).toBeChecked();

      // The guard's exit transition keeps the dialog behind it aria-hidden for a moment.
      await user.click(await screen.findByRole("button", { name: "Close" }));
      await user.click(await screen.findByRole("button", { name: "Discard changes" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Story 12.3 Task 1. jsdom cannot resolve a breakpoint, so this reads the rules emotion injected for
 * the paper's class instead: the phone-only block exists with the prop and is absent without it.
 * Whether it *looks* right on a phone is a browser check.
 */
describe("TripDaySuggestionsDialog preview and apply (Story 12.4)", () => {
  type Route = (init?: RequestInit) => Response | Promise<Response>;
  /** Search, preview and apply answered by URL; each handler defaults to a success. */
  const routes = (handlers: { search?: Route; preview?: Route; apply?: Route } = {}) =>
    stubFetch(
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
        const url = requestUrl(input);
        if (url.endsWith("/preview")) return (handlers.preview ?? (() => previewReply()))(init);
        if (url.endsWith("/apply")) return (handlers.apply ?? (() => mockFetchResponse({ data: { receipt: RECEIPT }, error: null })))(init);
        return (handlers.search ?? (() => ok(threeSuggestions())))(init);
      }),
    );

  const callsTo = (fetchMock: ReturnType<typeof routes>, suffix: string) =>
    fetchMock.mock.calls.filter(([input]) => requestUrl(input).endsWith(suffix));

  /** Search, tick Old Harbour and Garden Walk, open the preview. */
  const openPreview = async (user: ReturnType<typeof userEvent.setup>) => {
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    await user.click(within(cards[0]).getByText("Old Harbour"));
    await user.click(within(cards[2]).getByText("Garden Walk"));
    await user.click(screen.getByRole("button", { name: "Add (2)" }));
    return screen.findByTestId("suggestions-preview");
  };

  it("shows the visiting order with times, the place, the legs, the origin and the overflow warning", async () => {
    const user = userEvent.setup();
    routes();
    renderDialog({ onApplied: vi.fn() });

    const step = await openPreview(user);

    expect(within(step).getByText("This is how the day would look")).toBeInTheDocument();
    expect(within(step).getByText("From Hotel Ribeira")).toBeInTheDocument();
    const rows = within(step).getAllByTestId("suggestions-preview-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("12 min · 8.4 km");
    expect(rows[0]).toHaveTextContent("09:45–11:45");
    expect(rows[0]).toHaveTextContent("Garden Walk");
    expect(rows[0]).toHaveTextContent("Jardim, Porto");
    expect(rows[1]).toHaveTextContent("Travel time unknown");
    expect(rows[1]).toHaveTextContent("no time");
    expect(rows[1]).toHaveTextContent("Old Harbour");
    expect(within(step).getByTestId("suggestions-overflow")).toHaveTextContent("This runs past midnight.");
    expect(within(step).queryByTestId("suggestions-routing-unavailable")).toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Back to the selection" })).toBeEnabled();
  });

  it("names the trip's start and says calmly when legs could not be calculated", async () => {
    const user = userEvent.setup();
    routes({
      preview: () =>
        previewReply({
          origin: { kind: "tripStart", label: null },
          routingUnavailable: true,
          overflow: false,
          legs: [null, null],
          rows: [
            { fromTime: "10:00", toTime: "12:00" },
            { fromTime: "12:00", toTime: "13:30" },
          ],
        }),
    });
    renderDialog({ onApplied: vi.fn() });
    const step = await openPreview(user);
    expect(within(step).getByText("From the trip's starting point")).toBeInTheDocument();
    expect(within(step).getByTestId("suggestions-routing-unavailable")).toBeInTheDocument();
    expect(within(step).queryByTestId("suggestions-overflow")).toBeNull();
  });

  it("goes back to the selection with the ticks intact", async () => {
    const user = userEvent.setup();
    routes();
    renderDialog({ onApplied: vi.fn() });
    await openPreview(user);

    await user.click(screen.getByRole("button", { name: "Back to the selection" }));

    expect(screen.queryByTestId("suggestions-preview")).toBeNull();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false, true]);
    expect(screen.getByRole("button", { name: "Add (2)" })).toBeEnabled();
  });

  it("applies in visiting order with the searched mode, the preview's legs and basis, and hands over the receipt", async () => {
    const user = userEvent.setup();
    const fetchMock = routes();
    const onApplied = vi.fn();
    renderDialog({ onApplied });

    await user.click(screen.getByRole("button", { name: "On foot" }));
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    // The toggle changes after the search: the list was searched on foot, so the legs stay on foot.
    await user.click(screen.getByRole("button", { name: "Bike" }));
    await user.click(within(cards[0]).getByText("Old Harbour"));
    await user.click(within(cards[2]).getByText("Garden Walk"));
    await user.click(screen.getByRole("button", { name: "Add (2)" }));
    await screen.findByTestId("suggestions-preview");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(RECEIPT));
    const results = threeSuggestions();
    expect(JSON.parse(String(callsTo(fetchMock, "/preview")[0][1]?.body)).mode).toBe("walking");
    expect(JSON.parse(String(callsTo(fetchMock, "/apply")[0][1]?.body))).toEqual({
      mode: "walking",
      suggestions: [results[2], results[0]],
      legs: previewData().legs,
      basis: previewData().basis,
    });
  });

  it("disables both buttons and shows progress while the apply runs", async () => {
    const user = userEvent.setup();
    const hanging = hangingFetch();
    routes({ apply: (init) => hanging.mock("/apply", init) });
    renderDialog({ onApplied: vi.fn() });
    await openPreview(user);

    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Back to the selection" })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("previews again with a note when the day changed since the preview", async () => {
    const user = userEvent.setup();
    const fetchMock = routes({
      apply: () => mockFetchResponse({ data: null, error: { code: "day_plan_changed", message: "changed" } }, { status: 409 }),
    });
    const onApplied = vi.fn();
    renderDialog({ onApplied });
    await openPreview(user);

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByTestId("suggestions-plan-changed")).toHaveTextContent(
      "The day changed in the meantime. The preview has been recalculated.",
    );
    expect(callsTo(fetchMock, "/preview")).toHaveLength(2);
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByTestId("suggestions-error")).toBeNull();
  });

  it.each([
    ["forbidden", 403, "Your role on this trip does not allow this action."],
    ["unauthorized", 401, "Authentication required. Please sign in."],
    ["csrf_invalid", 403, "Invalid security token. Please refresh and try again."],
    ["server_error", 500, "Something went wrong. Please try again."],
    ["validation_error", 400, "Something went wrong. Please try again."],
  ])("maps a failed preview (%s) to the warn banner and keeps the ticks", async (code, status, text) => {
    const user = userEvent.setup();
    routes({ preview: () => mockFetchResponse({ data: null, error: { code, message: code } }, { status }) });
    renderDialog({ onApplied: vi.fn() });
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    await user.click(within(cards[0]).getByText("Old Harbour"));
    await user.click(screen.getByRole("button", { name: "Add (1)" }));

    expect(await screen.findByTestId("suggestions-error")).toHaveTextContent(text);
    expect(screen.queryByTestId("suggestions-preview")).toBeNull();
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  });

  it("maps a failed apply to the warn banner and stays on the preview", async () => {
    const user = userEvent.setup();
    routes({ apply: () => Promise.reject(new TypeError("Failed to fetch")) });
    const onApplied = vi.fn();
    renderDialog({ onApplied });
    await openPreview(user);

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByTestId("suggestions-error")).toHaveTextContent(
      "Unable to reach the server. Please try again.",
    );
    expect(screen.getByTestId("suggestions-preview")).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("aborts a running preview when closed", async () => {
    const user = userEvent.setup();
    const hanging = hangingFetch();
    routes({ preview: (init) => hanging.mock("/preview", init) });
    const { onClose } = renderDialog({ onApplied: vi.fn() });
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    await user.click(within(cards[0]).getByText("Old Harbour"));
    await user.click(screen.getByRole("button", { name: "Add (1)" }));
    await waitFor(() => expect(hanging.mock).toHaveBeenCalledTimes(1));
    const signal = hanging.mock.mock.calls[0]?.[1]?.signal;

    await user.click(screen.getByRole("button", { name: "Close" }));
    // Ticks ask before closing; confirm the discard.
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));

    expect(signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DialogShell fullScreenOnPhone", () => {
  const phoneRulesForPaper = () => {
    const paper = document.querySelector(".MuiDialog-paper");
    const classes = Array.from(paper?.classList ?? []).filter((name) => name.startsWith("css-"));
    const css = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    return classes.flatMap((name) => {
      const pattern = new RegExp(`@media \\(max-width:\\s*599\\.95px\\)\\s*\\{\\s*\\.${name}\\{([^}]*)\\}`, "g");
      return Array.from(css.matchAll(pattern), (match) => match[1]);
    });
  };

  it("adds no phone-only paper rule by default", () => {
    renderWithProviders(
      <DialogShell open onClose={() => {}} title="Plain" width={460} footer={null} closeLabel="Close">
        body
      </DialogShell>,
    );
    expect(phoneRulesForPaper()).toEqual([]);
  });

  it("fills the phone screen when asked", () => {
    renderWithProviders(
      <DialogShell open onClose={() => {}} title="Full" width={520} footer={null} closeLabel="Close" fullScreenOnPhone>
        body
      </DialogShell>,
    );
    const [rule] = phoneRulesForPaper();
    expect(rule).toContain("margin:0");
    expect(rule).toContain("border-radius:0");
    expect(rule).toContain("height:100%");
    expect(rule).toContain("max-height:100%");
  });
});
