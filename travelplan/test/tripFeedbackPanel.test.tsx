// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripFeedbackPanel, { type FeedbackSummary } from "@/components/features/trips/TripFeedbackPanel";
import { I18nProvider } from "@/i18n/provider";

const setMatchMedia = (width: number) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => {
      const maxWidthMatch = /max-width:\s*(\d+(\.\d+)?)px/.exec(query);
      const minWidthMatch = /min-width:\s*(\d+(\.\d+)?)px/.exec(query);
      const maxWidth = maxWidthMatch ? Number(maxWidthMatch[1]) : Infinity;
      const minWidth = minWidthMatch ? Number(minWidthMatch[1]) : 0;
      const matches = width >= minWidth && width <= maxWidth;
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      };
    },
  });
};

const buildFeedback = (overrides?: Partial<FeedbackSummary>): FeedbackSummary => ({
  targetType: "dayPlanItem",
  targetId: "item-1",
  comments: [],
  voteSummary: {
    upCount: 0,
    downCount: 0,
    userVote: null,
  },
  ...overrides,
});

describe("TripFeedbackPanel", () => {
  beforeEach(() => {
    setMatchMedia(1280);
  });

  it("renders a compact summary trigger with numeric comment count and vote counts", () => {
    render(
      <I18nProvider initialLanguage="en">
        <TripFeedbackPanel
          tripId="trip-1"
          targetType="dayPlanItem"
          targetId="item-1"
          currentUserId="u1"
          contextLabel="Day 1"
          feedback={buildFeedback()}
          onUpdated={vi.fn()}
        />
      </I18nProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Open comments dialog for Day 1, no comments, Upvote 0, Downvote 0",
    });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a comment")).not.toBeInTheDocument();
    expect(within(trigger).getAllByText("0").length).toBeGreaterThanOrEqual(3);
  });

  it("renders numeric comment counts without visible copy text", () => {
    const oneComment = buildFeedback({
      comments: [{ id: "comment-1", body: "First", createdAt: "", updatedAt: "", author: { id: "u1", email: "a@example.com" } }],
    });
    const manyComments = buildFeedback({
      comments: [
        { id: "comment-1", body: "First", createdAt: "", updatedAt: "", author: { id: "u1", email: "a@example.com" } },
        { id: "comment-2", body: "Second", createdAt: "", updatedAt: "", author: { id: "u2", email: "b@example.com" } },
      ],
    });

    const { rerender } = render(
      <I18nProvider initialLanguage="en">
        <TripFeedbackPanel
          tripId="trip-1"
          targetType="dayPlanItem"
          targetId="item-1"
          currentUserId="u1"
          contextLabel="Day 1"
          feedback={oneComment}
          onUpdated={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("1")).toBeInTheDocument();

    rerender(
      <I18nProvider initialLanguage="en">
        <TripFeedbackPanel
          tripId="trip-1"
          targetType="dayPlanItem"
          targetId="item-1"
          currentUserId="u1"
          contextLabel="Day 1"
          feedback={manyComments}
          onUpdated={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders comment-only feedback targets without vote counts or vote actions", async () => {
    render(
      <I18nProvider initialLanguage="en">
        <TripFeedbackPanel
          tripId="trip-1"
          targetType="tripDay"
          targetId="day-1"
          currentUserId="u1"
          contextLabel="Day 1"
          feedback={buildFeedback({ targetType: "tripDay", targetId: "day-1" })}
          onUpdated={vi.fn()}
        />
      </I18nProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Open comments dialog for Day 1, no comments",
    });
    expect(trigger).toBeInTheDocument();
    expect(within(trigger).queryByText("Upvote")).not.toBeInTheDocument();

    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Comments for Day 1" });
    expect(within(dialog).queryByRole("button", { name: /Upvote/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Downvote/i })).not.toBeInTheDocument();
  });

  it("opens in a dialog, submits comment and vote updates, and returns focus to the trigger", async () => {
    const onUpdated = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/auth/csrf") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/feedback/comments") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              feedback: buildFeedback({
                comments: [
                  {
                    id: "comment-1",
                    body: "Looks promising",
                    createdAt: "",
                    updatedAt: "",
                    author: { id: "u1", email: "viewer@example.com" },
                  },
                ],
              }),
            },
            error: null,
          }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/feedback/votes") && method === "PUT") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              feedback: buildFeedback({
                comments: [
                  {
                    id: "comment-1",
                    body: "Looks promising",
                    createdAt: "",
                    updatedAt: "",
                    author: { id: "u1", email: "viewer@example.com" },
                  },
                ],
                voteSummary: {
                  upCount: 1,
                  downCount: 0,
                  userVote: "up",
                },
              }),
            },
            error: null,
          }),
        };
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    const Harness = () => {
      const [feedback, setFeedback] = React.useState(buildFeedback());
      return (
        <TripFeedbackPanel
          tripId="trip-1"
          targetType="dayPlanItem"
          targetId="item-1"
          currentUserId="u1"
          contextLabel="Day 1"
          feedback={feedback}
          onUpdated={(next) => {
            setFeedback(next);
            onUpdated(next);
          }}
        />
      );
    };

    render(
      <I18nProvider initialLanguage="en">
        <Harness />
      </I18nProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Open comments dialog for Day 1, no comments, Upvote 0, Downvote 0",
    });
    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Suggestions and votes for Day 1" });
    expect(within(dialog).getByLabelText("Add a comment")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("Add a comment"), "Looks promising");
    await userEvent.click(within(dialog).getByRole("button", { name: "Post comment" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(screen.getByText("1")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Upvote 0" }));

    await waitFor(() =>
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: expect.arrayContaining([expect.objectContaining({ body: "Looks promising" })]),
          voteSummary: expect.objectContaining({ upCount: 1, downCount: 0, userVote: "up" }),
        }),
      ),
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Close comments dialog for Day 1" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Suggestions and votes for Day 1" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open comments dialog for Day 1, 1 comment, Upvote 1, Downvote 0" })).toHaveFocus();

    vi.unstubAllGlobals();
  });

  it("uses a mobile-friendly full-screen dialog on narrow layouts", async () => {
    setMatchMedia(360);

    render(
      <I18nProvider initialLanguage="en">
        <TripFeedbackPanel
          tripId="trip-1"
          targetType="dayPlanItem"
          targetId="item-1"
          currentUserId="u1"
          contextLabel="Day 1"
          feedback={buildFeedback()}
          onUpdated={vi.fn()}
        />
      </I18nProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Open comments dialog for Day 1, no comments, Upvote 0, Downvote 0",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Suggestions and votes for Day 1" });
    expect(dialog.closest(".MuiDialog-paperFullScreen")).not.toBeNull();
  });

  it("shows edit controls only for authored comments and supports save and cancel flows", async () => {
    const onUpdated = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/auth/csrf") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.endsWith("/api/trips/trip-1/feedback/comments/comment-1") && method === "PUT") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              feedback: buildFeedback({
                comments: [
                  {
                    id: "comment-1",
                    body: "Edited body",
                    createdAt: "",
                    updatedAt: "",
                    author: { id: "u1", email: "viewer@example.com" },
                  },
                  {
                    id: "comment-2",
                    body: "Other comment",
                    createdAt: "",
                    updatedAt: "",
                    author: { id: "u2", email: "other@example.com" },
                  },
                ],
              }),
            },
            error: null,
          }),
        };
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    }) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    const Harness = () => {
      const [feedback, setFeedback] = React.useState(
        buildFeedback({
          comments: [
            {
              id: "comment-1",
              body: "Original body",
              createdAt: "",
              updatedAt: "",
              author: { id: "u1", email: "viewer@example.com" },
            },
            {
              id: "comment-2",
              body: "Other comment",
              createdAt: "",
              updatedAt: "",
              author: { id: "u2", email: "other@example.com" },
            },
          ],
        }),
      );

      return (
        <TripFeedbackPanel
          tripId="trip-1"
          targetType="dayPlanItem"
          targetId="item-1"
          currentUserId="u1"
          contextLabel="Day 1"
          feedback={feedback}
          onUpdated={(next) => {
            setFeedback(next);
            onUpdated(next);
          }}
        />
      );
    };

    render(
      <I18nProvider initialLanguage="en">
        <Harness />
      </I18nProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Open comments dialog for Day 1, 2 comments, Upvote 0, Downvote 0",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Suggestions and votes for Day 1" });
    expect(within(dialog).getByRole("button", { name: "Edit your comment: Original body" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Edit your comment: Other comment" })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Edit your comment: Original body" }));
    const editor = within(dialog).getByLabelText("Edit comment");
    expect(editor).toHaveValue("Original body");

    await userEvent.clear(editor);
    await userEvent.type(editor, "Draft edit");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel edit" }));
    expect(within(dialog).queryByLabelText("Edit comment")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Original body")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Edit your comment: Original body" }));
    const activeEditor = within(dialog).getByLabelText("Edit comment");
    await userEvent.clear(activeEditor);
    await userEvent.type(activeEditor, "Edited body");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save comment" }));

    await waitFor(() =>
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: expect.arrayContaining([expect.objectContaining({ id: "comment-1", body: "Edited body" })]),
        }),
      ),
    );
    expect(within(dialog).getByText("Edited body")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
