import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { canTripAccessRoleWrite, getTripAccessForUser } from "@/lib/auth/tripAccess";
import { logToolCall, toolError } from "@/lib/mcp/logging";
import { userIdFromAuthInfo } from "@/lib/mcp/verifier";
import { checkRateLimit } from "@/lib/security/rateLimit";

/**
 * Story 15.2, AC 10-12. The Epic 15 shared rules every tool runs under, in one place: the signed-in user
 * from the bearer token only, a per-user rate limit, one log line per call, and no internal error text
 * reaching the model.
 */

export const TOOL_RATE_LIMIT = 120;
export const TOOL_RATE_WINDOW_MS = 60_000;

export const READ_ONLY_TOOL_ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

export const TRIP_NOT_FOUND = "Trip not found";
export const DAY_NOT_FOUND = "Day not found";

const describeToolError = (error: unknown) => {
  if (!(error instanceof Error)) return "unknown error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} ${code}` : error.name;
};

export const runTool = async (
  params: { name: string; ctx: ServerContext; tripId?: string },
  handler: (userId: string) => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  const userId = userIdFromAuthInfo(params.ctx.http?.authInfo);
  return logToolCall(
    params.name,
    userId,
    async () => {
      if (!userId) return toolError("Not authenticated");
      if (!checkRateLimit(`mcp-tool:${userId}`, TOOL_RATE_LIMIT, TOOL_RATE_WINDOW_MS).ok) {
        return toolError(
          `Rate limit reached: at most ${TOOL_RATE_LIMIT} TravelPlan tool calls per minute. Wait a minute and try again.`,
        );
      }
      try {
        return await handler(userId);
      } catch (error) {
        // The error's name and Prisma code only: a Prisma message quotes the query's arguments, which carry
        // trip content (and 15.4's write payloads).
        console.error(`mcp: tool=${params.name} failed`, describeToolError(error));
        return toolError("TravelPlan could not answer this request; try again.");
      }
    },
    params.tripId,
  );
};

/** The result as `structuredContent` and as one text item with the same JSON, as `whoami` answers. */
export const toolResult = (value: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

/**
 * Ruling R1: a trip the user cannot write does not exist for the connector. A viewer, a removed member and
 * a stranger get the same `Trip not found` as an id that names nothing, so the answer leaks no existence
 * (unlike `refuseUnlessTripWriter`, whose 403 for viewers is right for the app and wrong here).
 */
export const requireWritableTrip = async (userId: string, tripId: string): Promise<true | CallToolResult> => {
  const access = await getTripAccessForUser(userId, tripId);
  return canTripAccessRoleWrite(access?.accessRole) ? true : toolError(TRIP_NOT_FOUND);
};
