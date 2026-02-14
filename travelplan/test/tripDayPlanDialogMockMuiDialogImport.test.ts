// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, vi } from "vitest";

// eslint-disable-next-line no-console
console.log("TripDayPlanDialog mock MUI Dialog import test: start");

vi.mock("@mui/material", async () => {
  const actual = await vi.importActual<typeof import("@mui/material")>("@mui/material");
  return {
    ...actual,
    Dialog: () => null,
    DialogTitle: () => null,
    DialogContent: () => null,
    DialogActions: () => null,
  };
});

vi.mock("@tiptap/react", () => ({
  EditorContent: () => null,
  useEditor: () => null,
}));

vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));

describe("TripDayPlanDialog import with mocked MUI Dialog", () => {
  it("imports the module", async () => {
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog mock MUI Dialog: before import");
    await import("@/components/features/trips/TripDayPlanDialog");
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog mock MUI Dialog: after import");
  });
});
