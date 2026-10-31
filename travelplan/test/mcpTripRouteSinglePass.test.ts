import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { cleanOAuthTables, createUser, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool, issueAccessToken } from "./helpers/mcpClient";
import { seedPlannerTrip } from "./helpers/plannerFixtures";

/**
 * Story 15.10, AC 8. `get_trip_route` reads the trip in one pass: one `getTripWithDaysForUser` call, no
 * query per day. Its own file because `vi.mock` applies to the whole module, as in
 * `tripImportTempFileOnThrow.test.ts`.
 */
const tripRead = vi.hoisted(() => ({ spy: vi.fn() }));

vi.mock("@/lib/repositories/tripRepo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/tripRepo")>("@/lib/repositories/tripRepo");
  tripRead.spy.mockImplementation(actual.getTripWithDaysForUser);
  return { ...actual, getTripWithDaysForUser: (...args: Parameters<typeof actual.getTripWithDaysForUser>) => tripRead.spy(...args) };
});

setupConnectorEnvironment();

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.trip.deleteMany();
  tripRead.spy.mockClear();
});

describe("get_trip_route single pass", () => {
  it("reads the three-day trip with exactly one getTripWithDaysForUser call", async () => {
    const owner = await createUser();
    const seed = await seedPlannerTrip(owner.id);
    const token = await issueAccessToken(owner.id);

    const body = await callTool(token, "get_trip_route", { tripId: seed.trip.id });
    expect(body.result?.isError).toBeFalsy();
    expect((body.result?.structuredContent as { days: unknown[] }).days).toHaveLength(3);
    expect(tripRead.spy).toHaveBeenCalledTimes(1);
    expect(tripRead.spy).toHaveBeenCalledWith(owner.id, seed.trip.id);
  });
});
