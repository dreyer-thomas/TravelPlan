import { vi } from "vitest";
import type { Mock } from "vitest";

/**
 * `fetch` stub plumbing for the component suites: a `Response`-shaped body builder, the preferred
 * place for the cast to `typeof fetch`, and the URL read every route-aware stub needs.
 *
 * Scope, stated plainly rather than as an invariant a reader would be wrong to trust: `stubFetch` is
 * where a *new* stub should install itself, and the six suites this helper landed in now hold no
 * `as unknown as typeof fetch` of their own - a claim worth re-checking with
 * `grep -c "as unknown as typeof fetch"` over those six rather than believing this sentence, because
 * two review passes running it was written before it was true. It is emphatically not the only cast in
 * `test/`: the same grep over `test/**` still counts roughly a hundred across two dozen suites. Those
 * are the safe placement (on the argument to `vi.stubGlobal`, not on the variable), so they are not
 * bugs, but converting them is separate work and this file cannot claim they are done.
 *
 * Two separate holes make this worth sharing rather than re-deriving per suite.
 *
 * The first is that `vi.stubGlobal`'s value parameter is `any`, so the ~89 hand-rolled
 * `{ ok, status, json }` literals the suites hand it were never checked against `Response` at all -
 * a stub could omit `status` or misspell `ok` and the compiler had nothing to say about it. Building
 * the response through `mockFetchResponse` puts a typed shape between the suite and the boundary, so
 * the envelope fields are checked even though the boundary itself still is not.
 *
 * Be precise about how far that reaches: `body` is `unknown`, so the *payload* is still unchecked.
 * Renaming a field in an API response does not break a single fixture at compile time. Typing the
 * body would mean threading a per-endpoint response contract through every call site, which is a
 * different piece of work - what this helper buys is a checked envelope, not a checked payload.
 *
 * The second is worse, because it looks like it works. Casting the *variable* -
 * `const fetchMock = vi.fn(...) as unknown as typeof fetch` - throws the `Mock` type away, so every
 * later `fetchMock.mock.calls` is a TS2339, that expression degrades to `any`, and the callbacks
 * reading it become implicit-`any`: the assertions still run, but nothing inside them is checked.
 * Casting at the `vi.stubGlobal` call site instead costs nothing and keeps `.mock` typed. `stubFetch`
 * *is* that call, so no suite has to remember which of the two placements is the safe one.
 * `test/adminUsersList.test.tsx` and `test/tripShareDialog.test.tsx` are the two suites that already
 * had the placement right, and remain readable references for the pattern.
 */

export type MockResponseInit = {
  /**
   * Defaults to `status >= 200 && status < 300`, which is what a real `Response` reports - a 3xx is
   * *not* `ok`. Pass it only to build a deliberately inconsistent response, e.g. an `ok` that
   * disagrees with the status line.
   */
  ok?: boolean;
  /** Defaults to 200. */
  status?: number;
  /**
   * Defaults to resolving `body`. Override it to make the read itself fail: a non-JSON body rejects
   * here, and a success path that must never read the envelope throws here, which turns "unlikely"
   * into "visible".
   */
  json?: () => Promise<unknown>;
  /**
   * Wrapped in a real `Headers`, so lookups are case-insensitive and an absent name reads back as
   * `null` rather than `undefined` - the distinction a plain object gets wrong.
   */
  headers?: Record<string, string>;
  /**
   * Only present on the result when supplied: a stub that never serves bytes should not offer a
   * `blob()`, or a component reading the wrong one of the two bodies still passes.
   */
  blob?: () => Promise<Blob>;
};

/**
 * Minimal `Response` stand-in for a `fetch` stub.
 *
 * Deliberately carries only what the suites read - `ok`, `status`, `json`, `headers` and an optional
 * `blob`. `text`, `arrayBuffer`, `clone` and `formData` are absent because nothing calls them, and a
 * fixture that answers a call production never makes proves nothing. The single cast is the price of
 * a partial `Response`; keeping it here is what stops it from being re-invented at every call site.
 */
export const mockFetchResponse = (body?: unknown, init: MockResponseInit = {}): Response => {
  const status = init.status ?? 200;

  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    json: init.json ?? (async () => body),
    headers: new Headers(init.headers),
    ...(init.blob ? { blob: init.blob } : {}),
  } as unknown as Response;
};

/**
 * Install a mock as the global `fetch` and hand it straight back, still typed as a `Mock`.
 *
 * The cast lives on the argument to `vi.stubGlobal` and nowhere else, so the caller's variable keeps
 * its call-argument and return types: `fetchMock.mock.calls[0]?.[0]` stays checked, and so does every
 * callback that destructures it.
 *
 * The constraint is the `fetch` signature rather than a bare `Mock`, which would default to
 * `Mock<(...args: any[]) => any>` and accept literally anything - `stubFetch(vi.fn(async () => 42))`
 * would install a number as the global `fetch`, and the component would fail on
 * `response.json is not a function` with nothing pointing at the stub. Naming the signature moves that
 * to the call site. It costs no existing caller: every one already resolves a `mockFetchResponse`.
 */
export const stubFetch = <T extends Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>(
  mock: T,
): T => {
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
};

/**
 * The URL a `fetch` argument names, for the route-aware stubs that branch on it.
 *
 * `String(input)` alone is wrong for the third member of `RequestInfo | URL`: a `Request` stringifies to
 * `"[object Request]"`, so every `url.includes("/api/…")` branch falls through to the stub's catch-all
 * and the test asserts the wrong response with nothing pointing at why. Nothing in `src/` builds a
 * `Request` today, which is exactly why the loss would go unnoticed until it did.
 */
export const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);
