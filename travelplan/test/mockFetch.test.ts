import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchResponse, requestUrl, stubFetch } from "./helpers/mockFetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Covers the response builder ~267 fixtures across six component suites now go through.
 *
 * Those suites assert on what their components do with a response, not on the response itself, so a
 * change to the derivation here - an `ok` that stops following the status, a `headers` that stops
 * being a real `Headers` - would move every one of them at once and none of them would say so. This is
 * the only place the contract itself is asserted.
 */
describe("mockFetchResponse", () => {
  it("defaults to a 200 that is ok and resolves the body", async () => {
    const response = mockFetchResponse({ data: 1 });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: 1 });
  });

  it("derives ok from the status", () => {
    expect(mockFetchResponse(undefined, { status: 404 }).ok).toBe(false);
    expect(mockFetchResponse(undefined, { status: 500 }).ok).toBe(false);
    expect(mockFetchResponse(undefined, { status: 299 }).ok).toBe(true);
  });

  it("reports a 3xx as not ok, the way a real Response does", () => {
    // The distinction a `status < 400` derivation gets wrong. No fixture sends a 3xx today, which is
    // exactly why this needs asserting rather than discovering.
    expect(mockFetchResponse(undefined, { status: 302 }).ok).toBe(false);
    expect(new Response(null, { status: 302 }).ok).toBe(false);
  });

  it("lets an explicit ok win over the derived one, in both directions", () => {
    expect(mockFetchResponse(undefined, { status: 500, ok: true }).ok).toBe(true);
    expect(mockFetchResponse(undefined, { status: 200, ok: false }).ok).toBe(false);
  });

  it("takes a json override, so a fixture can make the read itself fail", async () => {
    const response = mockFetchResponse(undefined, {
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    });

    await expect(response.json()).rejects.toThrow(SyntaxError);
  });

  it("wraps headers in a real Headers, so an absent name reads back as null", () => {
    const response = mockFetchResponse(undefined, { headers: { "content-disposition": "attachment" } });

    expect(response.headers.get("content-disposition")).toBe("attachment");
    // Case-insensitive lookup and a `null` miss are the two things a plain object gets wrong.
    expect(response.headers.get("Content-Disposition")).toBe("attachment");
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("carries a Headers even when none was supplied", () => {
    expect(mockFetchResponse({}).headers.get("content-type")).toBeNull();
  });

  it("omits blob unless it is supplied, so an unstubbed byte read fails loudly", async () => {
    expect("blob" in mockFetchResponse({})).toBe(false);

    const withBlob = mockFetchResponse(undefined, { blob: () => Promise.resolve(new Blob(["x"])) });
    await expect(withBlob.blob()).resolves.toBeInstanceOf(Blob);
  });
});

describe("requestUrl", () => {
  it("reads the URL out of all three members of RequestInfo | URL", () => {
    expect(requestUrl("/api/trips/trip-1")).toBe("/api/trips/trip-1");
    expect(requestUrl(new URL("https://example.com/api/trips"))).toBe("https://example.com/api/trips");
    expect(requestUrl(new Request("https://example.com/api/trips/trip-1"))).toBe("https://example.com/api/trips/trip-1");
  });

  it("does not stringify a Request, which is what the route-aware stubs depend on", () => {
    // The failure this exists to prevent: `String(new Request(...))` is `"[object Request]"`, so every
    // `url.includes("/api/…")` branch falls through to the stub's catch-all and the suite asserts the
    // wrong response with nothing naming the cause.
    expect(requestUrl(new Request("https://example.com/documents/packet"))).toContain("/documents/packet");
    expect(String(new Request("https://example.com/documents/packet"))).toBe("[object Request]");
  });
});

describe("stubFetch", () => {
  it("installs the mock as the global fetch and hands it back still typed as a Mock", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse({ data: "ok" }));
    const returned = stubFetch(fetchMock);

    expect(returned).toBe(fetchMock);

    const response = await fetch("/api/trips");

    await expect(response.json()).resolves.toEqual({ data: "ok" });
    // The point of returning the mock rather than a `typeof fetch`: `.mock` survives, and so does the
    // type of what it recorded. A cast on the variable instead of the boundary loses both.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});
