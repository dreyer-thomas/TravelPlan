// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import type { ChangeEvent, ReactNode } from "react";

const tiptapMocks = vi.hoisted(() => ({
  updatedFlag: { value: false },
  doc: { value: null as null | unknown },
  editorInstance: {
    value: null as null | {
      commands: { setContent: (doc: unknown) => void };
      getJSON: () => unknown;
    },
  },
  sampleDoc: JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
  }),
}));

vi.mock("@mui/material", () => {
  const omitLayoutProps = (props: Record<string, unknown>) => {
    const {
      alignItems,
      justifyContent,
      flexWrap,
      flexDirection,
      fullWidth,
      maxWidth,
      divider,
      dividers,
      disablePadding,
      ...rest
    } = props;
    void alignItems;
    void justifyContent;
    void flexWrap;
    void flexDirection;
    void fullWidth;
    void maxWidth;
    void divider;
    void dividers;
    void disablePadding;
    return rest;
  };
  const Simple = ({ children, ...rest }: { children?: ReactNode }) => (
    <div {...omitLayoutProps(rest as Record<string, unknown>)}>{children}</div>
  );
  return {
    __esModule: true,
    Alert: Simple,
    Box: Simple,
    Button: ({ children, ...rest }: { children?: ReactNode }) => (
      <button {...omitLayoutProps(rest as Record<string, unknown>)}>{children}</button>
    ),
    CircularProgress: () => <div role="progressbar" />,
    Dialog: Simple,
    DialogTitle: Simple,
    DialogContent: Simple,
    DialogActions: Simple,
    Divider: () => <hr />,
    Link: ({ children, ...rest }: { children?: ReactNode }) => (
      <a {...omitLayoutProps(rest as Record<string, unknown>)} href={typeof rest["href"] === "string" ? rest["href"] : "#"}>
        {children}
      </a>
    ),
    List: ({ children, ...rest }: { children?: ReactNode }) => (
      <ul {...omitLayoutProps(rest as Record<string, unknown>)}>{children}</ul>
    ),
    ListItem: ({
      children,
      secondaryAction,
      ...rest
    }: {
      children?: ReactNode;
      secondaryAction?: ReactNode;
    }) => (
      <li {...omitLayoutProps(rest as Record<string, unknown>)}>
        {children}
        {secondaryAction}
      </li>
    ),
    ListItemText: ({ primary, secondary }: { primary?: ReactNode; secondary?: ReactNode }) => (
      <span>
        {primary}
        {secondary}
      </span>
    ),
    TextField: ({
      label,
      value,
      onChange,
      helperText,
      error,
      ...rest
    }: {
      label?: string;
      value?: string;
      onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
      helperText?: ReactNode;
      error?: boolean;
    }) => (
      <label>
        <span>{label}</span>
        <input
          aria-label={label}
          aria-invalid={error ? "true" : "false"}
          value={value ?? ""}
          onChange={onChange}
          {...omitLayoutProps(rest as Record<string, unknown>)}
        />
        {helperText && <span>{helperText}</span>}
      </label>
    ),
    Typography: Simple,
  };
});

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="tiptap-editor" />,
  useEditor: (options: { onUpdate?: (args: { editor: { getJSON: () => unknown } }) => void }) => {
    if (!tiptapMocks.editorInstance.value) {
      tiptapMocks.doc.value = JSON.parse(tiptapMocks.sampleDoc);
      tiptapMocks.editorInstance.value = {
        commands: {
          setContent: (doc: unknown) => {
            tiptapMocks.doc.value = doc;
            options?.onUpdate?.({ editor: tiptapMocks.editorInstance.value! });
          },
        },
        getJSON: () => tiptapMocks.doc.value,
      };
    }
    const editor = tiptapMocks.editorInstance.value;

    if (options?.onUpdate && !tiptapMocks.updatedFlag.value) {
      tiptapMocks.updatedFlag.value = true;
      options.onUpdate({ editor });
    }

    return editor;
  },
}));

vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));

describe("TripDayPlanDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    tiptapMocks.updatedFlag.value = false;
    tiptapMocks.doc.value = null;
    tiptapMocks.editorInstance.value = null;
  });

  it("adds, edits, and deletes a day plan item", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
    const items: {
      id: string;
      tripDayId: string;
      contentJson: string;
      linkUrl: string | null;
      createdAt: string;
    }[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      if (url.includes("/day-plan-items") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { items }, error: null }),
        };
      }

      if (url.includes("/day-plan-items") && method === "POST") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const created = {
          id: "item-1",
          tripDayId: body.tripDayId,
          contentJson: body.contentJson,
          linkUrl: body.linkUrl ?? null,
          createdAt: new Date().toISOString(),
        };
        items.splice(0, items.length, created);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { dayPlanItem: created }, error: null }),
        };
      }

      if (url.includes("/day-plan-items") && method === "PATCH") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const updated = {
          ...items[0],
          contentJson: body.contentJson,
          linkUrl: body.linkUrl ?? null,
        };
        items.splice(0, items.length, updated);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { dayPlanItem: updated }, error: null }),
        };
      }

      if (url.includes("/day-plan-items") && method === "DELETE") {
        items.splice(0, items.length);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { deleted: true }, error: null }),
        };
      }

      return {
        ok: false,
        status: 500,
        json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          tripId="trip-1"
          day={{ id: "day-1", dayIndex: 1 }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText("No plan items yet.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com/plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("Plan item")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit item" }));
    const linkInput = screen.getByLabelText("Link");
    fireEvent.change(linkInput, { target: { value: "" } });
    fireEvent.change(linkInput, { target: { value: "https://example.com/updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Update item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(await screen.findByText("No plan items yet.")).toBeInTheDocument();
  });
});
