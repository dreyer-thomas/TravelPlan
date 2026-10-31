/**
 * Runs once per server process, before the first request is served.
 *
 * Two checks live here - the media root and the SMTP settings (Story 8.8) - and they are here rather
 * than in a route handler for the same reason: both are knowable at startup, and a deploy that gets
 * them wrong should fail while an operator is still watching. Left to the per-call throw in
 * `getMediaRoot()`, a misconfigured server boots, binds its port and passes a health check, and the
 * first symptom is a 500 on a thumbnail with the explanation buried in a log - by which point the deploy
 * looks successful. Story 8.3's AC8a asked for refusal to *start*, and this is what makes that true.
 * For mail the per-call alternative is worse still: a password-reset request answers success whether or
 * not the mail went out (so it does not reveal which addresses have accounts), so a missing setting
 * would surface only as a log line nobody reads. Until Story 8.8 reset mail was never sent at all.
 *
 * **Both guards below are load-bearing.** Next still evaluates this file for the edge runtime - the
 * instrumentation hook is the one entry point compiled for both, `runDependingOnPageType` calling
 * `onServer()` *and* `onEdgeServer()` for it - and `node:fs` does not exist there. So the check is gated
 * on `NEXT_RUNTIME` and the modules are imported dynamically *inside* that branch. The SMTP check is
 * kept free of `nodemailer` (`net`, `tls`) for the same reason; only `email.ts` imports the transport.
 *
 * That is not hypothetical; it happened once. Note what has changed since, so the next reader measures
 * the risk correctly rather than dismissing it: when the incident occurred the request gate was
 * `src/middleware.ts` and ran as an edge function, so a stray top-level `node:fs` import answered 500 on
 * *every matched request*, the home page included. Story 8.2 moved that gate to `src/proxy.ts`, which
 * Next always builds for Node, so the blast radius is now this file's own edge bundle rather than the
 * whole site. Smaller, not gone - this file is still compiled for the edge, so both guards stay.
 *
 * Deliberately quiet on success, and deliberately narrow: anything that throws here takes the whole
 * server down, so only configuration whose absence silently breaks a feature belongs here - not
 * unrelated startup work.
 */
export const register = async () => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { assertMediaRootConfigured } = await import("@/lib/trips/mediaRootBoot");
  assertMediaRootConfigured();
  const { assertSmtpConfigured } = await import("@/lib/notifications/smtpConfig");
  assertSmtpConfigured();
  // Story 15.1: with the connector on, a wrong APP_BASE_URL yields an issuer Claude silently cannot use.
  const { assertMcpConfigured } = await import("@/lib/oauth/config");
  assertMcpConfigured();
  // Story 15.8: without the link secret every downloadUrl the connector hands out would be null.
  const { assertFileLinksConfigured } = await import("@/lib/files/fileLinks");
  assertFileLinksConfigured();
};
