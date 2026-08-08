#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * The dependency gate behind `npm run audit:check`, and therefore behind the Security Audit workflow.
 *
 *   npm run audit:check
 *
 * It runs the same `npm audit --omit=dev` this script replaced and keeps the same answer: any finding
 * at any severity, in the production tree, fails the build. What it adds is an escape hatch that a
 * bare command cannot have - a checked-in allowlist of advisory ids, each with a justification and an
 * expiry date - so that a future *unfixable* production CVE is a reviewed, dated, visible decision in
 * a diff rather than a choice between "delete the gate" and "`main` is red forever".
 *
 * ## Why this is `.mjs` with no imports but `node:` builtins
 *
 * Same house rule as `scripts/grant-admin.mjs`, for a different reason. The deployment server runs
 * Node 20 and installs with `--omit=dev`, so anything a script needs at runtime has to be either a
 * production dependency or a builtin. A gate that exists to be trustworthy in CI must not be able to
 * fail because of its own supply chain, so it takes the strictest option: no dependencies at all.
 * That also means this file can never itself appear in the audit report it is grading.
 *
 * ## What is deliberately *not* here
 *
 * No severity thresholds, no CVSS arithmetic, no opinion about which advisories "count". npm already
 * decides all of that and `--omit=dev` already scopes it to what ships. This file only answers one
 * question npm cannot: "is this specific advisory one we knowingly, temporarily accepted?" Everything
 * else is passed through untouched, so upgrading npm changes the verdict, not this script.
 *
 * One deliberate difference from the `npm audit --omit=dev --audit-level=low` this replaced: that
 * command ignored `info`-severity advisories, because `--audit-level=low` means "fail at low and
 * above". Here every finding blocks regardless of severity. That is stricter, not looser, and an
 * `info` finding that genuinely does not matter is now suppressible with a reason and a date - which
 * is a better record than a threshold nobody remembers is there.
 *
 * Every exported function is pure and takes what it needs as arguments, so the test suite can
 * exercise every row of the spec's edge-case matrix - expiry, malformed allowlists, unparseable npm
 * output - without spawning npm or reaching the network. Those are exactly the paths that are never
 * exercised until the day they matter. `main()` itself, which is where those answers become exit
 * codes, is covered separately by running this file against a stub `npm`.
 */

/** Node's own `Error` unwrapping, repeated often enough here to be worth a name. */
const describeError = (error) => (error instanceof Error ? error.message : String(error));

/** GitHub's own escaping rules for a value interpolated into a `::command::` line. */
const escaped = (value) => String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/**
 * GHSA ids are `GHSA-xxxx-xxxx-xxxx` over a 32-character base32-ish alphabet. Matching loosely on
 * `[a-z0-9]{4}` is deliberate: this is a shape check to catch a pasted URL or a CVE id in the
 * `advisory` field, not a checksum. Case-insensitive because GitHub renders them lowercase in URLs
 * and upper-cased in prose, and a human will paste whichever they were looking at.
 */
const GHSA_PATTERN = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

/**
 * The fallback identifier minted from npm's own advisory number for an advisory reported without a
 * GitHub advisory URL. It is allowed in the allowlist, not just in the report, because the alternative
 * is an escape hatch with a hole in exactly the shape of the emergency it exists for: an unfixable
 * production advisory that happens to arrive without a GHSA id would otherwise block `main` forever
 * with no way to accept it.
 *
 * `npm-advisory-unnamed-<n>` is deliberately **not** matched. That id is an ordinal - a position in
 * the report - so the advisory it names changes the moment any other advisory sorts ahead of it. An
 * allowlist entry holding one would silently transfer its justification onto a different, unreviewed
 * advisory: a suppression that migrates is worse than no suppression at all. Those findings stay
 * blocking and unsuppressable, which is the honest answer - an advisory that neither npm nor this
 * script can name is one nobody can knowingly accept.
 */
const NPM_ADVISORY_PATTERN = /^npm-advisory-\d+$/;

const isSuppressableId = (value) => GHSA_PATTERN.test(value) || NPM_ADVISORY_PATTERN.test(value);

/**
 * The only hosts a GHSA id is read from. `via[].url` is registry-supplied data - it arrives from the
 * same place the vulnerable package did - and the GHSA id it yields is the key the allowlist matches
 * on. Without a host check, `https://anywhere.example/advisories/GHSA-<an-id-someone-already-accepted>`
 * mints that accepted id for an unrelated advisory and inherits its suppression. Anything not from
 * GitHub's advisory database falls back to npm's own advisory number, which still blocks and is still
 * suppressible - the safe direction.
 */
const GITHUB_ADVISORY_HOSTS = new Set(["github.com", "www.github.com"]);

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Every field an allowlist entry may carry. Anything else is a mistake - see `parseAllowlist`. */
const ALLOWED_ENTRY_KEYS = new Set(["advisory", "package", "justification", "expires"]);

/**
 * The furthest into the future an `expires` may be set. Without a ceiling, `9999-12-31` is a perfectly
 * valid calendar day and the expiry field becomes decorative - a "temporary, dated exception" that
 * outlives everyone who could remember it. Six months is long enough to wait out an upstream release
 * and short enough that every suppression is re-argued at least twice a year.
 */
const MAX_SUPPRESSION_DAYS = 180;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** The only `auditReportVersion` this script has been read against. See `parseAuditReport`. */
const KNOWN_AUDIT_REPORT_VERSION = 2;

/**
 * A registry that accepts the connection and then never answers would otherwise leave this gate
 * hanging with no verdict at all, until GitHub kills the job hours later. Generous enough that a slow
 * cold fetch is never mistaken for a hang; short enough that the answer is "could not check", loudly,
 * inside the run somebody is waiting on.
 */
const AUDIT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * `new Date("2026-02-30")` is not an error in JavaScript - it silently becomes March 2nd. An expiry
 * that rolls forward is an expiry that is later than the reviewer who wrote it believed, which is the
 * one direction this file must never be wrong in. Round-tripping back to a string is what catches it.
 */
const isRealCalendarDay = (value) => {
  if (!ISO_DAY_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Expiry is a *calendar* decision ("this is acceptable until the end of March"), not an instant, so
 * both sides of the comparison are reduced to a day and compared as `YYYY-MM-DD` strings - a format
 * whose lexicographic order is its chronological order. UTC is the day used, because CI runs in UTC
 * and a gate that flips on a developer's timezone is a gate nobody trusts. The cost is that an entry
 * can outlive its date by up to a few hours for someone west of UTC; the alternative is a suppression
 * that expires at different moments on different machines.
 */
const utcDay = (date) => date.toISOString().slice(0, 10);

/**
 * @param {string} rawText contents of `audit-allowlist.json`
 * @returns `{ entries, errors }` - `errors` are human sentences naming the offending entry
 *
 * **Fail-closed is the entire contract here.** `entries` is empty whenever `errors` is non-empty, and
 * never partially populated: a file with one good entry and one typo suppresses *nothing*, because the
 * failure mode of a security allowlist is not "too few suppressions" (a red build somebody looks at)
 * but "one more suppression than anyone reviewed" (a green build nobody looks at). That is also why a
 * missing field is an error rather than a default - there is no safe default for "why is this ok".
 */
export const parseAllowlist = (rawText, { now = new Date() } = {}) => {
  const errors = [];
  const latestAllowed = utcDay(new Date(now.getTime() + MAX_SUPPRESSION_DAYS * DAY_IN_MS));
  const seenAdvisories = new Set();

  let document;
  try {
    // A leading BOM is not JSON, and an editor writing UTF-8-with-BOM is a plausible way for this file
    // to acquire one. Left in place it disarms the whole allowlist - fail-closed, so not dangerous, but
    // permanently red with a message that blames JSON syntax for what is really a file encoding.
    document = JSON.parse(rawText.replace(/^\uFEFF/, ""));
  } catch (error) {
    return { entries: [], errors: [`audit-allowlist.json is not valid JSON: ${describeError(error)}`] };
  }

  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { entries: [], errors: ["audit-allowlist.json must be a JSON object with an `advisories` array"] };
  }

  // Keys beginning with `$` are documentation for whoever opens this file while blocked, and are
  // ignored on purpose - the shape has to be discoverable at the moment it is needed.
  const { advisories } = document;
  if (!Array.isArray(advisories)) {
    return { entries: [], errors: ["audit-allowlist.json is missing an `advisories` array"] };
  }

  const entries = [];
  advisories.forEach((entry, index) => {
    // Entries are named by index *and* by advisory id where one is legible: the index is the only
    // thing that always exists, and the id is the only thing a human can search the file for.
    const label = `advisories[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label} is not an object`);
      return;
    }

    const { advisory, justification, expires } = entry;
    const named = typeof advisory === "string" && advisory !== "" ? `${label} (${advisory})` : label;
    const errorsBefore = errors.length;

    // An unrecognised key is silently ignored otherwise, and the two that get written by accident are
    // exactly the two that matter: `expiry` (a typo for `expires`) and `packages` (someone believing
    // they are scoping the suppression). Either way the reviewer reads a narrower, shorter-lived
    // exception in the diff than the one the script applies. In a file where every field is
    // load-bearing, a key the parser does not know means the entry does not say what its author thinks.
    const unknownKeys = Object.keys(entry).filter((key) => !ALLOWED_ENTRY_KEYS.has(key));
    if (unknownKeys.length > 0) {
      errors.push(
        `${named} has unrecognised field(s) ${unknownKeys.map((key) => `"${key}"`).join(", ")} - only ${[...ALLOWED_ENTRY_KEYS].join(", ")} are read, and a field the script ignores is one the reviewer will not`,
      );
    }

    if (typeof advisory !== "string" || advisory.trim() === "") {
      errors.push(`${label} is missing a non-empty "advisory" (e.g. "GHSA-7p8r-x3mc-p8w7")`);
    } else if (!isSuppressableId(advisory.trim())) {
      errors.push(
        `${named} has an "advisory" that is neither a GHSA id (GHSA-xxxx-xxxx-xxxx) nor this script's npm-advisory-<number> fallback. An id printed as npm-advisory-unnamed-<n> cannot be listed at all: it is a position in npm's report, not an identity, so the entry would drift onto a different advisory`,
      );
    } else if (seenAdvisories.has(advisory.trim().toLowerCase())) {
      // A second entry for an id that already has one is how an expired suppression gets quietly
      // renewed: the diff reads as an addition rather than as somebody changing a date they chose.
      errors.push(`${named} duplicates an earlier entry for the same advisory - edit that entry instead of adding another`);
    } else {
      seenAdvisories.add(advisory.trim().toLowerCase());
    }

    // `package` is optional - matching never uses it - but a *wrong-typed* one is the same mistake the
    // unknown-key rule catches, wearing a legal name. `"package": ["fast-uri", "ajv"]` reads in a diff
    // as a suppression scoped to two packages; silently dropped, it is a suppression scoped to none.
    if ("package" in entry && typeof entry.package !== "string") {
      errors.push(
        `${named} has a non-string "package" - it is documentation for the reader, so write the affected package name or leave the field out`,
      );
    }

    if (typeof justification !== "string" || justification.trim() === "") {
      errors.push(`${named} is missing a non-empty "justification" - say why this is acceptable to ship`);
    }

    if (typeof expires !== "string" || expires.trim() === "") {
      errors.push(`${named} is missing a non-empty "expires" date in YYYY-MM-DD form`);
    } else if (!isRealCalendarDay(expires.trim())) {
      errors.push(`${named} has an "expires" of "${expires}", which is not a real YYYY-MM-DD date`);
    } else if (expires.trim() > latestAllowed) {
      errors.push(
        `${named} has an "expires" of "${expires.trim()}", more than ${MAX_SUPPRESSION_DAYS} days out (the furthest allowed is ${latestAllowed}) - a suppression nobody has to re-argue is not an exception, it is a policy change`,
      );
    }
    // An `expires` in the *past* is deliberately not an error here. It is `evaluate`'s job, and
    // treating it as a parse failure would disarm the whole file - turning one lapsed exception into
    // every exception lapsing at once, and reporting it as "the allowlist is malformed" rather than
    // as the one thing it is: this suppression ran out.

    if (errors.length === errorsBefore) {
      // `package` is carried through untouched: it is documentation for the reader, never part of the
      // match, because the advisory id is what npm and GitHub agree on and a package name is what
      // moves when a transitive dependency is re-parented.
      entries.push({
        advisory: advisory.trim(),
        justification: justification.trim(),
        expires: expires.trim(),
        package: typeof entry.package === "string" ? entry.package : null,
      });
    }
  });

  // Fail closed: one bad entry disarms the whole file rather than leaving a half-applied allowlist
  // whose behaviour depends on the order things happened to be written in.
  return errors.length > 0 ? { entries: [], errors } : { entries, errors };
};

/**
 * @returns the GHSA id in a GitHub advisory URL, or `null` for anything else
 *
 * The id is looked for across the whole path rather than in the last segment alone: npm prints the
 * bare `https://github.com/advisories/GHSA-xxxx-xxxx-xxxx`, but a decorated variant
 * (`.../GHSA-xxxx-xxxx-xxxx/dependabot`) would otherwise fall through to the numeric fallback, and the
 * person reading the allowlist's own instructions would write a GHSA entry that never matches - a
 * suppression that reads as taken in the diff and does nothing in CI.
 *
 * Query strings and fragments cost nothing to handle here: `URL` puts them outside `pathname`, so a
 * link decorated with `?utm_source=…` yields the same id as the bare one.
 */
const ghsaIdFromAdvisoryUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!GITHUB_ADVISORY_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "advisories") {
    return null;
  }
  return segments.find((segment) => GHSA_PATTERN.test(segment)) ?? null;
};

/**
 * The GHSA id lives in the advisory URL (`https://github.com/advisories/GHSA-7p8r-x3mc-p8w7`), not in
 * npm's `source` field, which is an npm-internal advisory number. The GHSA id is what a human reads,
 * pastes into a justification, and can look up - so it is what the allowlist keys on.
 *
 * When there is no usable URL the finding still gets an identifier and still blocks, but one that
 * cannot match a GHSA-shaped allowlist entry. That is intentional: an advisory this script cannot
 * name is an advisory nobody can knowingly suppress.
 */
const advisoryIdFromVia = (via, fallbackOrdinal) => {
  const ghsaId = ghsaIdFromAdvisoryUrl(typeof via.url === "string" ? via.url : "");
  if (ghsaId) {
    return ghsaId;
  }
  // Anything else in that position is not an identifier this file can hand to a human: it is `1234`
  // from an npmjs.com advisory link, or a bare host name from a URL with no path. Returning it would
  // mint an id no valid allowlist entry may hold, i.e. a finding that blocks `main` with the escape
  // hatch structurally unable to reach it - the exact emergency the allowlist exists for.
  //
  // `source` is npm's own advisory number and is the stable choice when it exists. The ordinal is the
  // last resort, and it exists so that two unnameable advisories on one package stay two findings:
  // collapsing them into one id would let the dedupe below silently drop the second. It is a position,
  // not an identity, which is why `NPM_ADVISORY_PATTERN` refuses to let one be suppressed.
  //
  // `> 0` and not merely `Number.isInteger`: a zero or negative `source` would mint `npm-advisory-0`
  // or `npm-advisory--1`, and `NPM_ADVISORY_PATTERN` refuses the latter outright - the minter and the
  // validator would disagree about their own domain and produce an unsuppressable id, which is the one
  // shape this fallback exists to prevent. Out-of-domain numbers take the honest ordinal instead.
  const source = via.source;
  return Number.isInteger(source) && source > 0
    ? `npm-advisory-${source}`
    : `npm-advisory-unnamed-${fallbackOrdinal}`;
};

/**
 * @param {object} auditReport parsed `npm audit --omit=dev --json` output
 * @returns `{ package, severity, advisoryId, title, url, range }[]`
 *
 * npm's report is a graph flattened into a map: every affected package gets an entry, and its `via`
 * array holds either advisory *objects* (this package is the vulnerable one) or plain *strings*
 * (this package is only affected because it depends on the named one). Only the objects are real
 * advisories; the strings are the same advisory seen from one hop away, so counting them would report
 * a single CVE as many findings with no id to suppress them by.
 *
 * Deduplication is by advisory id *and* package, not by id alone: one advisory can legitimately hit
 * two distinct packages, and both deserve a line, but the same pair appearing twice is the report
 * describing two paths to one problem.
 */
export const collectFindings = (auditReport) => {
  const vulnerabilities = auditReport?.vulnerabilities;
  // `Array.isArray` matters: an array is an object, and walking one with `Object.entries` would turn
  // array indices into package names - inventing findings named "0" and "1" out of a malformed report.
  if (vulnerabilities === null || typeof vulnerabilities !== "object" || Array.isArray(vulnerabilities)) {
    return [];
  }

  const findings = [];
  const seen = new Set();
  let fallbackOrdinal = 0;

  for (const [key, vulnerability] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
    for (const entry of via) {
      // Strings are cross-references, not advisories. Arrays are neither, and `typeof [] === "object"`
      // would otherwise let one through as a finding with no name and no url.
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      fallbackOrdinal += 1;
      const advisoryId = advisoryIdFromVia(entry, fallbackOrdinal);
      const packageName = typeof entry.name === "string" && entry.name !== "" ? entry.name : key;
      const dedupeKey = `${advisoryId.toLowerCase()}::${packageName}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      findings.push({
        package: packageName,
        severity: entry.severity ?? vulnerability?.severity ?? "unknown",
        advisoryId,
        title: entry.title ?? "(no title in the audit report)",
        url: entry.url ?? "",
        range: entry.range ?? vulnerability?.range ?? "",
      });
    }
  }

  return findings;
};

/**
 * @param {{ findings: object[], entries: object[], now: Date }} input
 * @returns `{ blocking, suppressed, staleEntries, expiredSuppressions }`
 *
 * **Why expired entries block but stale ones only warn.** Expiry exists to force re-evaluation of a
 * suppression that is still doing work: the advisory is still there, so letting the entry keep
 * silencing it past its date would make the date decorative. An entry that matches nothing is doing
 * no work at all - the tree is clean of it - and failing CI on that would be a self-inflicted break,
 * on a date boundary, with no security meaning. So: matching and expired -> the suppression is
 * refused and the finding blocks; matching nothing -> a printed nudge to delete the line.
 */
export const evaluate = ({ findings = [], entries = [], now = new Date() } = {}) => {
  const today = utcDay(now);

  const blocking = [];
  const suppressed = [];
  const matchedEntries = new Set();
  const coveredByLiveEntry = new Set();

  for (const finding of findings) {
    const advisoryId = String(finding.advisoryId ?? "").toLowerCase();
    // Case-insensitive because GHSA ids are written both ways in the wild and a suppression that
    // silently fails to apply because of letter case is the worst of both worlds: red build, and a
    // reviewer who believes the exception was taken.
    const matching = entries.filter((entry) => entry.advisory.toLowerCase() === advisoryId);
    for (const entry of matching) {
      matchedEntries.add(entry);
    }

    // `>=` so an entry expiring today still works today - the day named is the last day it is valid,
    // which is how a human reads "expires 2026-03-31".
    const live = matching.find((entry) => entry.expires >= today);
    if (live) {
      suppressed.push({ finding, entry: live });
      coveredByLiveEntry.add(advisoryId);
    } else {
      blocking.push(finding);
    }
  }

  return {
    blocking,
    suppressed,
    staleEntries: entries.filter((entry) => !matchedEntries.has(entry)),
    // Only entries whose lapse actually costs something: an expired entry sitting beside a live one
    // for the same advisory suppresses nothing *and* blocks nothing, so reporting it under a heading
    // that says "the findings above block" would be a sentence the exit code contradicts.
    expiredSuppressions: entries.filter(
      (entry) =>
        matchedEntries.has(entry) && entry.expires < today && !coveredByLiveEntry.has(entry.advisory.toLowerCase()),
    ),
  };
};

/**
 * @returns `string[]` - lines, so the caller decides stdout vs stderr and the test can assert on
 * content without matching whitespace.
 *
 * Every blocking line carries the URL. Whoever reads this output is, by definition, blocked and
 * probably not the person who introduced the dependency; the advisory page is the first thing they
 * need and the last thing they should have to go looking for.
 */
export const formatReport = ({ blocking = [], suppressed = [], staleEntries = [], expiredSuppressions = [] } = {}) => {
  const lines = [];

  if (blocking.length > 0) {
    lines.push(`${blocking.length} production vulnerability finding(s) are not suppressed:`);
    for (const finding of blocking) {
      const range = finding.range ? `@${finding.range}` : "";
      lines.push(`  ${finding.package}${range}  [${finding.severity}]  ${finding.advisoryId}`);
      lines.push(`    ${finding.title}`);
      if (finding.url) {
        lines.push(`    ${finding.url}`);
      }
    }
  }

  if (expiredSuppressions.length > 0) {
    lines.push("Expired allowlist entries - these no longer suppress anything, so the findings above block:");
    for (const entry of expiredSuppressions) {
      lines.push(`  ${entry.advisory}  expired ${entry.expires}  - ${entry.justification}`);
    }
    lines.push("  Re-assess each one: fix it, or renew the entry with a fresh date and justification.");
  }

  if (suppressed.length > 0) {
    lines.push(`${suppressed.length} finding(s) suppressed by audit-allowlist.json:`);
    for (const { finding, entry } of suppressed) {
      lines.push(`  ${finding.package}  [${finding.severity}]  ${finding.advisoryId}  (expires ${entry.expires})`);
      lines.push(`    ${entry.justification}`);
    }
  }

  if (staleEntries.length > 0) {
    lines.push("Allowlist entries matching no current finding - safe to delete:");
    for (const entry of staleEntries) {
      lines.push(`  ${entry.advisory}  - ${entry.justification}`);
    }
  }

  if (lines.length === 0) {
    lines.push("No vulnerabilities in the production dependency tree, and nothing suppressed.");
  }

  return lines;
};

/**
 * @returns `{ report, error }` - exactly one of the two is non-null
 *
 * The failure this guards is the quiet one. `npm audit` writes a JSON *error* object when it cannot
 * reach the registry, and that object has no `vulnerabilities` key - so a caller that just parsed and
 * counted would find zero findings and report a clean tree for a run that audited nothing. Anything
 * that is not recognisably a report is therefore an error, never a pass.
 *
 * `collectFindings` tolerates a missing `vulnerabilities` key because as a pure function it is right
 * to; this is where main() refuses to accept one.
 */
export const parseAuditReport = (stdout) => {
  const text = typeof stdout === "string" ? stdout.trim() : "";
  if (text === "") {
    return { report: null, error: "`npm audit --json` wrote nothing to stdout" };
  }

  let report;
  try {
    report = JSON.parse(text);
  } catch (error) {
    return { report: null, error: `\`npm audit --json\` did not write JSON: ${describeError(error)}` };
  }

  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    return { report: null, error: "`npm audit --json` wrote JSON that is not an audit report object" };
  }
  if (report.error) {
    return { report: null, error: `npm reported an error instead of an audit: ${JSON.stringify(report.error)}` };
  }
  // The version npm stamps on the document is the one signal that says "the shape you are about to
  // read is the shape you were written against". A future npm that reorganises the report would
  // otherwise be graded by a parser that no longer understands it, and the way that failure presents
  // is a green build. Red-and-loud on an unknown version is the correct direction for a gate: it costs
  // one deliberate edit here, where reading a format nobody checked costs a shipped vulnerability.
  //
  // The field is *required*, not merely checked when present. A guard whose whole job is "refuse a
  // format this script was not written against" cannot be one that waves through the one format that
  // declares nothing about itself - npm 6's report, or whatever a future npm emits after dropping the
  // stamp, would be graded by a parser with no claim to understand it.
  if (report.auditReportVersion !== KNOWN_AUDIT_REPORT_VERSION) {
    return {
      report: null,
      error: `\`npm audit --json\` wrote auditReportVersion ${JSON.stringify(report.auditReportVersion)}, but this script only understands ${KNOWN_AUDIT_REPORT_VERSION} - refusing to grade a report format it was not written against. Re-read scripts/audit-check.mjs against npm's current output before raising this.`,
    };
  }
  // `Array.isArray` for the same reason `collectFindings` guards it: an array is an object, and the
  // two functions disagreeing about that guard resolves in the fail-open direction - `collectFindings`
  // returns nothing for an array, and "nothing" here would be reported as a clean tree.
  if (
    report.vulnerabilities === null ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities)
  ) {
    return { report: null, error: "`npm audit --json` output has no usable `vulnerabilities` section" };
  }

  // The two counts `reportPlausibilityError` cross-checks the reading against. They are required here
  // rather than read defensively there, because a tripwire that disarms itself the moment the field it
  // watches moves or changes type is not a tripwire: a report with `metadata` renamed, or `total`
  // emitted as `"7"`, would sail past a `Number.isInteger` test and be reported as a clean tree. Every
  // version-2 report npm emits carries both.
  const total = report.metadata?.vulnerabilities?.total;
  const prodDependencies = report.metadata?.dependencies?.prod;
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(prodDependencies) || prodDependencies < 0) {
    return {
      report: null,
      error:
        "`npm audit --json` output is missing the `metadata.vulnerabilities.total` / `metadata.dependencies.prod` counts this script cross-checks its reading against - refusing to grade a report it cannot check itself against.",
    };
  }

  return { report, error: null };
};

/**
 * @returns `string | null` - an error when the report and the findings read out of it disagree
 *
 * Everything here defends one failure: npm reorganises its report, this script reads no advisories out
 * of it, and a vulnerable tree comes back green. Four independent signals, because a single one is a
 * single thing a format change can move:
 *
 * 1. **npm's own count.** `metadata.vulnerabilities.total` is computed from the same document. npm
 *    says something is wrong and this script read nothing -> it did not understand the report.
 * 2. **The map itself.** npm does not list a package under `vulnerabilities` unless something is wrong
 *    with it, so a non-empty map yielding zero findings is the same contradiction stated without
 *    reference to `metadata` - which is what makes it worth stating twice. A change that renames or
 *    moves the counts disarms (1) and leaves (2) standing.
 * 3. **The shape of each entry.** npm builds `via` from a package's advisory set: every element is an
 *    advisory object, or the *name* of the dependency the vulnerability arrives through. Anything
 *    else - no `via`, an empty one, a number where an advisory should be - means the detail this
 *    script reads has moved for that package, which (1) and (2) miss whenever some other package still
 *    parses.
 * 4. **A production tree that is actually there.** `metadata.dependencies.prod === 0` means the audit
 *    covered nothing at all. "Nothing to find" and "nothing was looked at" print identically and must
 *    never be graded the same.
 *
 * What is *not* checked is the opposite direction: this script counts advisories where npm counts
 * packages, so finding more than npm's total is normal (one package, several advisories). Only the
 * direction that produces a false green is refused.
 */
export const reportPlausibilityError = ({ report, findings = [] } = {}) => {
  const prodDependencies = report?.metadata?.dependencies?.prod;
  if (prodDependencies === 0) {
    return "`npm audit --omit=dev` reports 0 production dependencies - there was nothing to audit, so this is not a clean tree, it is an unaudited one. Check that the install succeeded and the lockfile is intact.";
  }

  const vulnerabilities = report?.vulnerabilities;
  const packages =
    vulnerabilities !== null && typeof vulnerabilities === "object" && !Array.isArray(vulnerabilities)
      ? Object.entries(vulnerabilities)
      : [];

  // Per-package, so a partial move of advisory detail is caught even while other packages still read.
  const unreadable = packages
    .filter(([, vulnerability]) => {
      const via = vulnerability?.via;
      if (!Array.isArray(via) || via.length === 0) {
        return true;
      }
      return via.some(
        (element) =>
          !(typeof element === "string" && element !== "") &&
          !(element !== null && typeof element === "object" && !Array.isArray(element)),
      );
    })
    .map(([name]) => name);
  if (unreadable.length > 0) {
    return `npm's audit report describes ${unreadable.length} package(s) in a shape this script cannot read advisories out of (${unreadable.slice(0, 5).join(", ")}) - refusing to grade it. Check whether npm's report format changed.`;
  }

  if (findings.length > 0) {
    return null;
  }

  const total = report?.metadata?.vulnerabilities?.total;
  if (Number.isInteger(total) && total > 0) {
    return `npm's audit report says ${total} vulnerability(ies) but this script could not read a single advisory out of it - refusing to report a clean tree. Check whether npm's report format changed.`;
  }
  if (packages.length > 0) {
    return `npm's audit report lists ${packages.length} vulnerable package(s) but this script could not read a single advisory out of it - refusing to report a clean tree. Check whether npm's report format changed.`;
  }

  return null;
};

/**
 * GitHub collapses a green step's log. A suppressed critical whose only trace is a line inside a
 * collapsed step is precisely the "reviewed, visible decision" the allowlist promises and does not
 * deliver, months later when nobody is reading the PR any more. Workflow commands put it on the run
 * summary and the PR instead. Outside Actions this returns nothing, so local output stays clean.
 *
 * Every interpolated value is escaped. GitHub reads workflow commands one line at a time, so a
 * newline anywhere in a justification (free text from a checked-in file) or a title (free text from
 * the registry) truncates the annotation at that point - dropping the justification, which is the only
 * reason the annotation exists - and hands the remainder to the runner as further commands.
 */
export const annotations = ({ blocking = [], suppressed = [], expiredSuppressions = [], staleEntries = [] } = {}) => {
  const lines = [];
  // The findings that actually fail the run get the strongest annotation there is, and they get it
  // first. Without this the summary page carried three categories that change no verdict and stayed
  // silent on the only one that does - so the run reads as "some warnings" and the reason it is red is
  // reachable only by opening the step log.
  for (const finding of blocking) {
    const url = finding.url ? ` ${escaped(finding.url)}` : "";
    lines.push(
      `::error::Unsuppressed ${escaped(finding.severity)} vulnerability in ${escaped(finding.package)} (${escaped(finding.advisoryId)}): ${escaped(finding.title)}.${url}`,
    );
  }
  for (const { finding, entry } of suppressed) {
    lines.push(
      `::warning::Shipping a known ${escaped(finding.severity)} vulnerability in ${escaped(finding.package)} (${escaped(finding.advisoryId)}), suppressed until ${escaped(entry.expires)}: ${escaped(entry.justification)}`,
    );
  }
  for (const entry of expiredSuppressions) {
    lines.push(
      `::warning::Allowlist entry ${escaped(entry.advisory)} expired on ${escaped(entry.expires)} and no longer suppresses anything.`,
    );
  }
  for (const entry of staleEntries) {
    lines.push(`::warning::Allowlist entry ${escaped(entry.advisory)} matches no current finding and can be deleted.`);
  }
  return lines;
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const main = () => {
  // Everything is resolved against this file, never against `cwd`. npm scripts happen to run from the
  // package directory, but CI steps, git hooks and a developer typing the path by hand do not, and a
  // gate that reads a *different* allowlist depending on where it was invoked from is a gate that can
  // be bypassed by accident.
  const projectDirectory = path.resolve(scriptDirectory, "..");
  const allowlistPath = path.join(projectDirectory, "audit-allowlist.json");

  let failed = false;
  let entries = [];

  let rawAllowlist = null;
  try {
    rawAllowlist = fs.readFileSync(allowlistPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      // No file is the strictest possible state, not a broken one - nothing is suppressed. Said out
      // loud so that "why did my exception stop working" has an answer in the log.
      console.log(`No audit-allowlist.json at ${allowlistPath} - nothing is suppressed.`);
    } else {
      console.error(`Could not read ${allowlistPath}: ${describeError(error)}`);
      failed = true;
    }
  }

  if (rawAllowlist !== null) {
    const allowlist = parseAllowlist(rawAllowlist);
    entries = allowlist.entries;
    if (allowlist.errors.length > 0) {
      console.error(`${allowlistPath} is unusable, so nothing is suppressed:`);
      for (const error of allowlist.errors) {
        console.error(`  ${error}`);
      }
      failed = true;
    }
  }

  // On Windows npm is `npm.cmd`, and `spawnSync` without a shell will not find a bare `npm`. It fails
  // closed either way, but a gate that is permanently and inexplicably red on one platform is a gate
  // that gets worked around.
  const npmBinary = process.platform === "win32" ? "npm.cmd" : "npm";
  const audit = spawnSync(npmBinary, ["audit", "--omit=dev", "--json"], {
    cwd: projectDirectory,
    encoding: "utf8",
    // The default 1 MiB is a size npm's JSON report can plausibly reach on a bad day, and the failure
    // mode of overflowing it is truncated JSON - i.e. this script blocking on a parse error at exactly
    // the moment there are the most vulnerabilities to read.
    maxBuffer: 32 * 1024 * 1024,
    // A hung registry surfaces as `audit.error`, which is already the fail-closed path below.
    timeout: AUDIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });

  if (audit.error || audit.status === null) {
    // A signal, a timeout, or a missing binary. Never a pass: "we could not check" and "there is
    // nothing to find" are the two things this script exists to keep apart.
    console.error(`Could not run \`npm audit --omit=dev --json\`: ${describeError(audit.error ?? "npm did not exit normally")}`);
    if (audit.stderr?.trim()) {
      console.error(audit.stderr.trim());
    }
    process.exitCode = 1;
    return;
  }

  // npm exits 0 with nothing to report and 1 when it found something; both are normal here, and the
  // JSON is the signal rather than the code. Any *other* code is npm saying something this script has
  // no model of. The bare `npm audit` this replaced failed on every non-zero exit, so accepting an
  // unrecognised one as a clean audit would open a hole the gate never previously had.
  if (audit.status !== 0 && audit.status !== 1) {
    console.error(
      `\`npm audit --omit=dev --json\` exited ${audit.status}, which is neither 0 (nothing found) nor 1 (findings) - refusing to grade its output.`,
    );
    if (audit.stderr?.trim()) {
      console.error(audit.stderr.trim());
    }
    process.exitCode = 1;
    return;
  }

  // npm exits 1 whenever it finds anything, which is the normal path here - the JSON is the signal,
  // the exit code is not.
  const { report, error } = parseAuditReport(audit.stdout);
  if (error) {
    console.error(error);
    if (audit.stderr?.trim()) {
      console.error(audit.stderr.trim());
    }
    process.exitCode = 1;
    return;
  }

  const findings = collectFindings(report);
  const plausibility = reportPlausibilityError({ report, findings });
  if (plausibility) {
    console.error(plausibility);
    process.exitCode = 1;
    return;
  }

  const result = evaluate({ findings, entries, now: new Date() });
  const lines = formatReport(result);

  if (failed && result.blocking.length === 0) {
    // Without this, a run that is red *only* because the allowlist is unusable ends on the line "No
    // vulnerabilities in the production dependency tree" - the last thing in the log flatly
    // contradicting the exit code, with the actual reason scrolled off the top.
    lines.push("Failing because audit-allowlist.json could not be used, not because of a finding.");
  }

  if (process.env.GITHUB_ACTIONS) {
    for (const annotation of annotations(result)) {
      console.log(annotation);
    }
  }

  const output = lines.join("\n");
  if (failed || result.blocking.length > 0) {
    console.error(output);
    process.exitCode = 1;
    return;
  }

  console.log(output);
};

/**
 * Only when executed, never when imported by the test suite.
 *
 * Both sides are `realpath`ed, and that is the whole point rather than a flourish. Node resolves
 * `import.meta.url` through symlinks but leaves `process.argv[1]` exactly as it was typed, so any
 * symlinked component in the invocation path - a git worktree, a checkout under a symlinked home, or
 * `/tmp` on macOS, which *is* a symlink to `/private/tmp` - makes a plain comparison false. The
 * consequence is not a crash: `main()` simply never runs, and the gate exits **0 having printed
 * nothing and audited nothing**. A security gate whose worst failure mode is silent success is
 * exactly the thing this file exists to prevent, so the comparison is made on real paths.
 */
const isDirectExecution = () => {
  if (!process.argv[1]) {
    return false;
  }
  const realpathOrSelf = (value) => {
    try {
      return fs.realpathSync(value);
    } catch {
      // A path that cannot be resolved cannot match a file that just imported itself; fall back to
      // the lexical form rather than throwing before the gate has had a chance to run.
      return path.resolve(value);
    }
  };
  return realpathOrSelf(process.argv[1]) === realpathOrSelf(fileURLToPath(import.meta.url));
};

if (isDirectExecution()) {
  main();
}
