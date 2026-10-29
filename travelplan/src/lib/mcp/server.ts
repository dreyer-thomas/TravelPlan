import { McpServer } from "@modelcontextprotocol/server";
import { registerActivityWriteTools } from "@/lib/mcp/tools/activityWrite";
import { registerAiChangeTools } from "@/lib/mcp/tools/aiChanges";
import { registerTripReadTools } from "@/lib/mcp/tools/tripRead";
import { registerWhoamiTool } from "@/lib/mcp/tools/whoami";

/**
 * Story 15.1. One fresh server per HTTP request (stateless). Tools live in `tools/`, one file per area,
 * and call repositories only (Epic 15 shared rules).
 */
export const createTravelPlanMcpServer = () => {
  const server = new McpServer({ name: "travelplan", version: "1.0.0" });
  registerWhoamiTool(server);
  registerTripReadTools(server);
  // Story 15.4.
  registerActivityWriteTools(server);
  registerAiChangeTools(server);
  return server;
};
