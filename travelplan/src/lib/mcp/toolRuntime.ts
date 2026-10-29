import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
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

/** Story 15.4. A write that adds or moves content and can be undone with `undo_ai_change`. */
export const WRITE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Story 15.4. A write that overwrites or removes what is there (edit, delete, undo). */
export const DESTRUCTIVE_WRITE_TOOL_ANNOTATIONS = { ...WRITE_TOOL_ANNOTATIONS, destructiveHint: true } as const;

/**
 * Story 15.4. What a handler knows about the caller beyond the user: the OAuth client's id, its Client ID
 * Metadata Document URL, which the connector records on every stored change. `null` when the token carries
 * none: read tools do not need it, and a write tool refuses with `NOT_AUTHENTICATED` rather than record a
 * change without a client.
 */
export type ToolCaller = { clientId: string | null };

export const NOT_AUTHENTICATED = "Not authenticated";

/**
 * Database ids are cuids; the character set also keeps the id safe to put in the log line. Story 15.4
 * moved it here from `tools/tripRead.ts` so every tool file shares it.
 */
export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Not a TravelPlan id");

export const TRIP_NOT_FOUND = "Trip not found";
export const DAY_NOT_FOUND = "Day not found";

const describeToolError = (error: unknown) => {
  if (!(error instanceof Error)) return "unknown error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} ${code}` : error.name;
};

export const runTool = async (
  params: { name: string; ctx: ServerContext; tripId?: string },
  handler: (userId: string, caller: ToolCaller) => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  const authInfo = params.ctx.http?.authInfo;
  const userId = userIdFromAuthInfo(authInfo);
  const caller: ToolCaller = { clientId: authInfo?.clientId?.trim() || null };
  return logToolCall(
    params.name,
    userId,
    async () => {
      if (!userId) return toolError(NOT_AUTHENTICATED);
      if (!checkRateLimit(`mcp-tool:${userId}`, TOOL_RATE_LIMIT, TOOL_RATE_WINDOW_MS).ok) {
        return toolError(
          `Rate limit reached: at most ${TOOL_RATE_LIMIT} TravelPlan tool calls per minute. Wait a minute and try again.`,
        );
      }
      try {
        return await handler(userId, caller);
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
