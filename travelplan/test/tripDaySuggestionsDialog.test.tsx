// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DialogShell from "@/components/ui/DialogShell";
import TripDaySuggestionsDialog, {
  type TripDaySuggestionsDialogProps,
} from "@/components/features/trips/TripDaySuggestionsDialog";
import type { DaySuggestion } from "@/lib/validation/daySuggestionSchemas";
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
    await waitFor(() => expect(screen.queryByTestId("suggestions-error")).toBeNull());
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

    release(ok([suggestion({ title: "Port Wine Cellar" }), suggestion({ title: "Bridge Climb" })]));
    expect(await screen.findByText("2 ideas found")).toBeInTheDocument();
    expect(screen.getAllByTestId("suggestion-card")).toHaveLength(2);
    expect(screen.queryByText("Old Harbour")).toBeNull();
    screen.getAllByRole("checkbox").forEach((checkbox) => expect(checkbox).not.toBeChecked());
  });

  it("renders no apply button without onApply", async () => {
    const user = userEvent.setup();
    stubFetch(vi.fn(async () => ok(threeSuggestions())));
    renderDialog();
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    await user.click(within(cards[0]).getByText("Old Harbour"));
    expect(screen.queryByRole("button", { name: /^Add/ })).toBeNull();
  });

  it("with onApply, enables the apply button from one tick and hands over the ticked suggestions in list order", async () => {
    const user = userEvent.setup();
    const results = threeSuggestions();
    stubFetch(vi.fn(async () => ok(results)));
    const onApply = vi.fn();
    renderDialog({ onApply });

    expect(screen.getByRole("button", { name: "Add (0)" })).toBeDisabled();
    await typeWishAndSearch(user);
    const cards = await screen.findAllByTestId("suggestion-card");
    expect(screen.getByRole("button", { name: "Add (0)" })).toBeDisabled();

    await user.click(within(cards[2]).getByText("Garden Walk"));
    await user.click(within(cards[0]).getByText("Old Harbour"));
    const apply = screen.getByRole("button", { name: "Add (2)" });
    expect(apply).toBeEnabled();

    await user.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([results[0], results[2]]);
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
