import type { McpServer } from "@modelcontextprotocol/server";
import { countPlannableTripsForUser } from "@/lib/auth/tripAccess";
import { prisma } from "@/lib/db/prisma";
import { logToolCall, toolError } from "@/lib/mcp/logging";
import { userIdFromAuthInfo } from "@/lib/mcp/verifier";

/**
 * Story 15.1, AC 20. The connector's first tool: proves the whole chain (OAuth, bearer check, user
 * resolution) without exposing trip data. Answers the email and how many trips the user may plan.
 */
export const registerWhoamiTool = (server: McpServer) => {
  server.registerTool(
    "whoami",
    {
      title: "Who am I in TravelPlan",
      description:
        "Returns the email address of the TravelPlan account this connection acts for, and the number of trips that account may plan (as owner or contributor).",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (ctx) => {
      const userId = userIdFromAuthInfo(ctx.http?.authInfo);
      return logToolCall("whoami", userId, async () => {
        if (!userId) return toolError("Not authenticated");
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (!user) return toolError("Account not found");
        const plannableTrips = await countPlannableTripsForUser(userId);
        const result = { email: user.email, plannableTrips };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      });
    },
  );
};
