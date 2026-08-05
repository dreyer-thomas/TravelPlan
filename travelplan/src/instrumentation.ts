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
 * **Both guards below are load-bearing.** Next also evaluates this file for the edge runtime, where
 * `node:fs` does not exist - so the check is gated on `NEXT_RUNTIME` and the module that needs `fs` is
 * imported dynamically *inside* that branch. A static top-level import would pull `node:fs` into the
 * edge bundle and every middleware-matched request would answer 500 with
 * `Native module not found: node:fs`, the home page included. That is not hypothetical; it happened
 * once and this comment is why it will not again.
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
