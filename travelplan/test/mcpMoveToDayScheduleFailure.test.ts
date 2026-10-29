import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real `scheduleParkedDayPlanItemForTripDay` unless a case makes it fail after the park committed.
vi.mock("@/lib/repositories/dayPlanItemRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/dayPlanItemRepo")>();
  return { ...actual, scheduleParkedDayPlanItemForTripDay: vi.fn(actual.scheduleParkedDayPlanItemForTripDay) };
});

import { prisma } from "@/lib/db/prisma";
import { scheduleParkedDayPlanItemForTripDay } from "@/lib/repositories/dayPlanItemRepo";
import { cleanOAuthTables, createUser, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool, issueAccessToken, type ToolCallBody } from "./helpers/mcpClient";
import { seedPlannerTrip } from "./helpers/plannerFixtures";

/**
 * Story 15.4. `move_activity_to_day` is park then schedule in two transactions. When the schedule fails
 * after the park committed, the error names the park's change, so the model can undo it or schedule the
 * activity itself.
 */

setupConnectorEnvironment();

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
});

afterEach(() => {
  vi.mocked(scheduleParkedDayPlanItemForTripDay).mockClear();
});

const errorText = (body: ToolCallBody) => {
  expect(body.result?.isError).toBe(true);
  return body.result?.content?.[0]?.text ?? "";
};

const setup = async () => {
  const owner = await createUser();
  const seed = await seedPlannerTrip(owner.id);
  return { seed, token: await issueAccessToken(owner.id) };
};

const move = (token: string, seed: Awaited<ReturnType<typeof seedPlannerTrip>>) =>
  callTool(token, "move_activity_to_day", { tripId: seed.trip.id, activityId: seed.museum.id, dayId: seed.day3.id });

const parkChangeId = async () => (await prisma.aiChange.findFirstOrThrow({ where: { action: "parked" } })).id;

describe("move_activity_to_day when the schedule fails after the park", () => {
  it("names the park's change when the schedule throws", async () => {
    const { seed, token } = await setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(scheduleParkedDayPlanItemForTripDay).mockRejectedValueOnce(new Error("boom"));

    const text = errorText(await move(token, seed));
    expect(text).toBe(
      "The activity was taken off its day but could not be put on the target day; it is now in the bucket list " +
        `(AI change ${await parkChangeId()}; undo it with undo_ai_change or schedule it with schedule_activity).`,
    );
    expect((await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } })).tripDayId).toBeNull();
    expect(await prisma.aiChange.count()).toBe(1);
    errors.mockRestore();
  });

  it("says the target day was not found, and names the park's change", async () => {
    const { seed, token } = await setup();
    vi.mocked(scheduleParkedDayPlanItemForTripDay).mockResolvedValueOnce({ status: "not_found" });

    const text = errorText(await move(token, seed));
    expect(text).toContain("the target day was not found");
    expect(text).toContain(`AI change ${await parkChangeId()}`);
  });

  it("says the activity left the bucket list in the meantime, and names the park's change", async () => {
    const { seed, token } = await setup();
    vi.mocked(scheduleParkedDayPlanItemForTripDay).mockResolvedValueOnce({ status: "missing" });

    const text = errorText(await move(token, seed));
    expect(text).toContain("it had left the bucket list before it could be scheduled");
    expect(text).toContain(`AI change ${await parkChangeId()}`);
  });
});
