// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, vi } from "vitest";

// eslint-disable-next-line no-console
console.log("TripDayPlanDialog mock MUI import test: start");

vi.mock("@mui/material", () => ({
  Alert: () => null,
  Box: () => null,
  Button: () => null,
  CircularProgress: () => null,
  Dialog: () => null,
  DialogActions: () => null,
  DialogContent: () => null,
  DialogTitle: () => null,
  Divider: () => null,
  Link: () => null,
  List: () => null,
  ListItem: () => null,
  ListItemText: () => null,
  TextField: () => null,
  Typography: () => null,
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: () => null,
  useEditor: () => null,
}));

vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));

describe("TripDayPlanDialog import with mocked MUI", () => {
  it("imports the module", async () => {
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog mock MUI: before import");
    await import("@/components/features/trips/TripDayPlanDialog");
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog mock MUI: after import");
  });
});
