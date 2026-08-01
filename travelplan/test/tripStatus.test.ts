import { describe, expect, it } from "vitest";
import { deriveTripStatus, startOfTodayUtc, type TripStatusInput } from "@/lib/trips/tripStatus";

const TODAY = new Date("2026-08-01T00:00:00.000Z");

const trip = (overrides: Partial<TripStatusInput> = {}): TripStatusInput => ({
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-09-05T00:00:00.000Z",
  dayCount: 5,
  openDayCount: 0,
  planItemCount: 4,
  ...overrides,
});

describe("deriveTripStatus", () => {
  it("returns past for a trip that ended before today", () => {
    expect(
      deriveTripStatus(trip({ startDate: "2026-05-02T00:00:00.000Z", endDate: "2026-07-31T00:00:00.000Z" }), TODAY),
    ).toBe("past");
  });

  it("gives past precedence over open days, so a finished trip never shouts", () => {
    expect(
      deriveTripStatus(
        trip({
          startDate: "2026-05-02T00:00:00.000Z",
          endDate: "2026-07-31T00:00:00.000Z",
          openDayCount: 3,
        }),
        TODAY,
      ),
    ).toBe("past");
  });

  it("treats a trip ending today as not past", () => {
    expect(
      deriveTripStatus(trip({ startDate: "2026-07-28T00:00:00.000Z", endDate: TODAY.toISOString() }), TODAY),
    ).toBe("planned");
  });

  it("returns upcoming for a future trip with nothing planned at all", () => {
    expect(deriveTripStatus(trip({ openDayCount: 5, planItemCount: 0 }), TODAY)).toBe("upcoming");
  });

  it("returns upcoming for an untouched trip that starts today, not a warn row", () => {
    expect(
      deriveTripStatus(
        trip({
          startDate: TODAY.toISOString(),
          endDate: "2026-08-05T00:00:00.000Z",
          dayCount: 5,
          openDayCount: 5,
          planItemCount: 0,
        }),
        TODAY,
      ),
    ).toBe("upcoming");
  });

  it("returns gap once a future trip has some plan, so warn means holes not absence", () => {
    expect(deriveTripStatus(trip({ openDayCount: 5, planItemCount: 2 }), TODAY)).toBe("gap");
    expect(deriveTripStatus(trip({ openDayCount: 2, planItemCount: 0 }), TODAY)).toBe("gap");
  });

  it("returns gap for an in-progress trip with open days rather than upcoming", () => {
    expect(
      deriveTripStatus(
        trip({
          startDate: "2026-07-30T00:00:00.000Z",
          endDate: "2026-08-04T00:00:00.000Z",
          openDayCount: 6,
          planItemCount: 0,
          dayCount: 6,
        }),
        TODAY,
      ),
    ).toBe("gap");
  });

  it("returns planned when nothing is open", () => {
    expect(deriveTripStatus(trip(), TODAY)).toBe("planned");
  });
});

describe("startOfTodayUtc", () => {
  it("normalizes to UTC midnight regardless of the wall-clock time", () => {
    // Constructed from local parts so the assertion holds in any TZ the suite runs under.
    expect(startOfTodayUtc(new Date(2026, 7, 1, 22, 45, 13)).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("follows the viewer's calendar day, not the UTC one", () => {
    // 23:30 local on Aug 1 is already Aug 2 in UTC for any positive offset - "today" stays Aug 1.
    expect(startOfTodayUtc(new Date(2026, 7, 1, 23, 30)).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    // 00:30 local on Aug 1 is still Jul 31 in UTC for any negative offset - "today" stays Aug 1.
    expect(startOfTodayUtc(new Date(2026, 7, 1, 0, 30)).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});
