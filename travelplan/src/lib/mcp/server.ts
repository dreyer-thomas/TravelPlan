import { McpServer } from "@modelcontextprotocol/server";
import { registerActivityWriteTools } from "@/lib/mcp/tools/activityWrite";
import { registerAiChangeTools } from "@/lib/mcp/tools/aiChanges";
import { registerDayPlanApplyTools } from "@/lib/mcp/tools/dayPlanApply";
import { registerDayWriteTools } from "@/lib/mcp/tools/dayWrite";
import { registerFileTools } from "@/lib/mcp/tools/fileTools";
import { registerLegWriteTools } from "@/lib/mcp/tools/legWrite";
import { registerStayWriteTools } from "@/lib/mcp/tools/stayWrite";
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
  // Story 15.5.
  registerDayPlanApplyTools(server);
  // Story 15.6.
  registerStayWriteTools(server);
  registerLegWriteTools(server);
  // Story 15.7.
  registerFileTools(server);
  // Story 15.9.
  registerDayWriteTools(server);
  return server;
};
