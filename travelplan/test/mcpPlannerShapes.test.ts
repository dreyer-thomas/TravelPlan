import { describe, expect, it } from "vitest";
import { fileNameOfUrl, toActivity, toCost, toPayments, toPlannerDay, toWarning } from "@/lib/mcp/plannerShapes";

describe("plannerShapes (Story 15.2)", () => {
  it("passes a EUR cost without an original and a foreign cost with all four fields", () => {
    const eur = { costCents: 990, costOriginalAmount: null, costCurrency: null, costRate: null, costRateDate: null };
    expect(toCost(eur)).toEqual({ eurCents: 990, original: null });
    expect(toCost({ ...eur, costCents: null })).toBeNull();
    expect(
      toCost({ costCents: 4000, costOriginalAmount: 100000, costCurrency: "CZK", costRate: 25, costRateDate: "2027-01-02" }),
    ).toEqual({ eurCents: 4000, original: { amountMinor: 100000, currency: "CZK", rate: 25, rateDate: "2027-01-02" } });
  });

  it("keeps every instalment in order and the original amount only where there is one", () => {
    expect(
      toPayments([
        { amountCents: 100, dueDate: "2027-01-01" },
        { amountCents: 200, dueDate: "2027-02-01", amountOriginal: 5000 },
      ]),
    ).toEqual([
      { amountEurCents: 100, dueDate: "2027-01-01" },
      { amountEurCents: 200, dueDate: "2027-02-01", amountOriginalMinor: 5000 },
    ]);
  });

  it("renames the conflict fields for the model", () => {
    expect(
      toWarning({ kind: "late", itemId: "a", title: "T", fromTime: "10:00", reachableAt: "10:20", lateMinutes: 20 }),
    ).toEqual({ kind: "late", activityId: "a", title: "T", startTime: "10:00", reachableAt: "10:20", lateMinutes: 20 });
    expect(toWarning({ kind: "overflow", itemId: "b", title: null })).toEqual({ kind: "overflow", activityId: "b", title: null });
  });

  it("names an image by the last path segment of its URL", () => {
    expect(fileNameOfUrl("/uploads/trips/t/items/i/photo%201.jpg?v=3")).toBe("photo 1.jpg");
    expect(fileNameOfUrl("/uploads/bad%zz.png")).toBe("bad%zz.png");
  });

  it("drops times outside a day, blank titles to null, and file URLs always", () => {
    const item = {
      id: "i",
      title: "  ",
      contentJson: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] }),
      scheduleMode: "FLEXIBLE" as const,
      durationMinutes: 30,
      fromTime: "09:00",
      toTime: "09:30",
      linkUrl: null,
      location: { lat: 1, lng: 2, label: null },
      costCents: null,
      costOriginalAmount: null,
      costCurrency: null,
      costRate: null,
      costRateDate: null,
      payments: [],
      updatedAt: new Date("2027-01-01T08:00:00.000Z"),
      aiChangedAt: null as Date | null,
    };
    const media = {
      documents: [],
      images: [{ id: "img", imageUrl: "/uploads/x/y.jpg", updatedAt: new Date("2027-01-02T09:00:00.000Z") }],
    };
    const parked = toActivity(item, media, { withTimes: false });
    expect(parked).not.toHaveProperty("startTime");
    expect(parked).toMatchObject({ title: null, description: "Hi", place: { label: null, lat: 1, lng: 2 } });
    // Story 15.7: the file's stamp, which `delete_file` takes back.
    expect(parked.images).toEqual([{ id: "img", fileName: "y.jpg", updatedAt: "2027-01-02T09:00:00.000Z" }]);
    expect(JSON.stringify(parked)).not.toContain("/uploads/");
    expect(toActivity(item, undefined, { withTimes: true })).toMatchObject({
      startTime: "09:00",
      endTime: "09:30",
      updatedAt: "2027-01-01T08:00:00.000Z",
      aiChangedAt: null,
    });
    // Story 15.4: the connector's marker as ISO.
    expect(toActivity({ ...item, aiChangedAt: new Date("2027-01-02T09:00:00.000Z") }, undefined, { withTimes: false })).toMatchObject({
      aiChangedAt: "2027-01-02T09:00:00.000Z",
    });
  });

  it("gives last night's stay the check-out the day starts from, not the raw stored value (AC 3)", () => {
    const day = {
      id: "d",
      date: new Date("2027-05-02T00:00:00.000Z"),
      dayIndex: 2,
      items: [],
      legs: [],
      stay: null,
      missingStay: true,
      warnings: [],
    };
    const previousStayOf = (checkOutTime: string | null) =>
      toPlannerDay({ ...day, previousStay: { id: "s", name: "Inn", checkOutTime } }).previousStay;
    expect(previousStayOf("11:30")).toEqual({ id: "s", name: "Inn", checkOutTime: "11:30" });
    expect(previousStayOf(null)).toEqual({ id: "s", name: "Inn", checkOutTime: "10:00" });
    expect(previousStayOf("  ")).toMatchObject({ checkOutTime: "10:00" });
    expect(previousStayOf("late")).toMatchObject({ checkOutTime: "10:00" });
    expect(toPlannerDay({ ...day, previousStay: null }).previousStay).toBeNull();
  });
});
