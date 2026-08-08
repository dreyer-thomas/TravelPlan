import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  annotations,
  collectFindings,
  evaluate,
  formatReport,
  parseAllowlist,
  parseAuditReport,
  reportPlausibilityError,
} from "../scripts/audit-check.mjs";

/**
 * `scripts/audit-check.mjs` - the gate behind `npm run audit:check` and the Security Audit workflow.
 *
 * The whole reason the script's logic is exported as pure functions is this file. A gate is only ever
 * observed in one state - green - and the branches that decide anything else (an expiry that lapsed
 * overnight, an allowlist somebody broke while editing it, npm failing to reach the registry) are by
 * construction never exercised until the day they are load-bearing. So every one of them is asserted
 * here against fixtures, with `now` injected, rather than being discovered in CI.
 *
 * Nothing here touches the network or the database: `collectFindings` is fed the same report shape
 * `npm audit --omit=dev --json` emits, and the two real findings used as fixtures are the ones this
 * change actually lifted (`fast-uri`, `nanoid`), so the shape stays honest. The final block does run
 * the script as a process, but against a stub `npm` on PATH - because the thing it asserts, the exit
 * code, is the one thing no pure function can be made to prove.
 */

/** The `via` shape npm emits for a real advisory - trimmed to the fields the script reads. */
const fastUriVia = {
  source: 1112103,
  name: "fast-uri",
  dependency: "fast-uri",
  title: "fast-uri Improper Handling of Alternate Encoding vulnerability",
  url: "https://github.com/advisories/GHSA-7p8r-x3mc-p8w7",
  severity: "high",
  cwe: ["CWE-172"],
  cvss: { score: 7.5, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" },
  range: "<3.1.5",
};

const nanoidVia = {
  source: 1109462,
  name: "nanoid",
  dependency: "nanoid",
  title: "nanoid has predictable results with non-integer input",
  url: "https://github.com/advisories/GHSA-2v37-7h3g-55p8",
  severity: "high",
  range: "<3.3.18",
};

const auditReportWith = (via: unknown[]) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(
    via.map((entry, index) => {
      const advisory = entry as { name?: string; severity?: string; range?: string };
      const name = advisory.name ?? `package-${index}`;
      return [
        name,
        {
          name,
          severity: advisory.severity ?? "high",
          isDirect: false,
          via: [entry],
          effects: [],
          range: advisory.range ?? "*",
          nodes: [`node_modules/${name}`],
          fixAvailable: true,
        },
      ];
    }),
  ),
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: via.length, critical: 0, total: via.length },
    // `parseAuditReport` requires both counts, because they are what `reportPlausibilityError`
    // cross-checks its own reading against. Real reports always carry them; so must the fixtures.
    dependencies: { prod: 333, dev: 498, optional: 123, peer: 7, peerOptional: 0, total: 873 },
  },
});

const allowlistJson = (advisories: unknown[]) => JSON.stringify({ $comment: "ignored", advisories });

/** The `metadata` block every version-2 report carries, as a JSON fragment for string fixtures. */
const METADATA = '"metadata":{"vulnerabilities":{"total":0},"dependencies":{"prod":333,"total":873}}';

const entry = (overrides: Record<string, unknown> = {}) => ({
  advisory: "GHSA-7p8r-x3mc-p8w7",
  package: "fast-uri",
  justification: "No fixed release upstream; only reachable from the CLI.",
  expires: "2026-10-01",
  ...overrides,
});

const at = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * Every `parseAllowlist` call in this file pins `now`, because the 180-day expiry ceiling makes the
 * function time-dependent: a fixture with a hard-coded date would start failing on a date nobody
 * chose. `2026-08-08` is this change's own day, and every fixture expiry is written relative to it.
 */
const NOW = "2026-08-08";
const parseAt = (raw: string, day: string = NOW) => parseAllowlist(raw, { now: at(day) });
const entriesFrom = (advisories: unknown[], day: string = NOW) => parseAt(allowlistJson(advisories), day).entries;

describe("collectFindings", () => {
  it("reads the GHSA id out of the advisory url, not npm's numeric source", () => {
    // `via[].source` is an npm-internal advisory number; the GHSA id is what a human looks up and what
    // the allowlist keys on, so getting this wrong would make every suppression unwritable.
    const [finding] = collectFindings(auditReportWith([fastUriVia]));

    expect(finding).toEqual({
      package: "fast-uri",
      severity: "high",
      advisoryId: "GHSA-7p8r-x3mc-p8w7",
      title: fastUriVia.title,
      url: fastUriVia.url,
      range: "<3.1.5",
    });
  });

  it("skips string `via` entries, which are cross-references rather than advisories", () => {
    // npm lists an affected package's parents with their `via` set to the child's *name*. Counting
    // those would report one CVE as several findings, none of which carries an id to suppress it by.
    const report = {
      auditReportVersion: 2,
      vulnerabilities: {
        nanoid: { name: "nanoid", severity: "high", via: [nanoidVia], range: "<3.3.18" },
        postcss: { name: "postcss", severity: "high", via: ["nanoid"], range: "*" },
      },
    };

    const findings = collectFindings(report);

    expect(findings).toHaveLength(1);
    expect(findings[0].advisoryId).toBe("GHSA-2v37-7h3g-55p8");
  });

  it("deduplicates the same advisory reported against the same package twice", () => {
    const report = {
      vulnerabilities: {
        "fast-uri": { name: "fast-uri", severity: "high", via: [fastUriVia, { ...fastUriVia }] },
      },
    };

    expect(collectFindings(report)).toHaveLength(1);
  });

  it("keeps one advisory that hits two different packages as two findings", () => {
    const shared = { ...nanoidVia, name: "other-package" };
    const report = {
      vulnerabilities: {
        nanoid: { name: "nanoid", severity: "high", via: [nanoidVia] },
        "other-package": { name: "other-package", severity: "high", via: [shared] },
      },
    };

    expect(collectFindings(report).map((finding) => finding.package)).toEqual(["nanoid", "other-package"]);
  });

  it("tolerates a report with no vulnerabilities at all", () => {
    // The clean-tree row: this is what npm emits every day the gate is green.
    expect(collectFindings({ auditReportVersion: 2, vulnerabilities: {} })).toEqual([]);
    expect(collectFindings({})).toEqual([]);
    expect(collectFindings(null)).toEqual([]);
  });

  it("strips a query string or fragment before reading the advisory id", () => {
    // A decorated advisory link would otherwise mint an id ending in `?utm_source=...`, which no
    // allowlist entry could ever match - an unsuppressable finding created by a URL parameter.
    const decorated = collectFindings(
      auditReportWith([{ ...fastUriVia, url: `${fastUriVia.url}?utm_source=npm` }]),
    );
    const fragmented = collectFindings(auditReportWith([{ ...fastUriVia, url: `${fastUriVia.url}#readme` }]));

    expect(decorated[0].advisoryId).toBe("GHSA-7p8r-x3mc-p8w7");
    expect(fragmented[0].advisoryId).toBe("GHSA-7p8r-x3mc-p8w7");
  });

  it("refuses to walk a `vulnerabilities` that is an array", () => {
    // `typeof [] === "object"`, so without the guard `Object.entries` would turn array indices into
    // package names and invent findings called "0" and "1" out of a malformed report.
    expect(collectFindings({ vulnerabilities: [{ name: "fast-uri", via: [fastUriVia] }] })).toEqual([]);
  });

  it("skips a `via` element that is an array rather than an advisory object", () => {
    expect(collectFindings({ vulnerabilities: { "fast-uri": { name: "fast-uri", via: [[], null, "ajv"] } } })).toEqual(
      [],
    );
  });

  it("keeps two unnameable advisories on one package apart", () => {
    // Both fall back to a minted id. If that id were the same for both, the dedupe below would drop
    // the second - a real finding disappearing because it had no URL.
    const unnamed = { severity: "high", title: "one" };
    const findings = collectFindings({
      vulnerabilities: { pkg: { name: "pkg", severity: "high", via: [unnamed, { ...unnamed, title: "two" }] } },
    });

    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((finding) => finding.advisoryId)).size).toBe(2);
    // And deliberately *not* suppressable. The minted id is an ordinal over the whole report, so it
    // names a position rather than an advisory - see the ordinal-drift test below.
    expect(parseAt(allowlistJson([entry({ advisory: findings[0].advisoryId })])).errors).toHaveLength(1);
  });

  it("shifts an unnamed advisory's minted id when anything sorts ahead of it", () => {
    // Why `npm-advisory-unnamed-<n>` may never appear in the allowlist. The ordinal counts `via`
    // objects across the entire report, so one unrelated advisory on an earlier package renumbers
    // every id after it. An entry written to accept "unnamed-2" would then suppress a different,
    // unreviewed advisory - and print the wrong justification while doing it.
    const unnamed = [
      { severity: "high", title: "A" },
      { severity: "high", title: "B" },
    ];
    const idsFor = (vulnerabilities: Record<string, unknown>) =>
      Object.fromEntries(collectFindings({ vulnerabilities }).map((finding) => [finding.title, finding.advisoryId]));

    const alone = idsFor({ zpkg: { name: "zpkg", via: unnamed } });
    const crowded = idsFor({
      apkg: { name: "apkg", via: [{ severity: "high", title: "X" }] },
      zpkg: { name: "zpkg", via: unnamed },
    });

    expect(alone.B).toBe("npm-advisory-unnamed-2");
    expect(crowded.B).not.toBe(alone.B);
    expect(crowded.A).toBe("npm-advisory-unnamed-2");
  });

  it("falls back to npm's advisory number when the url's last segment is not a GHSA id", () => {
    // `https://www.npmjs.com/advisories/1234` would otherwise mint the advisory id `1234`, and
    // `https://example.com/` the id `example.com` - ids that block `main` and that no valid allowlist
    // entry may hold. A finding nobody can accept is the one shape the escape hatch must not have.
    const [numeric] = collectFindings(
      auditReportWith([{ ...fastUriVia, url: "https://www.npmjs.com/advisories/1234", source: 1234 }]),
    );
    const [hostOnly] = collectFindings(auditReportWith([{ ...fastUriVia, url: "https://example.com/", source: 4321 }]));

    expect(numeric.advisoryId).toBe("npm-advisory-1234");
    expect(hostOnly.advisoryId).toBe("npm-advisory-4321");
    expect(parseAt(allowlistJson([entry({ advisory: numeric.advisoryId })])).errors).toEqual([]);
  });

  it("finds the GHSA id anywhere in a github advisory path, not only in the last segment", () => {
    // The allowlist's own instructions tell a blocked reader to write the GHSA id from the advisory
    // URL. If a decorated link (`.../GHSA-xxxx-xxxx-xxxx/dependabot`) fell through to the numeric
    // fallback, that entry would never match: a suppression that reads as taken in the diff and does
    // nothing in CI, in the one emergency the allowlist exists for.
    const [decorated] = collectFindings(
      auditReportWith([{ ...fastUriVia, url: `${fastUriVia.url}/dependabot` }]),
    );

    expect(decorated.advisoryId).toBe("GHSA-7p8r-x3mc-p8w7");
  });

  it("reads a GHSA id only from github.com, never from a url the registry chose", () => {
    // `via[].url` arrives from the same place the vulnerable package did. Minting an id from any host
    // lets a package name itself as an advisory somebody already accepted and inherit its suppression.
    // Falling back to npm's own number keeps the finding blocking, which is the safe direction.
    const [spoofed] = collectFindings(
      auditReportWith([
        { ...fastUriVia, url: "https://anywhere.example/advisories/GHSA-7p8r-x3mc-p8w7", source: 5150 },
      ]),
    );
    const [wrongPath] = collectFindings(
      auditReportWith([{ ...fastUriVia, url: "https://github.com/some/repo/GHSA-7p8r-x3mc-p8w7", source: 5151 }]),
    );

    expect(spoofed.advisoryId).toBe("npm-advisory-5150");
    expect(wrongPath.advisoryId).toBe("npm-advisory-5151");
  });

  it("refuses to mint a fallback id from a `source` outside the range its own validator accepts", () => {
    // `npm-advisory--1` matches nothing `parseAllowlist` will take, so minting it would produce the
    // exact thing the numeric fallback exists to prevent: a finding that blocks with no way to accept
    // it. The ordinal is the honest answer for a number this script has no model of.
    const ids = collectFindings({
      auditReportVersion: 2,
      vulnerabilities: {
        pkg: { name: "pkg", via: [{ severity: "high", source: -1 }, { severity: "high", source: 0 }] },
      },
    }).map((finding) => finding.advisoryId);

    expect(ids).toEqual(["npm-advisory-unnamed-1", "npm-advisory-unnamed-2"]);
    expect(parseAt(allowlistJson([entry({ advisory: "npm-advisory--1" })])).errors).toHaveLength(1);
  });
});

describe("parseAllowlist", () => {
  it("accepts a well-formed entry and ignores the `$`-prefixed documentation fields", () => {
    const { entries, errors } = parseAt(allowlistJson([entry()]));

    expect(errors).toEqual([]);
    expect(entries).toEqual([
      {
        advisory: "GHSA-7p8r-x3mc-p8w7",
        package: "fast-uri",
        justification: "No fixed release upstream; only reachable from the CLI.",
        expires: "2026-10-01",
      },
    ]);
  });

  it("reads the file that actually ships, and finds it empty", () => {
    // The change is only safe to land because it suppresses nothing. If a future edit adds an entry,
    // this fails and forces the reviewer to look at it.
    //
    // The real clock, not the pinned `NOW`, precisely because of the 180-day ceiling: a legitimate
    // entry added next year against a pinned past date would fail here claiming it "expires more than
    // 180 days out", which would be a false statement about the file under test.
    const shipped = fs.readFileSync(path.resolve(__dirname, "..", "audit-allowlist.json"), "utf8");
    const { entries, errors } = parseAllowlist(shipped);

    expect(errors).toEqual([]);
    expect(entries).toEqual([]);
  });

  it("rejects invalid JSON without suppressing anything", () => {
    const { entries, errors } = parseAt("{ not json");

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/not valid JSON/);
  });

  it("rejects a document whose `advisories` is missing or not an array", () => {
    expect(parseAt(JSON.stringify({ $comment: "x" })).errors[0]).toMatch(/advisories/);
    expect(parseAt(JSON.stringify({ advisories: {} })).errors[0]).toMatch(/advisories/);
    expect(parseAt(JSON.stringify([])).errors[0]).toMatch(/object/);
    expect(parseAt(JSON.stringify({ advisories: {} })).entries).toEqual([]);
  });

  it("names every offending entry, one message per problem", () => {
    // Distinct advisory ids on purpose, so this asserts the four problems it means to and not the
    // duplicate-id rule tested separately below.
    const { entries, errors } = parseAt(
      allowlistJson([
        entry({ advisory: undefined }),
        entry({ advisory: "GHSA-2v37-7h3g-55p8", justification: "  " }),
        entry({ advisory: "GHSA-aaaa-bbbb-cccc", expires: "31-12-2026" }),
        entry({ advisory: "CVE-2026-1234" }),
      ]),
    );

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/advisories\[0\].*advisory/);
    expect(errors[1]).toMatch(/advisories\[1\].*justification/);
    expect(errors[2]).toMatch(/advisories\[2\].*expires/);
    expect(errors[3]).toMatch(/advisories\[3\].*GHSA/);
  });

  it("rejects a date that is well-formed but not a real day", () => {
    // `new Date("2026-02-30")` silently becomes March 2nd - an expiry later than whoever wrote it
    // intended, which is the only direction this file must never be wrong in.
    expect(parseAt(allowlistJson([entry({ expires: "2026-02-30" })])).errors[0]).toMatch(/not a real/);
    expect(parseAt(allowlistJson([entry({ expires: "2026-13-01" })])).errors[0]).toMatch(/not a real/);
    expect(parseAt(allowlistJson([entry({ expires: "2026-02-28" })])).errors).toEqual([]);
  });

  it("disarms the whole file when a single entry is broken - never a partial allowlist", () => {
    // Fail-closed. The dangerous failure of an allowlist is not "too few suppressions" (a red build
    // somebody looks at) but "one more than anyone reviewed" (a green build nobody looks at).
    const { entries, errors } = parseAt(
      allowlistJson([entry(), entry({ advisory: "GHSA-2v37-7h3g-55p8", expires: "yesterday" })]),
    );

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("rejects an entry that is not an object", () => {
    expect(parseAt(allowlistJson(["GHSA-7p8r-x3mc-p8w7"])).errors[0]).toMatch(/advisories\[0\] is not an object/);
  });

  it("refuses an expiry further out than the 180-day ceiling", () => {
    // Without a ceiling, `9999-12-31` is a perfectly valid calendar day and the expiry field becomes
    // decorative - a "temporary" exception that outlives everyone who could remember agreeing to it.
    expect(parseAt(allowlistJson([entry({ expires: "9999-12-31" })])).errors[0]).toMatch(/180 days/);
    expect(parseAt(allowlistJson([entry({ expires: "2027-08-08" })])).errors).toHaveLength(1);
    expect(parseAt(allowlistJson([entry({ expires: "9999-12-31" })])).entries).toEqual([]);

    // 180 days after 2026-08-08 is 2027-02-04: the boundary itself is allowed, the day after is not.
    expect(parseAt(allowlistJson([entry({ expires: "2027-02-04" })])).errors).toEqual([]);
    expect(parseAt(allowlistJson([entry({ expires: "2027-02-05" })])).errors).toHaveLength(1);
  });

  it("leaves an already-lapsed expiry to `evaluate` rather than calling the file malformed", () => {
    // Treating a lapsed date as a parse error would disarm the whole file, turning one expired
    // exception into every exception lapsing at once - and reporting it as the wrong problem.
    expect(parseAt(allowlistJson([entry({ expires: "2020-01-01" })])).errors).toEqual([]);
  });

  it("refuses a second entry for an advisory that already has one", () => {
    // Renewing by appending would show up in the diff as an addition rather than as somebody changing
    // a date they previously chose - which is the one thing a reviewer of this file is looking for.
    const { entries, errors } = parseAt(
      allowlistJson([entry({ expires: "2026-09-01" }), entry({ expires: "2026-12-01" })]),
    );

    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/duplicates an earlier entry/);
    expect(parseAt(allowlistJson([entry(), entry({ advisory: "ghsa-7p8r-X3MC-p8w7" })])).errors[0]).toMatch(
      /duplicates/,
    );
  });

  it("accepts the npm-advisory-<number> fallback so any nameable finding can be suppressed", () => {
    // An advisory npm reports without a GitHub URL would otherwise block `main` indefinitely with no
    // way to accept it - a hole in the escape hatch shaped exactly like the emergency it exists for.
    const { entries, errors } = parseAt(allowlistJson([entry({ advisory: "npm-advisory-1130720" })]));

    expect(errors).toEqual([]);
    expect(entries[0].advisory).toBe("npm-advisory-1130720");
  });

  it("refuses the ordinal fallback id, which names a position rather than an advisory", () => {
    // Accepting one would let a suppression drift onto whichever unnamed advisory happens to land at
    // that index later - the justification would still read as reviewed, for something nobody read.
    expect(parseAt(allowlistJson([entry({ advisory: "npm-advisory-unnamed-2" })])).errors[0]).toMatch(/GHSA/);
    expect(parseAt(allowlistJson([entry({ advisory: "npm-advisory-abc" })])).errors).toHaveLength(1);
  });

  it("refuses an entry carrying a field the script does not read", () => {
    // `expiry` for `expires`, or a `packages` array somebody wrote believing it scoped the
    // suppression: ignored silently, the diff reads as a narrower exception than the one applied.
    const { entries, errors } = parseAt(
      allowlistJson([{ ...entry(), packages: ["fast-uri"], expiry: "2026-08-09" }]),
    );

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/unrecognised field\(s\) "packages", "expiry"/);
  });

  it("refuses a `package` that is not a string, rather than dropping it silently", () => {
    // `"package": ["fast-uri", "ajv"]` reads in a diff as a suppression scoped to two packages. Silently
    // discarded it is scoped to none - the same mistake the unrecognised-key rule catches, wearing a
    // field name the parser accepts.
    expect(parseAt(allowlistJson([entry({ package: ["fast-uri"] })])).errors[0]).toMatch(/non-string "package"/);
    expect(parseAt(allowlistJson([entry({ package: 12345 })])).entries).toEqual([]);
    // Omitting it entirely is fine: it is documentation, and the script says so.
    const { advisory, justification, expires } = entry();
    expect(parseAt(allowlistJson([{ advisory, justification, expires }])).errors).toEqual([]);
  });

  it("tolerates a UTF-8 BOM rather than blaming JSON syntax for a file encoding", () => {
    // Fail-closed either way, but a BOM left unhandled disarms the whole allowlist permanently with a
    // message that sends the reader looking for a missing comma that is not there.
    const { entries, errors } = parseAt(`\uFEFF${allowlistJson([entry()])}`);

    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
  });
});

describe("evaluate", () => {
  const findings = collectFindings(auditReportWith([fastUriVia]));

  it("blocks a finding nobody listed", () => {
    const result = evaluate({ findings, entries: [], now: at("2026-08-08") });

    expect(result.blocking).toEqual(findings);
    expect(result.suppressed).toEqual([]);
    expect(result.expiredSuppressions).toEqual([]);
    expect(result.staleEntries).toEqual([]);
  });

  it("blocks everything when the allowlist is empty, which is also the absent-file state", () => {
    // `main()` treats a missing `audit-allowlist.json` as an empty entry list rather than an error, so
    // "the file is gone" and "the file suppresses nothing" have to be the same, strictest, behaviour.
    const both = collectFindings(auditReportWith([fastUriVia, nanoidVia]));

    expect(evaluate({ findings: both, entries: [], now: at("2026-08-08") }).blocking).toHaveLength(2);
  });

  it("suppresses a live entry and carries its justification through", () => {
    const entries = entriesFrom([entry()]);

    const result = evaluate({ findings, entries, now: at("2026-08-08") });

    expect(result.blocking).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].finding.advisoryId).toBe("GHSA-7p8r-x3mc-p8w7");
    expect(result.suppressed[0].entry.justification).toMatch(/No fixed release/);
  });

  it("matches the advisory id case-insensitively", () => {
    // GHSA ids are written lowercase in URLs and upper-cased in prose. A suppression that silently
    // fails to apply on letter case is the worst outcome: red build, and a reviewer who believes the
    // exception was taken.
    const entries = entriesFrom([entry({ advisory: "ghsa-7P8R-x3mc-P8W7" })]);

    expect(evaluate({ findings, entries, now: at("2026-08-08") }).blocking).toEqual([]);
  });

  it("still suppresses on the expiry day itself, and stops the day after", () => {
    const entries = entriesFrom([entry({ expires: "2026-08-08" })]);

    expect(evaluate({ findings, entries, now: at("2026-08-07") }).suppressed).toHaveLength(1);
    expect(evaluate({ findings, entries, now: at("2026-08-08") }).suppressed).toHaveLength(1);
    expect(evaluate({ findings, entries, now: at("2026-08-09") }).suppressed).toHaveLength(0);
  });

  it("refuses an expired suppression: the finding blocks and the entry is named", () => {
    const entries = entriesFrom([entry({ expires: "2026-08-07" })]);

    const result = evaluate({ findings, entries, now: at("2026-08-08") });

    expect(result.blocking).toEqual(findings);
    expect(result.suppressed).toEqual([]);
    expect(result.expiredSuppressions).toEqual(entries);
    // Expired is not stale: the advisory is still there, so the entry is doing work and must be
    // re-assessed rather than deleted.
    expect(result.staleEntries).toEqual([]);
  });

  it("warns about an entry that matches nothing without changing the verdict", () => {
    const entries = entriesFrom([entry({ advisory: "GHSA-2v37-7h3g-55p8" })]);

    const result = evaluate({ findings: [], entries, now: at("2026-08-08") });

    expect(result.staleEntries).toEqual(entries);
    expect(result.blocking).toEqual([]);
    expect(result.expiredSuppressions).toEqual([]);
  });

  it("calls an expired entry that matches nothing stale, not expired", () => {
    // Failing CI over a lapsed date for an advisory that is no longer in the tree would be a
    // self-inflicted break with no security meaning.
    const entries = entriesFrom([entry({ expires: "2020-01-01" })]);

    const result = evaluate({ findings: [], entries, now: at("2026-08-08") });

    expect(result.staleEntries).toEqual(entries);
    expect(result.expiredSuppressions).toEqual([]);
  });

  it("reports a clean tree as clean", () => {
    expect(evaluate({ findings: [], entries: [], now: at("2026-08-08") })).toEqual({
      blocking: [],
      suppressed: [],
      staleEntries: [],
      expiredSuppressions: [],
    });
  });

  it("does not call an advisory expired while another entry still covers it", () => {
    // `parseAllowlist` rejects duplicate ids, so this pair can only be built by hand - but if it ever
    // reached `evaluate`, reporting the lapsed one under "the findings above block" would be a
    // sentence the exit code contradicts: nothing blocks, because the live entry covers it.
    const expired = { advisory: "GHSA-7p8r-x3mc-p8w7", justification: "old", expires: "2026-08-01", package: null };
    const live = { advisory: "GHSA-7p8r-x3mc-p8w7", justification: "new", expires: "2026-09-01", package: null };

    const result = evaluate({ findings, entries: [expired, live], now: at("2026-08-08") });

    expect(result.blocking).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.expiredSuppressions).toEqual([]);
    expect(result.staleEntries).toEqual([]);
  });

  it("survives being called with nothing at all", () => {
    expect(evaluate()).toEqual({ blocking: [], suppressed: [], staleEntries: [], expiredSuppressions: [] });
  });
});

describe("formatReport", () => {
  const findings = collectFindings(auditReportWith([fastUriVia]));

  it("prints a single all-clear line when there is nothing to say", () => {
    const lines = formatReport(evaluate({ findings: [], entries: [], now: at("2026-08-08") }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/[Nn]o vulnerabilities/);
  });

  it("gives a blocked reader the package, severity, id, title and advisory url", () => {
    // Whoever reads this output is blocked and probably did not introduce the dependency: the advisory
    // page is the first thing they need and the last thing they should have to go looking for.
    const output = formatReport(evaluate({ findings, entries: [], now: at("2026-08-08") })).join("\n");

    expect(output).toContain("fast-uri");
    expect(output).toContain("high");
    expect(output).toContain("GHSA-7p8r-x3mc-p8w7");
    expect(output).toContain(fastUriVia.title);
    expect(output).toContain(fastUriVia.url);
  });

  it("shows a suppression with the reason and the date it lapses", () => {
    const entries = entriesFrom([entry({ expires: "2026-10-01" })]);

    const output = formatReport(evaluate({ findings, entries, now: at("2026-08-08") })).join("\n");

    expect(output).toContain("suppressed");
    expect(output).toContain("No fixed release upstream");
    expect(output).toContain("2026-10-01");
  });

  it("calls an expired suppression out explicitly, alongside the finding it stopped covering", () => {
    const entries = entriesFrom([entry({ expires: "2026-08-07" })]);

    const output = formatReport(evaluate({ findings, entries, now: at("2026-08-08") })).join("\n");

    expect(output).toMatch(/[Ee]xpired/);
    expect(output).toContain("2026-08-07");
    expect(output).toContain("GHSA-7p8r-x3mc-p8w7");
    expect(output).toContain("not suppressed");
  });

  it("nudges a stale entry towards deletion", () => {
    const entries = entriesFrom([entry({ advisory: "GHSA-2v37-7h3g-55p8" })]);

    const output = formatReport(evaluate({ findings: [], entries, now: at("2026-08-08") })).join("\n");

    expect(output).toMatch(/delete/i);
    expect(output).toContain("GHSA-2v37-7h3g-55p8");
  });
});

describe("parseAuditReport", () => {
  it("accepts the report npm writes, whatever exit code npm used to write it", () => {
    // npm exits 1 whenever it finds anything, which is the *normal* path for this script. The JSON is
    // the signal; treating the exit code as failure would turn every real finding into a crash.
    const { report, error } = parseAuditReport(JSON.stringify(auditReportWith([fastUriVia])));

    expect(error).toBeNull();
    expect(collectFindings(report)).toHaveLength(1);
  });

  it("accepts a clean report with an empty vulnerabilities map", () => {
    const { report, error } = parseAuditReport(`{"auditReportVersion":2,"vulnerabilities":{},${METADATA}}`);

    expect(error).toBeNull();
    expect(collectFindings(report)).toEqual([]);
  });

  it("refuses output that is not JSON rather than calling the tree clean", () => {
    const { report, error } = parseAuditReport("npm ERR! code ENOTFOUND\n");

    expect(report).toBeNull();
    expect(error).toMatch(/did not write JSON/);
  });

  it("refuses empty output", () => {
    expect(parseAuditReport("").error).toMatch(/nothing to stdout/);
    expect(parseAuditReport(undefined).error).toMatch(/nothing to stdout/);
  });

  it("refuses npm's JSON *error* object, which has no vulnerabilities key", () => {
    // The quiet failure this guard exists for: unreachable registry, valid JSON, zero findings. A
    // caller that only counted would report a clean tree for a run that audited nothing.
    const { report, error } = parseAuditReport('{"error":{"code":"ENOTFOUND","summary":"request to registry failed"}}');

    expect(report).toBeNull();
    expect(error).toMatch(/ENOTFOUND/);
  });

  it("refuses JSON with no vulnerabilities section", () => {
    expect(parseAuditReport('{"auditReportVersion":2}').error).toMatch(/vulnerabilities/);
    expect(parseAuditReport("[]").error).toMatch(/not an audit report/);
  });

  it("refuses a `vulnerabilities` that is an array rather than a map", () => {
    // `collectFindings` returns nothing for an array, so letting one through here means "unreadable
    // report" arrives at the caller wearing the face of "clean tree" - a false green, exit 0.
    const { report, error } = parseAuditReport(
      `{"auditReportVersion":2,"vulnerabilities":[{"name":"fast-uri","severity":"critical"}],${METADATA}}`,
    );

    expect(report).toBeNull();
    expect(error).toMatch(/vulnerabilities/);
  });

  it("refuses a report format it was not written against, including one that names no format at all", () => {
    // A future npm that reorganises the report would otherwise be graded by a parser that no longer
    // understands it, and the way that failure presents is a green build. The version stamp is
    // *required* rather than checked-when-present for the same reason: a guard that waves through the
    // one format declaring nothing about itself is not guarding the case it was written for.
    expect(parseAuditReport(`{"auditReportVersion":3,"vulnerabilities":{},${METADATA}}`).error).toMatch(
      /auditReportVersion 3/,
    );
    expect(parseAuditReport(`{"vulnerabilities":{},${METADATA}}`).error).toMatch(/auditReportVersion/);
    expect(parseAuditReport(`{"auditReportVersion":2,"vulnerabilities":{},${METADATA}}`).error).toBeNull();
  });

  it("refuses a report missing the counts its own plausibility check reads", () => {
    // The tripwire against a format change reads `metadata.vulnerabilities.total`. If that field can
    // move, be renamed, or arrive as a string while the report is still graded, the tripwire disarms
    // itself in exactly the scenario it exists for - and the result is exit 0 on a vulnerable tree.
    const missing = '{"auditReportVersion":2,"vulnerabilities":{},"summary":{"total":9}}';
    const stringly =
      '{"auditReportVersion":2,"vulnerabilities":{},"metadata":{"vulnerabilities":{"total":"7"},"dependencies":{"prod":333}}}';
    const noDependencyCount =
      '{"auditReportVersion":2,"vulnerabilities":{},"metadata":{"vulnerabilities":{"total":0}}}';

    expect(parseAuditReport(missing).error).toMatch(/cross-checks/);
    expect(parseAuditReport(missing).report).toBeNull();
    expect(parseAuditReport(stringly).error).toMatch(/cross-checks/);
    expect(parseAuditReport(noDependencyCount).error).toMatch(/cross-checks/);
  });
});

describe("reportPlausibilityError", () => {
  it("refuses a report npm says is dirty but this script read as empty", () => {
    // The failure this exists for is a format change: npm moves advisory detail out of `via[]`, this
    // script finds nothing, and a tree with seven vulnerabilities reports clean. npm publishes its own
    // count in the same document, so the disagreement is free to detect.
    const error = reportPlausibilityError({
      report: { vulnerabilities: {}, metadata: { vulnerabilities: { total: 7 } } },
      findings: [],
    });

    expect(error).toMatch(/could not read a single advisory/);
  });

  it("is one-directional: finding more than npm's total is normal, not an error", () => {
    // This script counts advisories, npm counts packages. One package with three advisories is three
    // findings against a total of one, and that must not be treated as a broken report.
    const report = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 1 } } };

    expect(reportPlausibilityError({ report, findings: [{}, {}, {}] })).toBeNull();
  });

  it("stays silent on a genuinely clean report, and on one without metadata", () => {
    expect(
      reportPlausibilityError({ report: { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }, findings: [] }),
    ).toBeNull();
    expect(reportPlausibilityError({ report: { vulnerabilities: {} }, findings: [] })).toBeNull();
    expect(reportPlausibilityError()).toBeNull();
  });

  it("refuses a report listing vulnerable packages even when npm's own count says nothing", () => {
    // The check above reads `metadata`; this one does not, and that is the whole point. A format change
    // that renames or moves the counts disarms the count check and leaves this one standing. npm does
    // not list a package under `vulnerabilities` unless something is wrong with it, so a non-empty map
    // yielding zero readable advisories is a contradiction whichever way the metadata is spelled.
    const report = {
      vulnerabilities: { "fast-uri": { name: "fast-uri", severity: "high", via: ["ajv"] } },
      summary: { total: 9 },
    };

    expect(reportPlausibilityError({ report, findings: [] })).toMatch(/could not read a single advisory/);
  });

  it("refuses a package whose `via` is a shape it cannot read advisories out of", () => {
    // Per-package, because the two checks above only fire when *nothing* in the whole report parsed. An
    // npm major that moves advisory detail for some packages and not others would otherwise be graded
    // on the half that still reads - a green build for a tree that was only partly audited.
    const emptyVia = { vulnerabilities: { "fast-uri": { name: "fast-uri", via: [] } } };
    const noVia = { vulnerabilities: { "fast-uri": { name: "fast-uri", severity: "high" } } };
    const wrongVia = { vulnerabilities: { "fast-uri": { name: "fast-uri", via: [123] } } };
    const partial = {
      vulnerabilities: {
        nanoid: { name: "nanoid", via: [nanoidVia] },
        "fast-uri": { name: "fast-uri", advisories: [{ ghsa: "GHSA-7p8r-x3mc-p8w7" }] },
      },
    };

    expect(reportPlausibilityError({ report: emptyVia, findings: [] })).toMatch(/cannot read/);
    expect(reportPlausibilityError({ report: noVia, findings: [] })).toMatch(/cannot read/);
    expect(reportPlausibilityError({ report: wrongVia, findings: [] })).toMatch(/cannot read/);
    // The partial case: one package still parses, so `findings` is non-empty and every other check is
    // satisfied. Only the shape check notices that the other package was never read.
    expect(reportPlausibilityError({ report: partial, findings: collectFindings(partial) })).toMatch(/fast-uri/);
  });

  it("accepts the cross-reference shape npm really emits", () => {
    // A package affected only through a dependency carries that dependency's *name* in `via`. That is
    // a package with no advisory of its own, not an unreadable one, and must not be an error.
    const report = {
      vulnerabilities: {
        nanoid: { name: "nanoid", via: [nanoidVia] },
        postcss: { name: "postcss", via: ["nanoid"] },
      },
      metadata: { vulnerabilities: { total: 2 }, dependencies: { prod: 333 } },
    };

    expect(reportPlausibilityError({ report, findings: collectFindings(report) })).toBeNull();
  });

  it("refuses an audit that covered no production dependencies at all", () => {
    // "Nothing to find" and "nothing was looked at" produce the identical clean report and must never
    // be graded the same - a lockfile regenerated wrong would otherwise end on a green all-clear.
    const report = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 }, dependencies: { prod: 0 } } };

    expect(reportPlausibilityError({ report, findings: [] })).toMatch(/nothing to audit/);
  });
});

describe("annotations", () => {
  const findings = collectFindings(auditReportWith([fastUriVia]));

  it("raises a workflow warning for every suppression, so a green run still says what it shipped", () => {
    // A suppressed critical whose only trace is a line inside a collapsed green step is exactly the
    // "visible decision" the allowlist promises and would not deliver.
    const entries = entriesFrom([entry()]);

    const lines = annotations(evaluate({ findings, entries, now: at("2026-08-08") }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::warning::/);
    expect(lines[0]).toContain("fast-uri");
    expect(lines[0]).toContain("2026-10-01");
  });

  it("warns about expired and stale entries too, and says nothing when there is nothing to say", () => {
    const expired = annotations(
      evaluate({ findings, entries: entriesFrom([entry({ expires: "2026-08-07" })]), now: at("2026-08-08") }),
    );
    const stale = annotations(
      evaluate({ findings: [], entries: entriesFrom([entry()]), now: at("2026-08-08") }),
    );

    // The expired case also *blocks*, so its error annotation leads and the expiry warning follows it.
    expect(expired[0]).toMatch(/^::error::/);
    expect(expired[1]).toMatch(/^::warning::.*expired/);
    expect(stale[0]).toMatch(/^::warning::.*deleted/);
    expect(annotations(evaluate({ findings: [], entries: [], now: at("2026-08-08") }))).toEqual([]);
    expect(annotations()).toEqual([]);
  });

  it("raises an error annotation for every finding that actually fails the run", () => {
    // Without this the run summary highlighted three categories that change no verdict and said nothing
    // about the one that does, leaving the reason a run is red reachable only by opening the step log.
    const [line, ...rest] = annotations(evaluate({ findings, entries: [], now: at("2026-08-08") }));

    expect(rest).toEqual([]);
    expect(line).toMatch(/^::error::/);
    expect(line).toContain("fast-uri");
    expect(line).toContain("GHSA-7p8r-x3mc-p8w7");
    expect(line).toContain(fastUriVia.url);
  });

  it("escapes a blocking finding's title, which is free text from the registry", () => {
    const hostile = collectFindings(auditReportWith([{ ...fastUriVia, title: "bad\n::error::injected" }]));

    const [line] = annotations(evaluate({ findings: hostile, entries: [], now: at("2026-08-08") }));

    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("bad%0A::error::injected");
  });

  it("escapes a justification so it cannot truncate its own annotation or emit another", () => {
    // GitHub reads workflow commands a line at a time. A newline in a justification - free text in a
    // checked-in file - would cut the annotation off before the reason, which is the only thing it
    // exists to show, and hand the remainder to the runner as further commands.
    const entries = entriesFrom([
      entry({ justification: "fine\n::error::injected\n100% reviewed" }),
    ]);

    const [line] = annotations(evaluate({ findings, entries, now: at("2026-08-08") }));

    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("fine%0A::error::injected%0A100%25 reviewed");
  });
});

/**
 * Everything above tests the pure functions. This block tests the wiring: the point where those
 * answers become an exit code, which is the only thing CI ever reads. Nothing above would notice if
 * `process.exitCode = 1` became a bare `return` - the suite would stay green while the gate stopped
 * being one, which is precisely the silent-success failure this script exists to prevent.
 *
 * The script is copied into a temporary directory (it imports nothing but `node:` builtins, so it
 * runs anywhere) beside a fixture allowlist, and `npm` is a stub on PATH. No network, no registry,
 * no real audit - just the branch under test and the code it exits with.
 */
describe("main() — the exit codes CI actually reads", () => {
  const scriptSource = path.resolve(__dirname, "..", "scripts", "audit-check.mjs");

  const cleanReport = JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      dependencies: { prod: 333, dev: 498, optional: 123, peer: 7, peerOptional: 0, total: 873 },
    },
  });
  const dirtyReport = JSON.stringify(auditReportWith([fastUriVia]));

  /** Far enough out to be live, close enough to clear the 180-day ceiling on whatever day this runs. */
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const runGate = ({
    allowlist,
    stdout = cleanReport,
    exitCode = 0,
    githubActions = false,
  }: {
    allowlist: string | null;
    stdout?: string;
    exitCode?: number;
    githubActions?: boolean;
  }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-gate-"));
    try {
      fs.mkdirSync(path.join(directory, "scripts"));
      fs.copyFileSync(scriptSource, path.join(directory, "scripts", "audit-check.mjs"));
      if (allowlist !== null) {
        fs.writeFileSync(path.join(directory, "audit-allowlist.json"), allowlist);
      }

      const binDirectory = path.join(directory, "bin");
      fs.mkdirSync(binDirectory);
      fs.writeFileSync(path.join(binDirectory, "npm-stdout.txt"), stdout);
      // The stub records its own argv, because the command line is the one input that decides *what*
      // gets audited, and a stub that discards it lets `--omit=dev` be dropped or narrowed with the
      // whole suite still green.
      const argvPath = path.join(binDirectory, "npm-argv.txt");
      fs.writeFileSync(
        path.join(binDirectory, "npm"),
        `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvPath}"\ncat "${path.join(binDirectory, "npm-stdout.txt")}"\nexit ${exitCode}\n`,
        { mode: 0o755 },
      );

      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      };
      delete environment.GITHUB_ACTIONS;
      if (githubActions) {
        environment.GITHUB_ACTIONS = "true";
      }

      const result = spawnSync(process.execPath, [path.join(directory, "scripts", "audit-check.mjs")], {
        cwd: directory,
        encoding: "utf8",
        env: environment,
      });

      const argv = fs.existsSync(argvPath) ? fs.readFileSync(argvPath, "utf8").trim().split("\n") : null;
      return { status: result.status, output: `${result.stdout}${result.stderr}`, argv };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  // The stub is a POSIX shell script; the Windows path is covered by the npm.cmd branch, not here.
  const onPosix = it.skipIf(process.platform === "win32");

  onPosix("exits 0 on a clean tree with an empty allowlist — the everyday green", () => {
    const { status, output } = runGate({ allowlist: allowlistJson([]) });

    expect(status).toBe(0);
    expect(output).toMatch(/[Nn]o vulnerabilities/);
  });

  onPosix("exits 1 on a finding nobody listed", () => {
    const { status, output } = runGate({ allowlist: allowlistJson([]), stdout: dirtyReport, exitCode: 1 });

    expect(status).toBe(1);
    expect(output).toContain("GHSA-7p8r-x3mc-p8w7");
  });

  onPosix("exits 0 with the finding suppressed, and says so", () => {
    const { status, output } = runGate({
      allowlist: allowlistJson([entry({ expires: soon })]),
      stdout: dirtyReport,
      exitCode: 1,
    });

    expect(status).toBe(0);
    expect(output).toContain("suppressed");
  });

  onPosix("exits 1 on a broken allowlist even when the tree is clean, and names the real reason", () => {
    // The fail-closed contract, end to end: an allowlist nobody can read suppresses nothing *and*
    // fails the run, rather than quietly reverting to "no suppressions, all good".
    const { status, output } = runGate({ allowlist: "{ not json" });

    expect(status).toBe(1);
    expect(output).toMatch(/could not be used/);
  });

  onPosix("treats an absent allowlist as the strictest state, not a broken one", () => {
    const { status, output } = runGate({ allowlist: null });

    expect(status).toBe(0);
    expect(output).toMatch(/nothing is suppressed/);
  });

  onPosix("exits 1 when npm writes something that is not an audit report", () => {
    const { status, output } = runGate({ allowlist: allowlistJson([]), stdout: "npm ERR! ENOTFOUND\n", exitCode: 1 });

    expect(status).toBe(1);
    expect(output).toMatch(/did not write JSON/);
  });

  onPosix("exits 1 on an npm exit code it has no model of, rather than grading the output", () => {
    // npm uses 0 and 1; anything else is npm saying something this script was not written to read,
    // and the bare command it replaced failed on every non-zero exit.
    const { status, output } = runGate({ allowlist: allowlistJson([]), exitCode: 2 });

    expect(status).toBe(1);
    expect(output).toMatch(/exited 2/);
  });

  onPosix("emits workflow annotations only under GITHUB_ACTIONS", () => {
    const options = { allowlist: allowlistJson([entry({ expires: soon })]), stdout: dirtyReport, exitCode: 1 };

    expect(runGate({ ...options, githubActions: true }).output).toMatch(/^::warning::/m);
    expect(runGate(options).output).not.toContain("::warning::");
  });

  onPosix("asks npm for the production tree, in JSON — the flags that decide what is audited", () => {
    // Nothing else in this suite observes the command line. Dropping `--json` fails closed and would be
    // caught, but *narrowing* the scope is silent: adding `--omit=optional` here would audit strictly
    // less of what ships with every assertion in this file still passing.
    const { argv } = runGate({ allowlist: allowlistJson([]) });

    expect(argv).toEqual(["audit", "--omit=dev", "--json"]);
  });

  onPosix("exits 1 rather than reporting clean when npm's report is a shape it cannot read", () => {
    // Each of these was reproduced as an exit-0 all-clear before the checks that now catch them: npm
    // naming a vulnerable package this script reads no advisory out of, with its own counts moved out
    // of reach; and an audit that covered no production dependencies at all.
    const detailMoved = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        "fast-uri": { name: "fast-uri", severity: "high", via: ["ajv"], advisories: [{ ghsa: "GHSA-x" }] },
      },
      summary: { total: 9 },
    });
    const emptyTree = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { vulnerabilities: { total: 0 }, dependencies: { prod: 0, total: 0 } },
    });
    const unstamped = JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } });

    expect(runGate({ allowlist: allowlistJson([]), stdout: detailMoved, exitCode: 1 }).status).toBe(1);
    expect(runGate({ allowlist: allowlistJson([]), stdout: emptyTree }).output).toMatch(/nothing to audit/);
    expect(runGate({ allowlist: allowlistJson([]), stdout: emptyTree }).status).toBe(1);
    expect(runGate({ allowlist: allowlistJson([]), stdout: unstamped }).status).toBe(1);
  });

  onPosix("puts a blocking finding on the run summary, not only in the step log", () => {
    const { status, output } = runGate({
      allowlist: allowlistJson([]),
      stdout: dirtyReport,
      exitCode: 1,
      githubActions: true,
    });

    expect(status).toBe(1);
    expect(output).toMatch(/^::error::.*GHSA-7p8r-x3mc-p8w7/m);
  });
});
