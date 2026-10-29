import type { McpServer } from "@modelcontextprotocol/server";
import { countPlannableTripsForUser } from "@/lib/auth/tripAccess";
import { toolError } from "@/lib/mcp/logging";
import { READ_ONLY_TOOL_ANNOTATIONS, runTool, toolResult } from "@/lib/mcp/toolRuntime";
import { getUserEmailById } from "@/lib/repositories/userRepo";

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
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (ctx) =>
      runTool({ name: "whoami", ctx }, async (userId) => {
        const email = await getUserEmailById(userId);
        if (email === null) return toolError("Account not found");
        const plannableTrips = await countPlannableTripsForUser(userId);
        return toolResult({ email, plannableTrips });
      }),
  );
};
