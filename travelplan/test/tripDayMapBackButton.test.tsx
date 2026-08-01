// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripDayMapBackButton from "@/components/features/trips/TripDayMapBackButton";
import { renderWithProviders } from "./helpers/renderWithProviders";

// vi.hoisted, matching test/tripDayViewLayout.test.tsx: vi.mock factories are hoisted above module
// initialization, so a factory closing over a plain module-scope const is one import-order change
// away from a TDZ error.
const { back, push } = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back, push }),
}));

/**
 * jsdom reports history.length as 1 and the property is read-only on the real History prototype,
 * so the two branches are exercised by redefining it per test. The own property is deleted again
 * afterwards, or it would leak into any test added below and silently pick the wrong branch.
 */
const setHistoryLength = (length: number) => {
  Object.defineProperty(window.history, "length", { configurable: true, value: length });
};

describe("TripDayMapBackButton", () => {
  beforeEach(() => {
    back.mockClear();
    push.mockClear();
  });

  afterEach(() => {
    delete (window.history as unknown as Record<string, unknown>).length;
  });

  it("renders the label prop as the button's accessible name", () => {
    renderWithProviders(<TripDayMapBackButton href="/trips/trip-1/days/day-1" label="← Back to day" />);

    expect(screen.getByRole("button", { name: "← Back to day" })).toBeInTheDocument();
  });

  it("goes back in history when there is somewhere to go back to", async () => {
    const user = userEvent.setup();
    setHistoryLength(3);

    renderWithProviders(<TripDayMapBackButton href="/trips/trip-1/days/day-1" label="← Back to day" />);
    await user.click(screen.getByRole("button", { name: "← Back to day" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes the href when the map page is the first entry in history", async () => {
    const user = userEvent.setup();
    setHistoryLength(1);
    // Asserted, not assumed: jsdom's default is already 1, so without this the test would still
    // pass if setHistoryLength silently did nothing and the branch were never really pinned.
    expect(window.history.length).toBe(1);

    renderWithProviders(<TripDayMapBackButton href="/trips/trip-1/days/day-1" label="← Back to day" />);
    await user.click(screen.getByRole("button", { name: "← Back to day" }));

    expect(push).toHaveBeenCalledWith("/trips/trip-1/days/day-1");
    expect(back).not.toHaveBeenCalled();
  });
});
