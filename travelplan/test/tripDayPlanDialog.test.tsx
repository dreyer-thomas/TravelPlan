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
      gutterBottom,
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
    void gutterBottom;
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

  it("renders add mode as form-only and saves via POST", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

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

      if (url.includes("/api/geocode")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { result: { lat: 48.145, lng: 11.582, label: "Museum" } },
            error: null,
          }),
        };
      }

      if (url.includes("/day-plan-items") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              dayPlanItem: {
                id: "item-1",
                tripDayId: "day-1",
                contentJson: tiptapMocks.sampleDoc,
                linkUrl: "https://example.com/plan",
                location: null,
                createdAt: new Date().toISOString(),
              },
            },
            error: null,
          }),
        };
      }

      return {
        ok: false,
        status: 500,
        json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Add plan item")).toBeInTheDocument();
    expect(screen.queryByText("Plan items")).not.toBeInTheDocument();
    expect(screen.queryByText("No plan items yet.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search place")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
    expect(screen.queryByLabelText("Location label (optional)")).toBeNull();
    expect(screen.getByText("No coordinates selected")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com/plan" } });
    fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Museum" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() => expect(screen.getByText("Latitude: 48.145000 · Longitude: 11.582000")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/day-plan-items") && call[1]?.method === "POST");
    expect(postCall).toBeDefined();
    const requestBody = JSON.parse(String(postCall?.[1]?.body ?? "{}"));
    expect(requestBody.location).toEqual({ lat: 48.145, lng: 11.582, label: "Museum" });

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("renders edit mode with prefilled values and saves via PATCH", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

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

      if (url.includes("/day-plan-items") && method === "PATCH") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              dayPlanItem: {
                id: "item-1",
                tripDayId: "day-1",
                contentJson: tiptapMocks.sampleDoc,
                linkUrl: "https://example.com/updated",
                location: { lat: 48.1372, lng: 11.5756, label: "Old Town" },
                createdAt: new Date().toISOString(),
              },
            },
            error: null,
          }),
        };
      }

      return {
        ok: false,
        status: 500,
        json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            contentJson: tiptapMocks.sampleDoc,
            linkUrl: "https://example.com/original",
            location: { lat: 48.1372, lng: 11.5756, label: "Old Town" },
            createdAt: "2026-12-01T09:00:00.000Z",
          }}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Edit plan item")).toBeInTheDocument();
    expect(screen.getByLabelText("Link")).toHaveValue("https://example.com/original");
    expect(screen.getByText("Latitude: 48.137200 · Longitude: 11.575600")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com/updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Update item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
