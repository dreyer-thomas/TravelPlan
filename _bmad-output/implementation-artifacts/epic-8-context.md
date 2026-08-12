# Epic 8 Context: Maintenance & Infrastructure

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 8 is the standing home for work that is neither a new feature nor part of the visual redesign: runtime and toolchain upgrades, and verified deferred-work bundles that have earned a story number. It lets the maintainer keep the runtime current and pay down accumulated technical debt without threading infrastructure work through feature or redesign epics — and it is where security and data-integrity gaps on already-shipped behaviour get closed. These stories add no *product* capability — nothing here is a feature someone asked for — though closing a gap sometimes requires a control that did not exist, such as a way to remove a leg the timeline can no longer draw. The value is that the platform underneath the product stays patched, that private trip content stops being publicly reachable, and that write paths stop destroying more than they were asked to change.

## Stories

- Story 8.1: Node 24 LTS Runtime Upgrade — CI, Local, and Server
- Story 8.2: `middleware.ts` Becomes `proxy.ts`
- Story 8.3: Uploaded Media Behind the Login
- Story 8.4: Media Deletion That Deletes Only Its Own File
- Story 8.5: Travel Segments That Match Their Day
- Story 8.6: The Sixth Route Story 8.4 Left Out

## Requirements & Constraints

- **Authenticated access to all trip data is a hard requirement, and uploaded media files are explicitly in scope** — hero images, day images, accommodation and activity photos, and documents. Serving any of them as static files reachable by URL alone violates it. The driver is rights as much as secrecy: trip photos are frequently not the owner's to publish.
- **Travel segments must continue to report mode, travel time and distance** for the legs a day actually shows. A day's travel-time total must only count legs the timeline draws; minutes attributable to nothing visible on screen are a defect, not a rounding artifact.
- **Backup export and restore must stay lossless and must not regress.** Any change to where files live or how media rows are cleaned up has to be validated by an actual export/import round trip, not by inspection.
- **The `npm audit` zero-vulnerability CI gate cannot see the runtime underneath it.** Runtime currency is therefore a story-level obligation, not something the pipeline will catch.
- **No formal accessibility standard applies**, but basic best practice does: contrast, visible focus states, keyboard access on any control introduced here.
- **Deferred-work entries are only actionable once verified against current code.** Bundled entries carry recorded sweep decisions that are the specification; a ledger entry's *suggested fix* is not authoritative and has been wrong about what the code actually does. The same holds for a *finished spec*: Story 8.6 exists because Story 8.4 excluded a route on a stated ground that reading the code disproves.
- **Prove it, don't reason about it.** Where a story's outcome is observable — a file genuinely removed, a page printed, images still rendering, a native module loaded against the new runtime — verification is an observation, not an argument from the code.

## Technical Decisions

- **Stack anchors:** Next.js App Router with TypeScript, Prisma over a single-file SQLite database, REST route handlers under `app/api/**/route.ts` as the only public API surface, Zod validation, JWT-in-HTTP-only-cookie sessions with role-based access (owner / viewer / contributor).
- **API envelope is fixed:** success `{ data, error: null }`, failure `{ data: null, error: { code, message, details } }`, with consistent error codes. Dates are ISO 8601 UTC. DB identifiers are `snake_case`; JSON is `camelCase`.
- **Data access goes through the repository layer**; the Prisma client is instantiated in exactly one place. New behaviour belongs behind the existing helpers rather than beside them.
- **A rename of a framework-recognised file must survive character for character.** The route-matcher pattern moving with `middleware.ts` → `proxy.ts` includes its trailing-slash handling, which is what keeps the import endpoint out of the matcher; a "tidied" equivalent pattern is a behaviour change.
- **Native modules are compiled against the runtime ABI.** The SQLite driver's prebuilt binaries must be downloaded rather than compiled, for both `darwin-arm64` and `linux-x64`, and correctness is confirmed by running real queries — not by an install that exits zero.
- **Deployment target is a self-hosted Debian server:** systemd-managed Node process behind an Nginx TLS terminator. Node 24 LTS is the architecturally sanctioned runtime. The same host runs a second application on an older Node, so runtime changes must be additive and scoped to this service, leaving the system default alone.
- **Deployment documentation is currently a placeholder.** Both deployment documents must be filled in with what is actually discovered — process manager, service names, install paths, which app runs on which runtime, and where the uploads root lives (it must be writable by the service user and must survive a redeploy; anything inside the build output is silently emptied on deploy).
- **`public/` is served statically ahead of any route handler and without consulting the session.** Anything that must be authorised cannot live there. Application assets (site images, SVGs) legitimately stay; trip-owned uploads do not. A file left behind stays readable no matter what the code does, so absence must be asserted, not assumed.
- **Uploaded media is served by an authenticated catch-all route handler.** Stored URLs carry the trip id as a fixed path segment and a single helper module owns the on-disk path resolution, which is what makes authorised serving possible without a URL change, a data migration, or a component change. Requirements for that route: path resolution proven safe against traversal inputs, byte-range (`206`) support so browser PDF viewers open files inline, `Cache-Control: private`, unchanged ETag/conditional behaviour, `Content-Type` derived from the stored extension only, and `X-Content-Type-Options: nosniff`.
- **One rule governs media cleanup: delete one file, never a tree.** Upload directories are nested by trip and day, so recursive removal of a parent directory destroys unrelated photos and documents while touching no database row — leaving every chip rendering a 404. Cleanup goes through the shared single-file helper; a second implementation of the same rule is a defect.
- **A filesystem failure after a committed row delete must not be reported as a failed deletion.** Log it and report what actually happened, consistently across all media routes.
- **Concurrent destructive imports of the same trip must be serialised** by an exclusive per-trip sentinel released in a `finally`, with an explicit staleness timeout.
- **Restored data must be sanitised for cross-trip references.** An upload URL belonging to a different trip is nulled and counted in the import summary rather than restored verbatim.
- **Segment repair distinguishes two cases.** When an endpoint ceased to exist, nothing can repair the segment and it is deleted in the same transaction as the endpoint — through one helper serving both endpoint types. When both endpoints still exist and only adjacency changed, the segment holds a user-measured mode, duration and distance that are not derivable, so it must be surfaced rather than silently discarded. A fabricated segment is worse than a visible gap; an invisible one is worse than both.

## UX & Interaction Patterns

- Epic 8 is not a UI epic, but any surface it adds — the orphaned-leg presentation and its removal control — belongs to the shipped design system's tokens and components rather than new bespoke styling.
- An orphaned travel leg must show what it records and offer a control that removes it. Creation of a non-adjacent pair still refuses, but removal must not, or the row is permanently unreachable.
- Verify visual outcomes on screen rather than by reasoning: the printed day plan renders images against the uploads URLs, so the print path must be exercised after any change to how media is served.

## Cross-Story Dependencies

- **Story 8.1** waits for the final story of the visual-redesign epic. Changing the runtime under in-flight UI work would put a variable beneath it.
- **Story 8.3** must land before the travel-documents epic begins. Documents built on the public path mean moving the same files and writing the same authorising route afterwards, with booking confirmations openly served in the meantime.
- **Story 8.6 depends on Story 8.4**, which builds the single-file cleanup helper this story applies to a sixth route that the earlier story's spec wrongly excluded.
- **Stories 8.2, 8.4 and 8.5** depend on nothing and on each other not at all.
- **Stories 8.3, 8.4, 8.5 and 8.6 all touch the media or export/import path**, and each must leave the backup round trip intact — which is why the round trip is exercised rather than reasoned about.
- Deployment documentation is a shared surface: Stories 8.1 and 8.3 both write into it, 8.1 first.
