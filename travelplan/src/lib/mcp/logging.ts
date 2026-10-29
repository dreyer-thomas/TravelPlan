import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Story 15.1, AC 20. One log line per tool call: name, user, outcome, duration. Never the arguments - they
 * carry trip content once the write tools exist, and the log is not the place for it.
 */
export const logToolCall = async (
  name: string,
  userId: string | null,
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  const started = Date.now();
  let outcome: "ok" | "error" = "error";
  try {
    const result = await run();
    outcome = result.isError ? "error" : "ok";
    return result;
  } finally {
    console.info(`mcp: tool=${name} user=${userId ?? "-"} outcome=${outcome} ms=${Date.now() - started}`);
  }
};

export const toolError = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});
