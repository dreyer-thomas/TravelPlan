/**
 * Types for `scripts/audit-check.mjs` - the gate behind `npm run audit:check` and the Security Audit
 * workflow.
 *
 * ## Why this file exists
 *
 * The gate itself is deliberately plain JavaScript with no imports but `node:` builtins, and it stays
 * that way: a check that exists to be trustworthy in CI must not be able to fail because of its own
 * supply chain, and the deployment server installs with `--omit=dev`, so it cannot acquire a build
 * step either. See the file header of `audit-check.mjs` for the full argument.
 *
 * That leaves `test/auditCheckScript.test.ts` - the suite that asserts every branch of the gate that
 * CI never exercises until the day it matters - importing from an unannotated `.mjs`. `tsconfig.json`
 * sets `allowJs` but not `checkJs`, so the script reports nothing about itself while its *inferred*
 * signatures leak into the test, and the inference is wrong in a way that is worse than absent:
 * `({ findings = [] } = {})` infers `findings?: never[]`, so a real array of findings is rejected,
 * and a parameter with no default (`report`) is dropped from the option bag's type entirely. That was
 * 28 of the 29 type errors in the test file, recorded as **DW-262**, which proposes exactly this fix.
 *
 * A declaration file beside the script is what lets the test be type-checked without the gate's
 * runtime code changing by a single byte. Nothing here is enforced against the implementation -
 * `checkJs` is off by design - so these types are a hand-maintained contract: if a signature in
 * `audit-check.mjs` changes, this file has to be edited with it, and the test suite is what notices.
 *
 * ## What the types say, and where they stay deliberately wide
 *
 * npm's audit report is untrusted input. Every function that reads it re-checks the shape at runtime
 * (`typeof x === "object"`, `Array.isArray`, `Number.isInteger`) precisely because a format change is
 * the failure mode that would otherwise present as a green build on a vulnerable tree. So the fields
 * those guards protect are typed `unknown` rather than narrowed: declaring `vulnerabilities` as a map
 * of packages would be a promise the guards exist to disbelieve, and would make the tests that feed
 * it an array, a number or a `null` unwritable - which is the same as deleting them.
 */

/**
 * The two counts `parseAuditReport` requires and `reportPlausibilityError` cross-checks its own
 * reading against. Every version-2 report npm emits carries both; a report missing either is refused
 * rather than graded, so a tripwire cannot disarm itself by the field it watches being renamed.
 */
export interface AuditMetadata {
  vulnerabilities?: {
    info?: number;
    low?: number;
    moderate?: number;
    high?: number;
    critical?: number;
    total?: number;
  };
  dependencies?: {
    prod?: number;
    dev?: number;
    optional?: number;
    peer?: number;
    peerOptional?: number;
    total?: number;
  };
}

/**
 * Parsed `npm audit --omit=dev --json` output.
 *
 * A well-formed version-2 report has `vulnerabilities` as a map of package name to
 * `{ name, severity, range, via }`, where each `via` element is either an advisory object
 * (`{ source, name, title, url, severity, range }` - this package is the vulnerable one) or the plain
 * *name* of the dependency the vulnerability arrives through. `vulnerabilities` is nevertheless typed
 * `unknown`: it is registry-supplied data, every reader guards it, and the suite proves those guards
 * by passing an array, a `via` of `[123]`, and a report with no `vulnerabilities` key at all.
 */
export interface AuditReport {
  /** Version stamp. Required to equal 2 by `parseAuditReport`, which refuses to grade any other. */
  auditReportVersion?: number;
  /** See the note above on why this is `unknown`. */
  vulnerabilities?: unknown;
  metadata?: AuditMetadata;
  /**
   * npm writes an error object here instead of a report when it cannot reach the registry.
   * `parseAuditReport` only tests it for truthiness and stringifies it into the message, so its
   * internal shape is npm's business rather than this script's.
   */
  error?: unknown;
  /**
   * Open, because a real report carries keys beyond the four this script reads (`summary`,
   * `actions`, `advisories`, whatever npm adds next) and the type exists to describe untrusted input.
   * Without this, a fixture written as an inline literal trips excess-property checking and the next
   * person reaches for a cast to get past it - which is the escape hatch a declaration file is
   * supposed to make unnecessary.
   */
  [key: string]: unknown;
}

/**
 * One advisory against one package, as `collectFindings` reads it out of a report. `package` and
 * `advisoryId` are built by the script - the latter either a GHSA id or its own
 * `npm-advisory-<number>` / `npm-advisory-unnamed-<n>` fallback - and `advisoryId` is the key the
 * allowlist matches on, so both are genuinely strings.
 *
 * The other four are `unknown` because the script substitutes its placeholder with `??`
 * (`audit-check.mjs:368-372`), which only fires on `null`/`undefined`: a registry-supplied
 * `severity: 7` or an object `title` is passed straight through. Declaring them `string` would assert
 * a sanitisation step the gate does not perform, and would make a test pinning that pass-through a
 * type error - forbidding documentation of the one behaviour a hand-maintained declaration exists to
 * keep visible. Every field is *present*; only two are known to be strings.
 */
export interface Finding {
  package: string;
  advisoryId: string;
  severity: unknown;
  title: unknown;
  url: unknown;
  range: unknown;
}

/**
 * A validated `audit-allowlist.json` entry. Only entries that passed every check in `parseAllowlist`
 * ever take this shape, so the three load-bearing fields are non-optional: an entry with a missing
 * justification or expiry is an error, never a default. `package` is documentation for the reader and
 * is never part of the match, which is why it is nullable where the others are not.
 */
export interface AllowlistEntry {
  advisory: string;
  justification: string;
  expires: string;
  package: string | null;
}

/** `parseAllowlist`'s fail-closed result: `entries` is empty whenever `errors` is non-empty. */
export interface ParsedAllowlist {
  entries: AllowlistEntry[];
  errors: string[];
}

/** A finding paired with the live allowlist entry that is currently silencing it. */
export interface SuppressedFinding {
  finding: Finding;
  entry: AllowlistEntry;
}

/**
 * `evaluate`'s verdict. Only `blocking` changes the exit code; `expiredSuppressions` names entries
 * whose lapse actually costs something, and `staleEntries` names ones that match nothing and can be
 * deleted.
 */
export interface Evaluation {
  blocking: Finding[];
  suppressed: SuppressedFinding[];
  staleEntries: AllowlistEntry[];
  expiredSuppressions: AllowlistEntry[];
}

/**
 * The option bag `formatReport` and `annotations` take. Every member is optional because both
 * functions default it to an empty list, so either can be called with a partial verdict or with
 * nothing at all - and an `Evaluation` is assignable to it unchanged, which is how `main()` calls
 * both.
 */
export interface EvaluationSections {
  blocking?: readonly Finding[];
  suppressed?: readonly SuppressedFinding[];
  staleEntries?: readonly AllowlistEntry[];
  expiredSuppressions?: readonly AllowlistEntry[];
}

/** `parseAuditReport`'s result: exactly one of the two is non-null. */
export interface ParsedAuditReport {
  report: AuditReport | null;
  error: string | null;
}

/**
 * @param rawText contents of `audit-allowlist.json`
 * @param options `now` is injectable because the 180-day expiry ceiling makes this time-dependent.
 */
export declare const parseAllowlist: (rawText: string, options?: { now?: Date }) => ParsedAllowlist;

/**
 * `null` and `undefined` are accepted, not merely tolerated: the implementation reads
 * `auditReport?.vulnerabilities`, and `parseAuditReport` returns `report: AuditReport | null`, so a
 * caller chaining the two hands this a possible `null` by construction. As a pure function it answers
 * "no findings"; refusing an unreadable report is `parseAuditReport`'s and
 * `reportPlausibilityError`'s job, and doing it in two places is what keeps "nothing to find" and
 * "nothing was looked at" apart.
 */
export declare const collectFindings: (auditReport?: AuditReport | null) => Finding[];

/** Matches findings against allowlist entries and decides which of them still block. */
export declare const evaluate: (input?: {
  findings?: readonly Finding[];
  entries?: readonly AllowlistEntry[];
  now?: Date;
}) => Evaluation;

/** @returns lines, so the caller decides stdout vs stderr and the test asserts on content. */
export declare const formatReport: (result?: EvaluationSections) => string[];

/**
 * @param stdout raw `npm audit --json` output. Anything that is not a string - including the
 * `undefined` `spawnSync` yields when npm never ran - is treated as empty and refused.
 */
export declare const parseAuditReport: (stdout?: string | null) => ParsedAuditReport;

/**
 * @returns an error when the report and the findings read out of it disagree, otherwise `null`.
 *
 * `findings` is only ever counted here, never read into - the check is "npm says something is wrong
 * and this script read nothing out of it" - so it is typed as an opaque list. The test relies on
 * that to state a count without building fixtures the assertion does not look at.
 */
export declare const reportPlausibilityError: (input?: {
  report?: AuditReport | null;
  findings?: readonly unknown[];
}) => string | null;

/** GitHub Actions workflow commands, so a suppression is visible outside a collapsed step log. */
export declare const annotations: (result?: EvaluationSections) => string[];
