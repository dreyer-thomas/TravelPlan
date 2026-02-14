// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it } from "vitest";

// eslint-disable-next-line no-console
console.log("TripDayPlanDialog import test: start");

describe("TripDayPlanDialog import", () => {
  it("imports the module", async () => {
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog import test: before import");
    await import("@/components/features/trips/TripDayPlanDialog");
    // eslint-disable-next-line no-console
    console.log("TripDayPlanDialog import test: after import");
  });
});
