// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "./helpers/renderWithProviders";
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
  // MUI-only props that must not reach the DOM. `component` is handled separately — Story 7.7's
  // primitives use `Box component="input"|"img"|"button"`, so the mock has to render the real
  // element rather than leaking `component` onto a <div>.
  const MUI_ONLY_PROPS = new Set([
    "alignItems",
    "justifyContent",
    "flexWrap",
    "flexDirection",
    "fullWidth",
    "fullScreen",
    "maxWidth",
    "divider",
    "dividers",
    "disablePadding",
    "gutterBottom",
    "sx",
    "slotProps",
    "open",
    "onClose",
    "display",
    "gap",
    "mt",
    "mb",
    "flex",
    "minWidth",
    "minRows",
    "multiline",
    "variant",
    "size",
    "elevation",
    // Story 6.22: `Tab`'s icon slot placement. `icon` itself is rendered by the mock below.
    "iconPosition",
    // Story 6.23: `TextField select`'s native-select flag. The mock's `select` branch already
    // renders a real <select>, so the prop itself has nothing left to do but leak onto the DOM.
    "SelectProps",
  ]);
  /**
   * Story 6.24 code review. `sx` must not reach the DOM as an attribute, but dropping it outright
   * made every style assertion in this suite a tautology over an exported literal: the two `sx`
   * constants could be deleted from the JSX and the tests stayed green, so AC1, AC2 and AC8 could
   * silently revert. Re-exposed as a serialised `data-sx` so a test can assert the constant reached
   * the element it is supposed to style, rather than only that the constant still holds its value.
   *
   * `try`/`catch` because `sx` legitimately accepts callbacks and nested arrays; anything that will
   * not serialise is simply not observable, which is the pre-existing state rather than a new gap.
   */
  const serializeSx = (value: unknown): string | undefined => {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  };
  const omitLayoutProps = (props: Record<string, unknown>) => {
    const kept = Object.fromEntries(Object.entries(props).filter(([key]) => !MUI_ONLY_PROPS.has(key)));
    if ("sx" in props) {
      const serialized = serializeSx(props.sx);
      if (serialized !== undefined) kept["data-sx"] = serialized;
    }
    return kept;
  };
  const Simple = ({ children, component, ...rest }: { children?: ReactNode; component?: string }) =>
    React.createElement(
      component ?? "div",
      omitLayoutProps(rest as Record<string, unknown>),
      // Void elements reject a children argument even when it is undefined.
      ...(component === "input" || component === "img" ? [] : [children]),
    );
  return {
    __esModule: true,
    Alert: Simple,
    Box: Simple,
    Button: ({ children, ...rest }: { children?: ReactNode }) => (
      <button {...omitLayoutProps(rest as Record<string, unknown>)}>{children}</button>
    ),
    CircularProgress: () => <div role="progressbar" />,
    // Story 6.12's shared viewer renders its close/paging controls as `IconButton`s. This mock is
    // exhaustive by design — an undeclared export throws rather than falling back.
    IconButton: ({ children, ...rest }: { children?: ReactNode }) => (
      <button type="button" {...omitLayoutProps(rest as Record<string, unknown>)}>
        {children}
      </button>
    ),
    // Honours `open`, unlike the other `Simple` slots: MUI's real Modal renders nothing at all while
    // closed, and Story 6.12's viewer is now always mounted with the whole collection in hand. A
    // mock that ignored `open` would leave the viewer's <img> in the DOM permanently.
    Dialog: ({ children, open = true, ...rest }: { children?: ReactNode; open?: boolean }) =>
      open ? <div {...omitLayoutProps(rest as Record<string, unknown>)}>{children}</div> : null,
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
    /*
      Story 6.22's four sections. The real `Tabs`/`Tab` are what AC7 asks for precisely because they
      ship `role="tablist"`/`role="tab"`, `aria-selected` and the arrow-key handling — so the mock
      renders those roles rather than plain <div>s. Every `selectTab` below resolves through
      `getByRole("tab", …)`, which means a regression from tabs back to styled buttons breaks this
      file instead of passing quietly.

      `value`/`onChange` are pushed down as `selectedValue`/`onSelect` the same way the `RadioGroup`
      mock above pushes its group state onto `FormControlLabel`.
    */
    Tabs: ({
      children,
      value,
      onChange,
      ...rest
    }: {
      children?: ReactNode;
      value?: string;
      onChange?: (event: unknown, value: string) => void;
    }) => (
      <div role="tablist" {...omitLayoutProps(rest as Record<string, unknown>)}>
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (React.cloneElement(child as any, { selectedValue: value, onSelect: onChange }) as ReactNode)
            : child,
        )}
      </div>
    ),
    Tab: ({
      label,
      icon,
      value,
      selectedValue,
      onSelect,
      ...rest
    }: {
      label?: ReactNode;
      icon?: ReactNode;
      value?: string;
      selectedValue?: string;
      onSelect?: (event: unknown, value: string) => void;
    }) => (
      <button
        type="button"
        role="tab"
        aria-selected={selectedValue === value}
        {...omitLayoutProps(rest as Record<string, unknown>)}
        onClick={() => onSelect?.(null, value as string)}
      >
        {label}
        {icon}
      </button>
    ),
    TextField: ({
      label,
      value,
      onChange,
      helperText,
      error,
      inputProps,
      slotProps,
      select,
      children,
      ...rest
    }: {
      label?: string;
      value?: string;
      onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
      helperText?: ReactNode;
      error?: boolean;
      inputProps?: Record<string, unknown>;
      // MUI 7 deprecates `inputProps` in favour of `slotProps.htmlInput`; FormField uses the latter.
      slotProps?: { htmlInput?: Record<string, unknown> };
      /*
        Story 6.23. `select` + `SelectProps={{ native: true }}` is how this codebase renders a day
        picker (`TripDayView.tsx`'s target-day field, reused by the move dialog). Without this branch
        the mock would try to hand `<option>` children to a void `<input>`, which React rejects
        outright — so the mock would fail loudly rather than misleadingly, but it would still fail.
      */
      select?: boolean;
      children?: ReactNode;
    }) => (
      <>
        <label>
          <span>{label}</span>
          {select ? (
            <select
              aria-label={label}
              // Same plumbing the <input> branch forwards. A select field carrying a test id via
              // `slotProps.htmlInput` or an error state would otherwise lose it silently, with no
              // failing test to say so.
              aria-invalid={error ? "true" : "false"}
              value={value ?? ""}
              onChange={onChange as unknown as (event: ChangeEvent<HTMLSelectElement>) => void}
              {...inputProps}
              {...slotProps?.htmlInput}
              {...omitLayoutProps(rest as Record<string, unknown>)}
            >
              {children}
            </select>
          ) : (
            <input
              aria-label={label}
              aria-invalid={error ? "true" : "false"}
              value={value ?? ""}
              onChange={onChange}
              {...inputProps}
              {...slotProps?.htmlInput}
              {...omitLayoutProps(rest as Record<string, unknown>)}
            />
          )}
        </label>
        {/*
          Outside the <label>, as real MUI renders it. Inside, the helper line joins the input's
          accessible name — which is exactly the drift AC6 pins against ("Link" must stay "Link",
          not "Link Optional external link").
        */}
        {helperText && <span>{helperText}</span>}
      </>
    ),
    /**
     * Story 6.24. Real MUI clones the child and attaches handlers rather than wrapping it, so the
     * mock adds the thinnest wrapper that can still carry the title for assertion. The tooltip's
     * *rendering* is covered against real MUI in `formPrimitives.test.tsx`; what this suite needs is
     * only that the icon-only controls are given one, since AC5 makes it load-bearing for the
     * destructive action whose word was removed.
     */
    Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
      <span data-tooltip={typeof title === "string" ? title : undefined}>{children}</span>
    ),
    // `component` matters here: FormField's caps label is a `Typography component="label" htmlFor`,
    // and a <div htmlFor> associates with nothing — every getByLabelText in this file depends on it.
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

/**
 * Story 6.22. The dialog's fields now live on four tabs and an inactive panel is **not mounted**, so
 * a field is absent from the DOM until its tab is selected. Rather than repeating that step at ~40
 * query sites, every test reaches a field through this helper.
 *
 * The match is on the *prefix* of the accessible name, not on equality: a tab holding a field in
 * error is named "Cost (contains errors)" (AC2's non-colour marker, said in words), and the helper
 * has to reach it in both states. The four labels are distinct in their first word in both
 * languages, so a prefix is unambiguous.
 */
const TAB_LABELS = {
  en: { what: "What", whenWhere: "When & where", cost: "Cost", media: "Media & links" },
  de: { what: "Was", whenWhere: "Wann & Wo", cost: "Kosten", media: "Medien & Links" },
} as const;

type TabKey = keyof (typeof TAB_LABELS)["en"];

const selectTab = (tab: TabKey, language: keyof typeof TAB_LABELS = "en") => {
  const label = TAB_LABELS[language][tab];
  const control = screen.getByRole("tab", { name: (name: string) => name.startsWith(label) });
  fireEvent.click(control);
  return control;
};

/**
 * Each panel is `aria-labelledby` its own tab (AC7), so the panel element itself answers to the tab's
 * accessible name — and "Cost" is the name of both a tab and a field. Narrowing to the control keeps
 * the query on the label rather than falling back to a test id.
 */
const costField = () => screen.getByLabelText("Cost", { selector: "input" });

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
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Add plan item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
    expect(screen.queryByText("Plan items")).not.toBeInTheDocument();
    expect(screen.queryByText("No plan items yet.")).not.toBeInTheDocument();

    // "Was" is the tab every open starts on.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Museum" } });
    vi.spyOn(window, "prompt").mockReturnValue("https://images.example.com/plan.webp");
    fireEvent.click(screen.getByRole("button", { name: "Image" }));

    selectTab("whenWhere");
    expect(screen.getByLabelText("Search place")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).toBeNull();
    expect(screen.queryByLabelText("Longitude")).toBeNull();
    expect(screen.queryByLabelText("Location label (optional)")).toBeNull();
    expect(screen.getByText("No coordinates selected")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Museum" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() => expect(screen.getByText("Latitude: 48.145000 · Longitude: 11.582000")).toBeInTheDocument());

    selectTab("cost");
    fireEvent.change(costField(), { target: { value: "26,00" } });

    selectTab("media");
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.com/plan" } });

    // AC5: Speichern is in the footer, outside the panels, so it is reachable from every tab — this
    // save is fired from "Medien & Links" and still submits the whole form.
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Edit plan item")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Old Town walk");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated walk" } });

    selectTab("whenWhere");
    expect(screen.getByLabelText("From")).toHaveValue("10:00");
    expect(screen.getByLabelText("To")).toHaveValue("11:00");
    expect(screen.getByText("Latitude: 48.137200 · Longitude: 11.575600")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "12:00" } });

    selectTab("cost");
    expect(costField()).toHaveValue("21.00");
    fireEvent.change(costField(), { target: { value: "34,00" } });

    selectTab("media");
    expect(screen.getByRole("textbox", { name: "Link" })).toHaveValue("https://example.com/original");
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.com/updated" } });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const deleteButton = screen.getByRole("button", { name: "Delete plan item" });
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
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Delete plan item" })).toBeNull();
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
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " " } });
    selectTab("whenWhere");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // AC2: the save was fired from "Wann & Wo" and the server rejected `title`, which lives on "Was".
    // The message is only visible because the dialog switched back to the tab that owns it.
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "What (contains errors)" })).toHaveAttribute("aria-selected", "true"),
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
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan" } });
    selectTab("whenWhere");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/day-plan-items"), expect.any(Object)));
    await waitFor(() => expect(screen.getByText("From time is required")).toBeInTheDocument());
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
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Tickets" } });
    selectTab("whenWhere");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10:00" } });
    selectTab("cost");
    fireEvent.change(costField(), { target: { value: "100.00" } });
    fireEvent.click(screen.getByLabelText("Split into multiple payments"));

    const amountInputs = screen.getAllByLabelText("Amount");
    const dateInputs = screen.getAllByLabelText("Due date");
    fireEvent.change(amountInputs[0], { target: { value: "40.00" } });
    fireEvent.change(dateInputs[0], { target: { value: "2026-11-01" } });
    fireEvent.change(amountInputs[1], { target: { value: "50.00" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-11-02" } });

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    selectTab("cost");
    const splitOption = screen.getByLabelText("Split into multiple payments");
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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    selectTab("media");
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

    // AC5: the preview strip renders one thumbnail per image, each with an indexed, meaning-bearing
    // alt string rather than the single shared `trips.gallery.thumbnailAlt` value.
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector('img[alt="Image 1 of 2"]')).not.toBeNull();
    expect(container.querySelector('img[alt="Image 2 of 2"]')).not.toBeNull();
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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    selectTab("media");
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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    selectTab("media");
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const fileOne = new File(["first"], "first.webp", { type: "image/webp" });
    const fileTwo = new File(["second"], "second.webp", { type: "image/webp" });
    fireEvent.change(fileInput, { target: { files: [fileOne, fileTwo] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(screen.getByText("Plan item update failed. Please try again.")).toBeInTheDocument());
    // Pinned on the indexed alt, not on a bare <img> count: the failed upload must leave the one
    // pre-existing thumbnail and add nothing.
    expect(container.querySelectorAll('img[alt="Image 1 of 1"]')).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(1);
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
      <Providers language="de">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The German tab label, so this also pins that the four labels reached `de.ts`.
    selectTab("media", "de");
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["first"], "first.webp", { type: "image/webp" })] } });

    expect(screen.getByText("1 Datei(en) ausgewählt")).toBeInTheDocument();
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
      <Providers language="en">
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
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    selectTab("media");
    await waitFor(() =>
      expect(container.querySelector('img[alt="Image 1 of 1"]')).not.toBeNull(),
    );
    const thumbnail = container.querySelector('img[alt="Image 1 of 1"]') as HTMLElement;
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Down" })).toBeNull();
    // AC5: the remove affordance names the image it removes. The old shared "Remove" name gave every
    // thumbnail in a multi-image gallery the same accessible name.
    expect(screen.getByRole("button", { name: "Remove image 1 of 1" })).toBeInTheDocument();

    fireEvent.click(thumbnail);
    // The strip thumbnail carries `loading="lazy"`; the fullscreen preview does not. Asserting on
    // that distinguishes "the viewer opened" from "some second <img> appeared".
    await waitFor(() => {
      expect(container.querySelectorAll('img[alt="Image 1 of 1"]')).toHaveLength(2);
      expect(container.querySelectorAll('img[alt="Image 1 of 1"]:not([loading])')).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove image 1 of 1" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/day-plan-items/images"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  /**
   * Story 6.22 AC2 — the assertion that makes the whole story safe. A tabbed form that reports a
   * validation error on a tab the user cannot see is worse than the long scroll it replaced: press
   * Speichern, nothing appears to happen, and the reason is one tab away.
   *
   * The client-side cost check is used rather than a server rejection because it needs no network
   * round trip to reach the branch, and because "Kosten" is two tabs from "Was" — the error is
   * genuinely off-screen when the save is fired.
   */
  it("switches to the tab that owns an error, marks it and focuses the field", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Tickets" } });

    selectTab("cost");
    fireEvent.change(costField(), { target: { value: "twelve euros" } });

    // Back to tab 1, so the offending field is not merely off-screen but not in the DOM at all.
    selectTab("what");
    expect(screen.queryByLabelText("Cost")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Switched, not merely marked.
    const costTab = screen.getByRole("tab", { name: "Cost (contains errors)" });
    expect(costTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "What" })).toHaveAttribute("aria-selected", "false");
    // The marker says "contains errors" in words, so it is not carried by colour alone.
    expect(screen.getByText("Enter a valid non-negative amount with up to 2 decimals")).toBeInTheDocument();
    // And the caret is on the field, not just on the tab.
    expect(costField()).toHaveFocus();

    /*
      DW-176, from Story 6.26's review. AC2 asks for the marker in colour *as well as* in a glyph and
      in words, and colour was the one channel missing — on the selected tab specifically, which is the
      only state this path ever leaves the user in. A bare `color` on the `Tab` root is one class of
      specificity; MUI's `textColor="primary"` variant emits `&.Mui-selected { color: primary.main }`
      at two, so it won and the tab rendered `primary.main` green, triangle included via `currentColor`.

      **This assertion is weaker than it looks, and deliberately so.** This suite stubs `@mui/material`
      and re-exposes `sx` as a serialised `data-sx` (see the mock's own note above), so there is no real
      cascade here to measure — `getComputedStyle` returns black for every element. All that can be
      checked is that the override is *present*. The proof that it actually wins the cascade is in
      `tripAccommodationDialog.test.tsx`, which renders real MUI and asserts the computed colour; that
      case was verified to fail against the single-class version.
    */
    const markerSx = JSON.parse(costTab.getAttribute("data-sx") ?? "null");
    expect(markerSx).toEqual({ color: "#8A5A2B", "&.Mui-selected": { color: "#8A5A2B" } });

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/day-plan-items"), expect.anything());
  });

  /**
   * AC4. Every field is plain `useState` at dialog level, so state lives above the panels and an
   * unmounting panel cannot drop a value. This pins that property rather than assuming it: the
   * `queryByLabelText` in the middle proves the panel really did unmount, so the round trip is a
   * real one and not a hidden `display: none`.
   */
  it("keeps typed values across a tab round trip", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Museum tour" } });

    selectTab("whenWhere");
    expect(screen.queryByLabelText("Title")).toBeNull();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "09:15" } });

    selectTab("media");
    fireEvent.change(screen.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.com/x" } });

    selectTab("what");
    expect(screen.getByLabelText("Title")).toHaveValue("Museum tour");

    selectTab("whenWhere");
    expect(screen.getByLabelText("From")).toHaveValue("09:15");

    selectTab("media");
    expect(screen.getByRole("textbox", { name: "Link" })).toHaveValue("https://example.com/x");
  });

  /**
   * The server is the only source that can reject several tabs' fields at once — every client-side
   * branch returns on the first problem. AC2 asks for *every* owning tab to be marked and for the
   * *first* in tab order to be the one selected, and this is the only path that exercises both.
   */
  it("marks every tab a server error owns and selects the first in tab order", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          data: null,
          error: {
            code: "validation_error",
            message: "invalid",
            details: { fieldErrors: { title: ["Title is required"], linkUrl: ["Enter a valid URL"] } },
          },
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Start on the last tab, so "switched to the first owner" cannot pass by accident.
    selectTab("media");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "What (contains errors)" })).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Media & links (contains errors)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "What (contains errors)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  /**
   * AC2's last sentence, and the one path that could still break it: a `validation_error` whose keys
   * this dialog does not surface (`location`, `tripDayId`, …) clears every error store, so without a
   * fallback the spinner would stop and absolutely nothing would appear.
   */
  it("shows a banner when a rejected save maps to no field at all", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          data: null,
          error: {
            code: "validation_error",
            message: "invalid",
            details: { fieldErrors: { location: ["Invalid location"] } },
          },
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Tickets" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(screen.getByText("Plan item update failed. Please try again.")).toBeInTheDocument(),
    );
    // And it did not mark a tab it has no error for.
    expect(screen.queryByRole("tab", { name: /contains errors/ })).toBeNull();
  });

  /**
   * A tab marker is global chrome, unlike the inline message it replaces as the primary signal. If it
   * outlives the fix, the tab bar tells the user there is a problem on a tab where there is none.
   */
  it("drops a tab's marker once the offending field is corrected", async () => {
    const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          data: null,
          error: {
            code: "validation_error",
            message: "invalid",
            details: { fieldErrors: { linkUrl: ["Enter a valid URL"] } },
          },
        }),
      };
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Providers language="en">
        <TripDayPlanDialog
          open
          mode="add"
          tripId="trip-1"
          day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
          item={null}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </Providers>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Tickets" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    // Switched to the owning tab and put the caret on the field — the `linkUrl` focus target, which
    // nothing else in this file covers.
    const linkField = await screen.findByRole("textbox", { name: "Link" });
    expect(screen.getByRole("tab", { name: "Media & links (contains errors)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(linkField).toHaveFocus();

    fireEvent.change(linkField, { target: { value: "https://example.com/tickets" } });
    expect(screen.queryByRole("tab", { name: /contains errors/ })).toBeNull();
  });

  /**
   * Story 6.23 — "Auf anderen Tag verschieben".
   *
   * The action lives in the dialog's footer, outside the four tab panels, so none of these tests
   * selects a tab: an action that needed one would be the thing AC1 says it must not be.
   */
  describe("moving the activity to another day", () => {
    const csrfOnlyFetch = () =>
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
        }
        if (url.includes("/day-plan-items/images?")) {
          return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
        };
      }) as unknown as typeof fetch;

    const existingItem = {
      id: "item-1",
      tripDayId: "day-1",
      title: "Old Town walk",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: tiptapMocks.sampleDoc,
      costCents: 2100,
      linkUrl: null,
      location: null,
      createdAt: "2026-12-01T09:00:00.000Z",
    };

    const targetDays = [
      { id: "day-2", label: "Day 2 · Nov 2, 2026" },
      { id: "day-3", label: "Day 3 · Nov 3, 2026" },
    ];

    it("offers the action when editing an existing activity", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      vi.stubGlobal("fetch", csrfOnlyFetch());

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onMove={async () => ({ moved: true as const })}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      await waitFor(() => expect(screen.getByRole("button", { name: "Another day" })).toBeInTheDocument());
    });

    /** AC1's second sentence: while creating there is nothing to move yet. */
    it("hides the action while creating a new activity", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      const fetchMock = csrfOnlyFetch();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="add"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={null}
            moveTargetDays={targetDays}
            onMove={async () => ({ moved: true as const })}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Another day" })).toBeNull();
    });

    /**
     * AC8. A viewer gets no `onMove` from `TripDayView`, exactly as they get no `onDelete` — so the
     * action is absent rather than present-but-disabled, which is what the rest of this screen does.
     */
    it("hides the action when no move handler is supplied", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      const fetchMock = csrfOnlyFetch();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Another day" })).toBeNull();
    });

    /** A one-day trip has nowhere to move to, so the action would open an empty picker. */
    it("hides the action when the trip has no other day", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      const fetchMock = csrfOnlyFetch();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={[]}
            onMove={async () => ({ moved: true as const })}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Another day" })).toBeNull();
    });

    it("moves the activity to the chosen day and closes the dialog", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      vi.stubGlobal("fetch", csrfOnlyFetch());
      const onMove = vi.fn(async () => ({ moved: true as const }));
      const onClose = vi.fn();

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onMove={onMove}
            onClose={onClose}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Another day" }));

      // The picker is the day-level transfer's own field, reused: same label, same native select.
      const picker = screen.getByLabelText("Target day");
      expect(Array.from(picker.querySelectorAll("option")).map((option) => option.textContent)).toEqual([
        "",
        "Day 2 · Nov 2, 2026",
        "Day 3 · Nov 3, 2026",
      ]);
      // The current day is not among them — the caller excludes it, and this is what says so.
      expect(picker.querySelector('option[value="day-1"]')).toBeNull();

      // Nothing chosen yet, so the confirm is not live.
      expect(screen.getByRole("button", { name: "Move activity" })).toBeDisabled();

      fireEvent.change(picker, { target: { value: "day-3" } });
      fireEvent.click(screen.getByRole("button", { name: "Move activity" }));

      await waitFor(() => expect(onMove).toHaveBeenCalledWith("item-1", "day-3"));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    /**
     * A failed move must say so *in* this dialog, in the caller's own words. The page behind is
     * covered by this dialog, so "your session has expired" rendered there is a message nobody
     * reads — and a generic "please try again" here would send the user back to an action that
     * cannot succeed.
     */
    it("keeps the dialog open and reports a failed move with the caller's message", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      vi.stubGlobal("fetch", csrfOnlyFetch());
      const onMove = vi.fn(async () => ({ moved: false as const, message: "Your session has expired." }));
      const onClose = vi.fn();

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onMove={onMove}
            onClose={onClose}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Another day" }));
      fireEvent.change(screen.getByLabelText("Target day"), { target: { value: "day-2" } });
      fireEvent.click(screen.getByRole("button", { name: "Move activity" }));

      await waitFor(() => expect(screen.getByText("Your session has expired.")).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });

    /**
     * The two costs of moving are disclosed before the move, not only in the receipt afterwards:
     * travel segments hold a duration, a distance and sometimes a typed link, and the form behind
     * this picker can be dirty — only the saved activity travels.
     */
    it("warns what the move does not carry and what it removes", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      vi.stubGlobal("fetch", csrfOnlyFetch());

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onMove={async () => ({ moved: true as const })}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Another day" }));
      expect(screen.getByTestId("plan-move-warning")).toHaveTextContent(
        "Unsaved changes in this dialog are not moved.",
      );
      expect(screen.getByTestId("plan-move-warning")).toHaveTextContent(
        "Travel segments between this activity and its neighbours are removed on both days.",
      );
    });

    /**
     * Two clicks in one tick both run before React re-renders, so `disabled` alone does not stop the
     * second: it would post a move for an activity that is no longer on this day.
     */
    it("posts a single move when the confirm is double-clicked", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      vi.stubGlobal("fetch", csrfOnlyFetch());
      let release: () => void = () => undefined;
      const onMove = vi.fn(
        () =>
          new Promise<{ moved: true }>((resolve) => {
            release = () => resolve({ moved: true });
          }),
      );

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onMove={onMove}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Another day" }));
      fireEvent.change(screen.getByLabelText("Target day"), { target: { value: "day-2" } });
      const confirm = screen.getByRole("button", { name: "Move activity" });
      fireEvent.click(confirm);
      fireEvent.click(confirm);

      expect(onMove).toHaveBeenCalledTimes(1);
      release();
    });

    /** The German label is the binding one — it is the wording the request itself used. */
    it("uses the requested German wording", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      vi.stubGlobal("fetch", csrfOnlyFetch());

      render(
        <Providers language="de">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onMove={async () => ({ moved: true as const })}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "anderer Tag" }));
      expect(screen.getByLabelText("Zieltag")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Aktivität verschieben" })).toBeInTheDocument();
    });

    /**
     * Story 6.25 code review. The picker's discard guard reads "a target day has been picked", and its
     * docblock said it "opens with `moveTargetDayId` blank (see the open effect)" — but that effect
     * belongs to the *activity* dialog and does not re-run when the picker alone is reopened. So a day
     * the user picked and then explicitly discarded came back selected, with the confirm button live,
     * one click from moving the activity to the day it had just been taken away from. The guard also
     * reported dirty on a reopen nobody had touched.
     *
     * Closing the picker now clears the target, which is what makes "opens blank" true on every open
     * rather than only the first one per activity.
     */
    it("forgets a target day that was picked and then discarded", async () => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      vi.stubGlobal("fetch", csrfOnlyFetch());
      const onMove = vi.fn(async () => ({ moved: true as const }));

      render(
        <Providers language="en">
          <TripDayPlanDialog
            open
            mode="edit"
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={existingItem}
            moveTargetDays={targetDays}
            onMove={onMove}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Another day" }));
      fireEvent.change(screen.getByLabelText("Target day"), { target: { value: "day-3" } });

      // The picker's own `✕` is the last close control on screen — the activity dialog behind it has
      // one too, and each closes the surface it sits on.
      const closeControls = screen.getAllByTestId("dialog-close");
      fireEvent.click(closeControls[closeControls.length - 1]);

      // A target was chosen, so the guard asks rather than closing straight through.
      fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

      fireEvent.click(await screen.findByRole("button", { name: "Another day" }));

      expect(screen.getByLabelText("Target day")).toHaveValue("");
      expect(screen.getByRole("button", { name: "Move activity" })).toBeDisabled();
      expect(onMove).not.toHaveBeenCalled();
    });
  });

  /**
   * AC3. The compiler is the primary guard — `PLAN_ERROR_TAB` is `Record<PlanErrorKey, PlanTabId>`,
   * so a new key with no tab does not build. This table is the second half of it: it fails when a key
   * is *added* to the map without anyone deciding, here and deliberately, which tab owns it.
   */
  describe("the error-to-tab map", () => {
    const EXPECTED: Array<[string, string]> = [
      ["title", "what"],
      ["contentJson", "what"],
      ["fromTime", "whenWhere"],
      ["toTime", "whenWhere"],
      ["costCents", "cost"],
      ["paymentError", "cost"],
      ["paymentRowErrors", "cost"],
      ["linkUrl", "media"],
    ];

    it.each(EXPECTED)("puts the %s error on the %s tab", async (key, tab) => {
      const { PLAN_ERROR_TAB } = await import("@/components/features/trips/TripDayPlanDialog");
      expect(PLAN_ERROR_TAB[key as keyof typeof PLAN_ERROR_TAB]).toBe(tab);
    });

    it("covers every error key and nothing else", async () => {
      const { PLAN_ERROR_TAB } = await import("@/components/features/trips/TripDayPlanDialog");
      expect(Object.keys(PLAN_ERROR_TAB).sort()).toEqual(EXPECTED.map(([key]) => key).sort());
    });

    it("maps every key to a tab the dialog actually renders", async () => {
      const { PLAN_ERROR_TAB, PLAN_TAB_IDS } = await import("@/components/features/trips/TripDayPlanDialog");
      for (const tab of Object.values(PLAN_ERROR_TAB)) {
        expect(PLAN_TAB_IDS).toContain(tab);
      }
    });
  });

  /**
   * Story 6.24 — a calmer dialog: it holds still when tabs switch, and its footer carries three
   * controls instead of four labels.
   *
   * AC1 (the frame's height) and AC8 (the footer on one row) are rendered-pixel claims and jsdom lays
   * nothing out, so what is provable here is the *wiring* those two criteria depend on: the floor is
   * declared once, on the element that wraps all four panels, as a `minHeight` and not a `height`;
   * and the footer's direction is a row at every width. The pixels themselves are the browser pass.
   */
  describe("story 6.24 — the calmer dialog", () => {
    const csrfOnlyFetch = () =>
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }) };
        }
        if (url.includes("/day-plan-items/images?")) {
          return { ok: true, status: 200, json: async () => ({ data: { images: [] }, error: null }) };
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ data: null, error: { code: "server_error", message: "boom" } }),
        };
      }) as unknown as typeof fetch;

    const existingItem = {
      id: "item-1",
      tripDayId: "day-1",
      title: "Old Town walk",
      fromTime: "10:00",
      toTime: "11:00",
      contentJson: tiptapMocks.sampleDoc,
      costCents: 2100,
      linkUrl: null,
      location: null,
      createdAt: "2026-12-01T09:00:00.000Z",
    };

    type Overrides = {
      language?: "en" | "de";
      mode?: "add" | "edit";
      onClose?: () => void;
      onDelete?: (itemId: string) => Promise<boolean>;
      item?: typeof existingItem;
    };

    const renderDialog = async ({ language = "en", mode = "add", onClose, onDelete, item }: Overrides = {}) => {
      const { default: TripDayPlanDialog } = await import("@/components/features/trips/TripDayPlanDialog");
      const fetchMock = csrfOnlyFetch();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <Providers language={language}>
          <TripDayPlanDialog
            open
            mode={mode}
            tripId="trip-1"
            day={{ id: "day-1", date: "2026-11-01T00:00:00.000Z", dayIndex: 1 }}
            item={mode === "edit" ? (item ?? existingItem) : null}
            onDelete={onDelete}
            onClose={onClose ?? (() => undefined)}
            onSaved={() => undefined}
          />
        </Providers>,
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    };

    /** AC3. The footer's dismissal moved to the title row; `Abbrechen` is gone from this dialog. */
    it("carries no cancel button", async () => {
      await renderDialog();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    /** AC4. An unlabelled `✕` is a button with no name for anyone not looking at it. */
    it("names the close control and closes on it", async () => {
      const onClose = vi.fn();
      await renderDialog({ onClose });

      const close = screen.getByRole("button", { name: "Close" });
      // The tooltip repeats the accessible name for sighted pointer users (DESIGN.md.icon-button).
      // A real `Tooltip`, not the native `title` attribute, which never fires on focus or on touch —
      // so the assertion is on the wrapper the tooltip puts around its child, not on an attribute.
      expect(close.closest("[data-tooltip]")).toHaveAttribute("data-tooltip", "Close");
      fireEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("names the close control in German too", async () => {
      await renderDialog({ language: "de" });
      expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
    });

    /**
     * AC3a, the half that must not over-fire: a dialog nobody has typed into closes on one click.
     * An untouched *edit* is the harder case — every field is prefilled, so a naive "is there a value
     * in here?" check would call it dirty and ask a question with no answer worth giving.
     */
    it("closes an untouched dialog silently, in add and in edit mode", async () => {
      for (const mode of ["add", "edit"] as const) {
        const onClose = vi.fn();
        await renderDialog({ mode, onClose });

        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("Discard changes?")).toBeNull();
        cleanup();
      }
    });

    /**
     * AC3a. The dismissal shrank from a labelled footer button to a 44px glyph, so the word naming
     * the consequence has to come from somewhere — it comes from here.
     */
    it("asks before discarding typed input, and names what goes", async () => {
      const onClose = vi.fn();
      await renderDialog({ onClose });

      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Museum" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Discard changes?")).toBeInTheDocument();
      expect(screen.getByTestId("plan-discard-body")).toHaveTextContent(
        "Your changes to this plan item will be discarded.",
      );
    });

    /** AC3a. "The keeping answer as the safe one" — it names what it preserves and it changes nothing. */
    it("keeps the form when the safe answer is chosen", async () => {
      const onClose = vi.fn();
      await renderDialog({ onClose });

      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Museum" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByText("Discard changes?")).toBeNull();
      expect(screen.getByLabelText("Title")).toHaveValue("Museum");
    });

    it("discards once, and only once, when the discard answer is chosen", async () => {
      const onClose = vi.fn();
      await renderDialog({ onClose });

      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Museum" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Discard changes?")).toBeNull();
    });

    /**
     * A value typed and then undone is not something to lose. This is why "dirty" is a comparison
     * against the values the dialog opened with rather than a per-field `touched` flag.
     */
    it("closes silently again once an edit is undone", async () => {
      const onClose = vi.fn();
      await renderDialog({ mode: "edit", onClose });

      const titleField = screen.getByLabelText("Title");
      fireEvent.change(titleField, { target: { value: "Old Town walk!" } });
      fireEvent.change(titleField, { target: { value: "Old Town walk" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Discard changes?")).toBeNull();
    });

    /** An edit on a tab the user has since left still counts — the check is over the whole form. */
    it("guards an edit made on a tab that is no longer selected", async () => {
      const onClose = vi.fn();
      await renderDialog({ mode: "edit", onClose });

      selectTab("cost");
      fireEvent.change(costField(), { target: { value: "42,00" } });
      selectTab("media");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    });

    /**
     * AC3a, code-review regression. The baseline used to be the server's raw `contentJson` string
     * while every later read of the description came from `JSON.stringify(editor.getJSON())`. For any
     * stored doc that is not byte-identical to the editor's re-serialisation of it — a doc written
     * before an extension existed, a node whose attrs the schema fills in, or merely different key
     * order and whitespace out of storage — the two never matched, so the form was dirty from the
     * moment it opened and the `✕` asked to discard changes nobody had made.
     *
     * `setEditorContent` now reads the doc back out of the editor, so both sides come from one
     * serializer. The fixture's whitespace is what makes the strings differ; the *doc* is identical.
     *
     * The toolbar click is what makes this bite. On open the two strings still agreed, because the
     * old code seeded state from the same raw string it fingerprinted. The divergence needed an
     * editor update — any one, even one that changes nothing — because that is when `onUpdate`
     * replaces state with the editor's own serialisation and leaves the baseline behind.
     */
    it("closes silently when the stored description is not byte-identical to the editor's own output", async () => {
      const onClose = vi.fn();
      const prettyPrinted = {
        ...existingItem,
        contentJson: `{\n  "type": "doc",\n  "content": [\n    { "type": "paragraph" }\n  ]\n}`,
      };
      await renderDialog({ mode: "edit", item: prettyPrinted, onClose });

      // An editor update that leaves the document identical — the "typed a character and deleted it
      // again" case, which AC3a's whole choice of a fingerprint over a `touched` flag is about.
      fireEvent.click(screen.getByRole("button", { name: "Bold" }));

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByText("Discard changes?")).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /**
     * AC3a, code-review regression. `locationQuery` is the location *search* box. `handleSave` sends
     * `location: resolvedLocation` and never the query, so watching it made the `✕` ask about a value
     * no save would have kept — the same over-firing the fingerprint was chosen over a `touched` flag
     * to avoid. Typing a search term and not running the lookup is not an unsaved change.
     */
    it("does not treat an unsubmitted location search as unsaved input", async () => {
      const onClose = vi.fn();
      await renderDialog({ mode: "edit", onClose });

      selectTab("whenWhere");
      fireEvent.change(screen.getByLabelText("Search place"), { target: { value: "Rom" } });

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByText("Discard changes?")).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /**
     * AC5. The label became a glyph, so the accessible name is now the only word the control carries —
     * and it is `deleteItemAria` ("Planpunkt löschen"), not the bare "Löschen" the button used to say.
     */
    it("reaches the delete control by its accessible name, with a tooltip and no visible label", async () => {
      const onDelete = vi.fn(async () => true);
      await renderDialog({ mode: "edit", onDelete });

      const remove = screen.getByRole("button", { name: "Delete plan item" });
      // Trap 3 makes the tooltip load-bearing rather than decorative, which is why it is a real
      // `Tooltip` and not the native `title` attribute: `title` reaches mouse users and nobody else,
      // on the one control this story took the word away from.
      expect(remove.closest("[data-tooltip]")).toHaveAttribute("data-tooltip", "Delete plan item");
      expect(remove).toHaveTextContent("");
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    });

    it("names the delete control in German with the existing aria string", async () => {
      await renderDialog({ mode: "edit", language: "de", onDelete: async () => true });
      expect(screen.getByRole("button", { name: "Planpunkt löschen" })).toBeInTheDocument();
    });

    /**
     * AC5's second sentence, and the one behaviour this story must not thin out: the glyph is a
     * *request* to delete, handed to the caller, and `TripDayView` still puts a confirmation between
     * it and the deletion. `tripDayViewLayout.test.tsx` owns the confirmation itself; what this
     * asserts is the seam — a decline leaves the dialog open with the activity intact.
     */
    it("leaves the dialog open when the caller's confirmation is declined", async () => {
      const onClose = vi.fn();
      const onDelete = vi.fn(async () => false);
      await renderDialog({ mode: "edit", onClose, onDelete });

      fireEvent.click(screen.getByRole("button", { name: "Delete plan item" }));
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith("item-1"));
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Delete plan item" })).toBeInTheDocument();
    });

    /** AC6. One word for both modes, and the same word in both languages by decision. */
    it.each([
      ["en", "OK"],
      ["de", "OK"],
    ] as const)('labels the committing action "%2$s" in %1$s for both modes', async (language, label) => {
      for (const mode of ["add", "edit"] as const) {
        await renderDialog({ language, mode });
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
        cleanup();
      }
    });

    /**
     * AC1/AC2. One floor, on the element that wraps every panel — not a per-panel copy of it.
     *
     * The `data-sx` assertion is the one that earns its keep. Asserting `PLAN_PANEL_FLOOR_SX.minHeight`
     * alone describes an object literal: the `sx` prop could be deleted from the JSX and this stayed
     * green, so AC1 and AC2 could silently revert. This binds the constant to the element it styles.
     */
    it.each(["what", "whenWhere", "cost", "media"] as const)("keeps the %s panel inside the floor", async (tab) => {
      const { PLAN_PANEL_FLOOR_SX } = await import("@/components/features/trips/TripDayPlanDialog");
      await renderDialog({ mode: "edit" });

      selectTab(tab);
      const floor = screen.getByTestId("plan-tabpanel-floor");
      const panel = screen.getByRole("tabpanel");
      expect(floor).toContainElement(panel);
      expect(JSON.parse(floor.getAttribute("data-sx") ?? "null")).toEqual(PLAN_PANEL_FLOOR_SX);
    });

    /**
     * AC2 said as an assertion rather than as a comment. DW-149 has the `Kosten` panel at 1634px on
     * five payment rows: a fixed `height` would clip it or nest a scroll inside a scroll, so the floor
     * must be a `minHeight` and must not be joined by a `height`.
     */
    it("declares the floor as a minimum and not as a fixed height", async () => {
      const { PLAN_PANEL_FLOOR_SX, PLAN_PANEL_MIN_HEIGHT } = await import(
        "@/components/features/trips/TripDayPlanDialog"
      );
      expect(PLAN_PANEL_FLOOR_SX.minHeight).toBe(`${PLAN_PANEL_MIN_HEIGHT}px`);
      expect(PLAN_PANEL_FLOOR_SX).not.toHaveProperty("height");
      expect(PLAN_PANEL_FLOOR_SX).not.toHaveProperty("maxHeight");
    });

    /**
     * AC8. `DialogShell` stacks its footer at `xs` (`column-reverse`) because four full labels could
     * not share a 390px row. Three controls can, so this dialog overrides the stack.
     *
     * The per-breakpoint shape is the assertion, not an incidental detail: a plain
     * `flexDirection: "row"` is merged *alongside* the shell's compiled `@media (min-width:0px)`
     * block rather than over it, and then loses to it. That shipped in this story's first attempt and
     * measured a 132px stacked footer at 390px — the one viewport AC8 is about — while reading `row`
     * at 1400px. jsdom cannot see that, so the shape it depends on is pinned here instead.
     */
    it("keeps the footer on one row at every width, per breakpoint", async () => {
      const { PLAN_FOOTER_SX } = await import("@/components/features/trips/TripDayPlanDialog");
      expect(PLAN_FOOTER_SX.justifyContent).toBe("space-between");
      // Both keys the shell sets, so its media queries are replaced rather than merged under.
      expect(PLAN_FOOTER_SX.flexDirection).toEqual({ xs: "row", sm: "row" });
      expect(PLAN_FOOTER_SX.alignItems).toEqual({ xs: "center", sm: "center" });
      // Forcing `row` at `xs` removed the stack that used to absorb a footer too wide for its dialog,
      // and `DialogActions` sets no `flex-wrap` of its own. Below ~330px this is the whole safety net.
      expect(PLAN_FOOTER_SX.flexWrap).toBe("wrap");
    });

    /**
     * And the half the assertions above cannot reach: that the constant is actually *on* the footer,
     * and last in the `sx` array so the shell's own `xs` stack is replaced rather than sat under.
     *
     * `DialogShell` merges `footerSx` into `DialogActions`' `sx` as the final array entry. Reading it
     * back off the rendered element is what makes deleting `footerSx={PLAN_FOOTER_SX}` from the JSX a
     * test failure instead of a silent revert of AC8.
     */
    it("passes the footer sx to the shell, last so it wins", async () => {
      const { PLAN_FOOTER_SX } = await import("@/components/features/trips/TripDayPlanDialog");
      await renderDialog({ mode: "edit", onDelete: async () => true });

      const footer = screen.getByRole("button", { name: "OK" }).parentElement;
      const merged = JSON.parse(footer?.getAttribute("data-sx") ?? "null") as unknown[];
      expect(Array.isArray(merged)).toBe(true);
      expect(merged.at(-1)).toEqual(PLAN_FOOTER_SX);
    });
  });
});
