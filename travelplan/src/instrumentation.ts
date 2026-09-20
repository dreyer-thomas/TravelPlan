/**
 * Runs once per server process, before the first request is served.
 *
 * The only thing here is the media-root check, and it is here rather than in a route handler for one
 * reason: `MEDIA_STORAGE_ROOT` is knowable at startup, and a deploy that gets it wrong should fail
 * while an operator is still watching. Left to the per-call throw in `getMediaRoot()`, a misconfigured
 * server boots, binds its port and passes a health check, and the first symptom is a 500 on a
 * thumbnail with the explanation buried in a log - by which point the deploy looks successful. Story
 * 8.3's AC8a asked for refusal to *start*, and this is what makes that true.
 *
 * **Both guards below are load-bearing.** Next still evaluates this file for the edge runtime - the
 * instrumentation hook is the one entry point compiled for both, `runDependingOnPageType` calling
 * `onServer()` *and* `onEdgeServer()` for it - and `node:fs` does not exist there. So the check is gated
 * on `NEXT_RUNTIME` and the module that needs `fs` is imported dynamically *inside* that branch.
 *
 * That is not hypothetical; it happened once. Note what has changed since, so the next reader measures
 * the risk correctly rather than dismissing it: when the incident occurred the request gate was
 * `src/middleware.ts` and ran as an edge function, so a stray top-level `node:fs` import answered 500 on
 * *every matched request*, the home page included. Story 8.2 moved that gate to `src/proxy.ts`, which
 * Next always builds for Node, so the blast radius is now this file's own edge bundle rather than the
 * whole site. Smaller, not gone - this file is still compiled for the edge, so both guards stay.
 *
 * Deliberately quiet on success, and deliberately narrow: anything that throws here takes the whole
 * server down, so this must not become where unrelated startup work accumulates.
 */
export const register = async () => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { assertMediaRootConfigured } = await import("@/lib/trips/mediaRootBoot");
  assertMediaRootConfigured();
};
