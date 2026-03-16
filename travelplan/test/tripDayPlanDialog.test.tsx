// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";
import * as React from "react";
import type { ChangeEvent, ReactNode } from "react";

const tiptapMocks = vi.hoisted(() => ({
  updatedFlag: { value: false },
  doc: { value: null as null | unknown },
  activeMarks: { value: new Set<string>() },
  editorInstance: {
    value: null as null | {
      commands: { setContent: (doc: unknown) => void; setImage: (attrs: { src: string }) => void };
      getJSON: () => unknown;
      isActive: (name: string) => boolean;
      chain: () => {
        focus: () => unknown;
        toggleBold: () => unknown;
        toggleItalic: () => unknown;
        toggleBulletList: () => unknown;
        run: () => boolean;
      };
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
    FormControl: Simple,
    FormHelperText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    FormLabel: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Radio: ({ ...rest }: { [key: string]: unknown }) => <input type="radio" {...omitLayoutProps(rest)} />,
    RadioGroup: ({
      children,
      value,
      onChange,
    }: {
      children?: ReactNode;
      value?: string;
      onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    }) => (
      <div role="radiogroup">
        {Array.isArray(children)
          ? children.map((child, index) =>
              child && typeof child === "object"
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (React.cloneElement(child as any, { groupValue: value, onGroupChange: onChange, key: index }) as ReactNode)
                : child,
            )
          : children &&
              typeof children === "object" &&
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              React.cloneElement(children as any, { groupValue: value, onGroupChange: onChange })}
      </div>
    ),
    FormControlLabel: ({
      label,
      value,
      groupValue,
      onGroupChange,
    }: {
      label?: string;
      value?: string;
      groupValue?: string;
      onGroupChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    }) => (
      <label>
        <input
          type="radio"
          aria-label={label}
          value={value}
          checked={groupValue === value}
          onChange={(event) => onGroupChange?.(event)}
        />
        <span>{label}</span>
      </label>
    ),
    SvgIcon: Simple,
    TextField: ({
      label,
      value,
      onChange,
      helperText,
      error,
      inputProps,
      ...rest
    }: {
      label?: string;
      value?: string;
      onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
      helperText?: ReactNode;
      error?: boolean;
      inputProps?: Record<string, unknown>;
    }) => (
      <label>
        <span>{label}</span>
        <input
          aria-label={label}
          aria-invalid={error ? "true" : "false"}
          value={value ?? ""}
          onChange={onChange}
          {...inputProps}
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
    const appendImageNode = (src: string) => {
      const current = tiptapMocks.doc.value as
        | { type?: string; content?: Array<{ type?: string; attrs?: { src?: string } }> }
        | null;
      const content = Array.isArray(current?.content) ? [...current.content] : [];
      content.push({ type: "image", attrs: { src } });
      tiptapMocks.doc.value = { type: "doc", content };
    };

    if (!tiptapMocks.editorInstance.value) {
      tiptapMocks.doc.value = JSON.parse(tiptapMocks.sampleDoc);
      const chainState = {} as {
        focus: () => typeof chainState;
        toggleBold: () => typeof chainState;
        toggleItalic: () => typeof chainState;
        toggleBulletList: () => typeof chainState;
        setLink: (_value: { href: string }) => typeof chainState;
        setImage: (value: { src: string }) => typeof chainState;
        run: () => boolean;
      };
      chainState.focus = () => chainState;
      chainState.toggleBold = () => chainState;
      chainState.toggleItalic = () => chainState;
      chainState.toggleBulletList = () => chainState;
      chainState.setLink = () => chainState;
      chainState.setImage = ({ src }: { src: string }) => {
        appendImageNode(src);
        return chainState;
      };
      chainState.run = () => {
        options?.onUpdate?.({ editor: tiptapMocks.editorInstance.value! });
        return true;
      };
      tiptapMocks.editorInstance.value = {
        commands: {
          setContent: (doc: unknown) => {
            tiptapMocks.doc.value = doc;
            options?.onUpdate?.({ editor: tiptapMocks.editorInstance.value! });
          },
          setImage: ({ src }: { src: string }) => {
            appendImageNode(src);
            options?.onUpdate?.({ editor: tiptapMocks.editorInstance.value! });
          },
        },
        getJSON: () => tiptapMocks.doc.value,
        isActive: (name: string) => tiptapMocks.activeMarks.value.has(name),
        chain: () => chainState,
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
    tiptapMocks.activeMarks.value.clear();
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
                title: "Museum",
                fromTime: "09:00",
                toTime: "10:00",
                contentJson: tiptapMocks.sampleDoc,
                costCents: 2600,
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Add plan item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
    expect(screen.queryByText("Plan items")).not.toBeInTheDocument();
    expect(screen.queryByText("No plan items yet.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search place")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
    expect(screen.queryByLabelText("Location label (optional)")).toBeNull();
    expect(screen.getByText("No coordinates selected")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.com/plan" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Museum" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "26,00" } });
    vi.spyOn(window, "prompt").mockReturnValue("https://images.example.com/plan.webp");
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
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
    expect(requestBody.title).toBe("Museum");
    expect(requestBody.fromTime).toBe("09:00");
    expect(requestBody.toTime).toBe("10:00");
    expect(requestBody.costCents).toBe(2600);
    expect(requestBody.payments).toEqual([{ amountCents: 2600, dueDate: "2026-11-01" }]);
    expect(requestBody.location).toEqual({ lat: 48.145, lng: 11.582, label: "Museum" });
    const parsedDoc = JSON.parse(requestBody.contentJson) as { content?: Array<{ type?: string; attrs?: { src?: string } }> };
    expect(parsedDoc.content?.some((node) => node.type === "image" && node.attrs?.src === "https://images.example.com/plan.webp")).toBe(
      true,
    );

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
                title: "Old Town walk",
                fromTime: "11:00",
                toTime: "12:00",
                contentJson: tiptapMocks.sampleDoc,
                costCents: 3400,
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Old Town walk",
            fromTime: "10:00",
            toTime: "11:00",
            contentJson: tiptapMocks.sampleDoc,
            costCents: 2100,
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
    expect(screen.getByLabelText("Title")).toHaveValue("Old Town walk");
    expect(screen.getByLabelText("From")).toHaveValue("10:00");
    expect(screen.getByLabelText("To")).toHaveValue("11:00");
    expect(screen.getByLabelText("Cost")).toHaveValue("21.00");
    expect(screen.getByRole("textbox", { name: "Link" })).toHaveValue("https://example.com/original");
    expect(screen.getByText("Latitude: 48.137200 · Longitude: 11.575600")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "34,00" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated walk" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "12:00" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.com/updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Update item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const patchCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/day-plan-items") && call[1]?.method === "PATCH",
    );
    const patchBody = JSON.parse(String(patchCall?.[1]?.body ?? "{}"));
    expect(patchBody.title).toBe("Updated walk");
    expect(patchBody.fromTime).toBe("11:00");
    expect(patchBody.toTime).toBe("12:00");
    expect(patchBody.costCents).toBe(3400);
    expect(patchBody.payments).toEqual([{ amountCents: 3400, dueDate: "2026-11-01" }]);

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("shows delete action only for existing items and closes after delete", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: {}, error: null }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);
    const onDelete = vi.fn(async () => true);
    const onClose = vi.fn();

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Old Town walk",
            fromTime: "10:00",
            toTime: "11:00",
            contentJson: tiptapMocks.sampleDoc,
            costCents: 2100,
            linkUrl: "https://example.com/original",
            location: { lat: 48.1372, lng: 11.5756, label: "Old Town" },
            createdAt: "2026-12-01T09:00:00.000Z",
          }}
          onDelete={onDelete}
          onClose={onClose}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("item-1"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("hides delete action for new items", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ data: {}, error: null }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("shows title validation error and blocks completion when server rejects empty title", async () => {
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

      if (url.includes("/day-plan-items") && method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            data: null,
            error: {
              code: "validation_error",
              message: "Validation failed",
              details: { fieldErrors: { title: ["Title is required"] } },
            },
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
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " " } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(screen.getByText("Title is required")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows time validation errors from API", async () => {
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

      if (url.includes("/day-plan-items") && method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            data: null,
            error: {
              code: "validation_error",
              message: "Validation failed",
              details: { fieldErrors: { fromTime: ["From time is required"], toTime: ["To time must be after from time"] } },
            },
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

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/day-plan-items"), expect.any(Object)));
    expect(screen.getByText("From time is required")).toBeInTheDocument();
    expect(screen.getByText("To time must be after from time")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "12:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "13:30" } });
    expect(screen.queryByText("From time is required")).not.toBeInTheDocument();
    expect(screen.queryByText("To time must be after from time")).not.toBeInTheDocument();
  });

  it("blocks save when split payments do not match the total cost", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ data: null, error: { code: "not_found", message: "Not found" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Tickets" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "100.00" } });
    fireEvent.click(screen.getByLabelText("Split into multiple payments"));

    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    fireEvent.change(amountInputs[0], { target: { value: "40.00" } });
    fireEvent.change(dateInputs[0], { target: { value: "2026-11-01" } });
    fireEvent.change(amountInputs[1], { target: { value: "50.00" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-11-02" } });

    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByText("Payments must add up to the total cost")).toBeInTheDocument();
    const saveCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/day-plan-items"));
    expect(saveCalls).toHaveLength(0);
  });

  it("loads payment schedule when editing an existing plan item", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Museum",
            fromTime: "09:00",
            toTime: "10:00",
            contentJson: "{\"type\":\"doc\"}",
            costCents: 12000,
            payments: [
              { amountCents: 5000, dueDate: "2026-11-01" },
              { amountCents: 7000, dueDate: "2026-11-02" },
            ],
            linkUrl: null,
            location: null,
            createdAt: new Date().toISOString(),
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    const splitOption = await screen.findByLabelText("Split into multiple payments");
    expect(splitOption).toBeChecked();
    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    expect(amountInputs[0]).toHaveValue(50);
    expect(amountInputs[1]).toHaveValue(70);
    expect(dateInputs[0]).toHaveValue("2026-11-01");
    expect(dateInputs[1]).toHaveValue("2026-11-02");
  });

  it("supports multi-file gallery selection and upload for existing day items", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    let uploadCount = 0;
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

      if (url.includes("/day-plan-items/images?") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }

      if (url.includes("/day-plan-items/images") && method === "POST") {
        uploadCount += 1;
        const body = init?.body as FormData;
        const file = body.get("file");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              image: {
                id: `image-${uploadCount}`,
                imageUrl: `https://images.example.com/${file instanceof File ? file.name : `image-${uploadCount}.webp`}`,
                sortOrder: uploadCount,
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

    const { container } = render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Museum",
            fromTime: "09:00",
            toTime: "10:00",
            contentJson: tiptapMocks.sampleDoc,
            costCents: 1200,
            linkUrl: null,
            location: null,
            createdAt: new Date().toISOString(),
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    expect(fileInput?.multiple).toBe(true);

    const fileOne = new File(["first"], "first.webp", { type: "image/webp" });
    const fileTwo = new File(["second"], "second.webp", { type: "image/webp" });
    fireEvent.change(fileInput!, { target: { files: [fileOne, fileTwo] } });

    expect(screen.getByText("2 file(s) selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      const uploadCalls = fetchMock.mock.calls.filter(
        (call) => String(call[0]).includes("/day-plan-items/images") && call[1]?.method === "POST",
      );
      expect(uploadCalls).toHaveLength(2);
    });

    expect(container.querySelectorAll('[component="img"][alt="Gallery thumbnail"]')).toHaveLength(2);
  });

  it("fetches a fresh CSRF token for gallery uploads when initialization did not provide one", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    let csrfRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        csrfRequests += 1;
        if (csrfRequests === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { csrfToken: "late-token" }, error: null }),
        };
      }

      if (url.includes("/day-plan-items/images?") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }

      if (url.includes("/day-plan-items/images") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              image: { id: "image-1", imageUrl: "https://images.example.com/one.webp", sortOrder: 1 },
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

    const { container } = render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Museum",
            fromTime: "09:00",
            toTime: "10:00",
            contentJson: tiptapMocks.sampleDoc,
            costCents: 1200,
            linkUrl: null,
            location: null,
            createdAt: new Date().toISOString(),
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["first"], "first.webp", { type: "image/webp" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items/images"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "x-csrf-token": "late-token" }),
        }),
      ),
    );
  });

  it("keeps successfully uploaded images visible when a later file upload fails", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    let uploadCount = 0;
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

      if (url.includes("/day-plan-items/images?") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }

      if (url.includes("/day-plan-items/images") && method === "POST") {
        uploadCount += 1;
        if (uploadCount === 2) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
          };
        }

        const body = init?.body as FormData;
        const file = body.get("file");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              image: {
                id: "image-1",
                imageUrl: `https://images.example.com/${file instanceof File ? file.name : "first.webp"}`,
                sortOrder: 1,
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

    const { container } = render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Museum",
            fromTime: "09:00",
            toTime: "10:00",
            contentJson: tiptapMocks.sampleDoc,
            costCents: 1200,
            linkUrl: null,
            location: null,
            createdAt: new Date().toISOString(),
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const fileOne = new File(["first"], "first.webp", { type: "image/webp" });
    const fileTwo = new File(["second"], "second.webp", { type: "image/webp" });
    fireEvent.change(fileInput, { target: { files: [fileOne, fileTwo] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(screen.getByText("Plan item update failed. Please try again.")).toBeInTheDocument());
    expect(container.querySelectorAll('[component="img"][alt="Gallery thumbnail"]')).toHaveLength(1);
    expect(screen.getByText("1 file(s) selected")).toBeInTheDocument();
  });

  it("localizes the selected gallery file summary", async () => {
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

      if (url.includes("/day-plan-items/images?") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { images: [] }, error: null }),
        };
      }

      return {
        ok: false,
        status: 500,
        json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <I18nProvider initialLanguage="de">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Museum",
            fromTime: "09:00",
            toTime: "10:00",
            contentJson: tiptapMocks.sampleDoc,
            costCents: 1200,
            linkUrl: null,
            location: null,
            createdAt: new Date().toISOString(),
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["first"], "first.webp", { type: "image/webp" })] } });

    expect(screen.getByText("1 Datei(en) ausgewahlt")).toBeInTheDocument();
  });

  it("uses compact thumbnail actions for saved gallery images and keeps fullscreen preview", async () => {
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

      if (url.includes("/day-plan-items/images?") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              images: [
                { id: "image-1", imageUrl: "https://images.example.com/one.webp", sortOrder: 1 },
              ],
            },
            error: null,
          }),
        };
      }

      if (url.includes("/day-plan-items/images") && method === "DELETE") {
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

    const { container } = render(
      <I18nProvider initialLanguage="en">
        <TripDayPlanDialog
          open
          mode="edit"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={{
            id: "item-1",
            tripDayId: "day-1",
            title: "Museum",
            fromTime: "09:00",
            toTime: "10:00",
            contentJson: tiptapMocks.sampleDoc,
            costCents: 1200,
            linkUrl: null,
            location: null,
            createdAt: new Date().toISOString(),
          }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[component="img"][alt="Gallery thumbnail"]')).not.toBeNull(),
    );
    const thumbnail = container.querySelector('[component="img"][alt="Gallery thumbnail"]') as HTMLElement;
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Down" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();

    fireEvent.click(thumbnail);
    await waitFor(() =>
      expect(container.querySelectorAll('[component="img"][alt="Gallery thumbnail"]')).toHaveLength(2),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items/images"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
