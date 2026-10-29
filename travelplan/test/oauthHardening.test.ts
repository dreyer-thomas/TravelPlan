import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { isNavigableUrl } from "@/lib/browser/assignLocation";

/** Story 15.1 review: the two browser-side guards around the connector's consent step. */
describe("connector hardening", () => {
  it("only navigates to http(s) targets", () => {
    expect(isNavigableUrl("https://claude.ai/api/mcp/auth_callback?code=x")).toBe(true);
    expect(isNavigableUrl("http://localhost:3118/callback?code=x")).toBe(true);
    expect(isNavigableUrl("/oauth/authorize?x=1")).toBe(true);
    expect(isNavigableUrl("javascript:alert(1)//?code=x")).toBe(false);
    expect(isNavigableUrl("JavaScript:alert(1)")).toBe(false);
    expect(isNavigableUrl("data:text/html,<script>1</script>")).toBe(false);
    expect(isNavigableUrl("claude://callback?code=x")).toBe(false);
  });

  it("forbids framing the consent page", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const oauth = rules.find((rule) => rule.source === "/oauth/:path*");
    expect(oauth?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ]),
    );
  });
});
