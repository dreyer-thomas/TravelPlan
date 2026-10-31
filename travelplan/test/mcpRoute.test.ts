import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "@/app/api/mcp/route";
import { GET as getTrips } from "@/app/api/trips/route";
import { prisma } from "@/lib/db/prisma";
import { hashOpaqueToken } from "@/lib/oauth/secrets";
import {
  cleanOAuthTables,
  createUser,
  ISSUER,
  sessionCookieFor,
  setupConnectorEnvironment,
} from "./helpers/oauthFixtures";
import { issueAccessToken, MCP_URL, rpc } from "./helpers/mcpClient";

setupConnectorEnvironment();

const callWhoami = (token: string) =>
  POST(
    rpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } },
      { authorization: `Bearer ${token}` },
    ),
  );

type RpcResult = { result?: { structuredContent?: { email: string; plannableTrips: number }; isError?: boolean; tools?: { name: string }[]; serverInfo?: unknown }; error?: unknown };

beforeEach(async () => {
  await cleanOAuthTables();
});

describe("POST /api/mcp authentication", () => {
  it("answers 401 with the resource metadata challenge before any MCP processing", async () => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`);
    expect(challenge).toContain('scope="trips"');
    // RFC 6750 §3.1: no credentials, no error code.
    expect(challenge).not.toContain("error=");
  });

  it("enforces the 2 MB limit on a body sent without Content-Length", async () => {
    const user = await createUser();
    const token = await issueAccessToken(user.id);
    const chunk = new TextEncoder().encode("x".repeat(512 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 5) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(MCP_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body,
      duplex: "half",
    } as RequestInit);
    expect((await POST(request)).status).toBe(413);
  });

  it("refuses unknown, revoked, expired and wrong-audience tokens with invalid_token", async () => {
    const user = await createUser();
    const unknown = await callWhoami("not-a-token");
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("www-authenticate")).toContain("invalid_token");

    const revoked = await issueAccessToken(user.id);
    await prisma.oAuthToken.updateMany({ where: { tokenHash: hashOpaqueToken(revoked) }, data: { revokedAt: new Date() } });
    expect((await callWhoami(revoked)).status).toBe(401);

    const expired = await issueAccessToken(user.id);
    await prisma.oAuthToken.updateMany({
      where: { tokenHash: hashOpaqueToken(expired) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await callWhoami(expired)).status).toBe(401);

    const foreign = await issueAccessToken(user.id, "https://other.example/api/mcp");
    expect((await callWhoami(foreign)).status).toBe(401);
  });

  it("ignores the session cookie", async () => {
    const user = await createUser();
    const request = rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { cookie: await sessionCookieFor(user) });
    expect((await POST(request)).status).toBe(401);
  });

  it("never reads a token from the query string", async () => {
    const user = await createUser();
    const token = await issueAccessToken(user.id);
    const request = new Request(`${MCP_URL}?access_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect((await POST(request)).status).toBe(401);
  });

  it("answers 413 above 2 MB, 405 on GET and DELETE, 404 when off", async () => {
    const user = await createUser();
    const token = await issueAccessToken(user.id);
    const big = new Request(MCP_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "content-length": String(3 * 1024 * 1024),
      },
      body: "x".repeat(16),
    });
    expect((await POST(big)).status).toBe(413);
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
    process.env.MCP_ENABLED = "false";
    expect(GET().status).toBe(404);
    expect((await callWhoami(token)).status).toBe(404);
  });

  it("is not accepted by any other route", async () => {
    const user = await createUser();
    const token = await issueAccessToken(user.id);
    const response = await getTrips(
      new NextRequest(`${ISSUER}/api/trips`, { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(response.status).toBe(401);
  });
});

describe("whoami", () => {
  it("lists the tool and answers email and plannable trips (owner + contributor, not viewer)", async () => {
    const user = await createUser();
    const other = await createUser();
    const tripData = (ownerId: string, name: string) => ({
      userId: ownerId,
      name,
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-01-02"),
    });
    await prisma.trip.create({ data: tripData(user.id, "Owned") });
    const contributed = await prisma.trip.create({ data: tripData(other.id, "Contributed") });
    const viewed = await prisma.trip.create({ data: tripData(other.id, "Viewed") });
    await prisma.tripMember.create({ data: { tripId: contributed.id, userId: user.id, role: "CONTRIBUTOR" } });
    await prisma.tripMember.create({ data: { tripId: viewed.id, userId: user.id, role: "VIEWER" } });
    const token = await issueAccessToken(user.id);

    const list = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${token}` }));
    expect(list.status).toBe(200);
    const listed = (await list.json()) as RpcResult;
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual([
      "whoami",
      "list_trips",
      "get_trip",
      "get_day",
      "get_bucket_list",
      // Story 15.10.
      "get_trip_route",
      // Story 15.4.
      "create_activity",
      "update_activity",
      "delete_activity",
      "move_activity",
      "move_activity_to_day",
      "schedule_activity",
      "park_activity",
      "list_ai_changes",
      "undo_ai_change",
      // Story 15.5.
      "apply_day_plan",
      // Story 15.6.
      "set_stay",
      "delete_stay",
      "create_leg",
      "update_leg",
      "delete_leg",
      // Story 15.7.
      "get_file",
      "attach_file",
      "delete_file",
      // Story 15.9.
      "update_day",
    ]);

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await callWhoami(token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as RpcResult;
    expect(body.result?.isError).toBeFalsy();
    expect(body.result?.structuredContent).toEqual({ email: user.email, plannableTrips: 2 });
    expect(info).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^mcp: tool=whoami user=${user.id} outcome=ok ms=\\d+$`)));
    info.mockRestore();

    await prisma.trip.deleteMany({ where: { id: { in: [contributed.id, viewed.id] } } });
    await prisma.trip.deleteMany({ where: { userId: user.id } });
  });

  it("answers a 2026-07-28 request with a JSON body", async () => {
    const user = await createUser();
    const token = await issueAccessToken(user.id);
    const response = await POST(
      rpc(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "whoami",
            arguments: {},
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        },
        {
          authorization: `Bearer ${token}`,
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "whoami",
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as RpcResult;
    expect(body.result?.structuredContent).toEqual({ email: user.email, plannableTrips: 0 });
  });

  it("answers an initialize handshake for 2025-era clients", async () => {
    const user = await createUser();
    const token = await issueAccessToken(user.id);
    const response = await POST(
      rpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
        },
        { authorization: `Bearer ${token}` },
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as RpcResult;
    expect(body.result?.serverInfo).toMatchObject({ name: "travelplan" });
  });
});
