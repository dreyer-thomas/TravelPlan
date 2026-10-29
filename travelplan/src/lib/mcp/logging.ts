import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Story 15.1, AC 20. One log line per tool call: name, user, outcome, duration. Never the arguments - they
 * carry trip content once the write tools exist, and the log is not the place for it.
 *
 * Story 15.2, AC 10: a trip-scoped tool adds `trip=<id>`; without a trip id the line is 15.1's, unchanged.
 */
export const logToolCall = async (
  name: string,
  userId: string | null,
  run: () => Promise<CallToolResult>,
  tripId?: string,
): Promise<CallToolResult> => {
  const started = Date.now();
  let outcome: "ok" | "error" = "error";
  try {
    const result = await run();
    outcome = result.isError ? "error" : "ok";
    return result;
  } finally {
    const trip = tripId === undefined ? "" : ` trip=${tripId}`;
    console.info(`mcp: tool=${name} user=${userId ?? "-"}${trip} outcome=${outcome} ms=${Date.now() - started}`);
  }
};

export const toolError = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});
