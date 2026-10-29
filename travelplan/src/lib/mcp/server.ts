import { McpServer } from "@modelcontextprotocol/server";
import { registerWhoamiTool } from "@/lib/mcp/tools/whoami";

/**
 * Story 15.1. One fresh server per HTTP request (stateless). Tools live in `tools/`, one file per area,
 * and call repositories only (Epic 15 shared rules).
 */
export const createTravelPlanMcpServer = () => {
  const server = new McpServer({ name: "travelplan", version: "1.0.0" });
  registerWhoamiTool(server);
  return server;
};
