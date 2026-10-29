import { expect, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { costDeps } from "@/lib/mcp/costInput";
import { activityWriteDeps } from "@/lib/mcp/tools/activityWrite";
import { dayPlanApplyDeps } from "@/lib/mcp/tools/dayPlanApply";
import { fromDayChangeReceiptWire, type DayChangeReceipt } from "@/lib/trips/dayChangeReceipt";
import { storedDayChangeReceiptSchema } from "@/lib/validation/dayChangeReceiptSchemas";
import { createUser } from "./oauthFixtures";
import { callTool, issueAccessToken, type ToolCallBody } from "./mcpClient";
import { seedPlannerTrip } from "./plannerFixtures";

/**
 * Story 15.6. The shared harness of the connector's stay, leg and cost tests: the planner trip with an owner,
 * a contributor and a viewer, each with a real token, and every network seam stubbed to fail (geocoding,
 * routing, ECB) unless a test answers it.
 */

export const structured = <T>(body: ToolCallBody): T => {
  expect(body.result?.isError, JSON.stringify(body)).toBeFalsy();
  return body.result!.structuredContent as T;
};

export const errorText = (body: ToolCallBody) => {
  expect(body.result?.isError, JSON.stringify(body)).toBe(true);
  return body.result?.content?.[0]?.text ?? "";
};

export const setupConnectorTrip = async () => {
  const owner = await createUser();
  const contributor = await createUser();
  const viewer = await createUser();
  const seed = await seedPlannerTrip(owner.id);
  await prisma.tripMember.createMany({
    data: [
      { tripId: seed.trip.id, userId: contributor.id, role: "CONTRIBUTOR" },
      { tripId: seed.trip.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  return {
    seed,
    owner: { user: owner, token: await issueAccessToken(owner.id) },
    contributor: { user: contributor, token: await issueAccessToken(contributor.id) },
    viewer: { user: viewer, token: await issueAccessToken(viewer.id) },
  };
};

/** No test reaches Nominatim, OSRM or the ECB: an unstubbed call fails, as an outage would. */
export const stubNetworkSeams = () => {
  vi.spyOn(activityWriteDeps, "geocode").mockRejectedValue(new Error("no network in tests"));
  vi.spyOn(dayPlanApplyDeps, "route").mockRejectedValue(new Error("no network in tests"));
  vi.spyOn(costDeps, "rates").mockRejectedValue(new Error("no network in tests"));
};

export const getDay = async <T>(token: string, tripId: string, dayId: string) =>
  structured<T>(await callTool(token, "get_day", { tripId, dayId }));

export const storedReceipt = async (changeId: string): Promise<DayChangeReceipt> => {
  const row = await prisma.aiChange.findUniqueOrThrow({ where: { id: changeId } });
  return fromDayChangeReceiptWire(storedDayChangeReceiptSchema.parse(JSON.parse(row.receiptJson!)));
};

export const STALE_UNDO = "The day has changed since this change was made; it can no longer be undone.";
