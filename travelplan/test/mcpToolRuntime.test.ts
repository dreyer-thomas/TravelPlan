import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerContext } from "@modelcontextprotocol/server";
import { runTool } from "@/lib/mcp/toolRuntime";

/** Story 15.2, AC 10. The paths of the shared wrapper the route tests cannot reach on demand. */

const ctxFor = (userId: string | null) =>
  ({ http: { authInfo: userId ? { token: "t", clientId: "c", scopes: [], extra: { userId } } : undefined } }) as unknown as ServerContext;

afterEach(() => vi.restoreAllMocks());

describe("runTool", () => {
  it("turns an unexpected exception into a generic tool error and logs the error's name only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await runTool({ name: "get_day", ctx: ctxFor(`runtime-${Date.now()}`), tripId: "trip1" }, async () => {
      throw new Error("SQLITE_BUSY at /var/secret/path");
    });
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "TravelPlan could not answer this request; try again." }],
    });
    expect(error).toHaveBeenCalledWith("mcp: tool=get_day failed", "Error");
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/ trip=trip1 outcome=error ms=\d+$/));
  });

  it("logs a Prisma-style error by name and code, never its message with the query arguments", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await runTool({ name: "get_day", ctx: ctxFor(`runtime-${Date.now()}`), tripId: "trip1" }, async () => {
      throw Object.assign(new Error("Invalid `prisma.trip.findFirst()` invocation: { where: { name: \"secret\" } }"), {
        name: "PrismaClientKnownRequestError",
        code: "P2025",
      });
    });
    expect(error).toHaveBeenCalledWith("mcp: tool=get_day failed", "PrismaClientKnownRequestError P2025");
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
  });

  it("refuses a call without a signed-in user before the handler runs", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const handler = vi.fn();
    const result = await runTool({ name: "list_trips", ctx: ctxFor(null) }, handler);
    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
