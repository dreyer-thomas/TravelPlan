// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/provider";

const tiptapMocks = vi.hoisted(() => ({
  updatedFlag: { value: false },
  sampleDoc: JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Plan" }] }],
  }),
}));

vi.mock("@mui/material", async () => {
  const actual = await vi.importActual<typeof import("@mui/material")>("@mui/material");
  return {
    ...actual,
    Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogActions: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="tiptap-editor" />,
  useEditor: (options: { onUpdate?: (args: { editor: { getJSON: () => unknown } }) => void }) => {
    const editor = {
      commands: { setContent: vi.fn() },
      getJSON: () => JSON.parse(tiptapMocks.sampleDoc),
    };

    if (options?.onUpdate && !tiptapMocks.updatedFlag.value) {
      tiptapMocks.updatedFlag.value = true;
      options.onUpdate({ editor });
    }

    return editor;
  },
}));

vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));

describe("TripDayPlanDialog import with mocks", () => {
  it("imports the module", async () => {
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog import with mocks: before import");
    await import("@/components/features/trips/TripDayPlanDialog");
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog import with mocks: after import");
  });

  it("noop uses testing library", () => {
    cleanup();
    fireEvent.click(document.body);
    render(
      <I18nProvider initialLanguage="en">
        <div>noop</div>
      </I18nProvider>,
    );
    screen.getByText("noop");
    waitFor(() => true);
  });
});
