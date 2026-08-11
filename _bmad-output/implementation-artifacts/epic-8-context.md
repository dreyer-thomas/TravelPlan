# Epic 8 Context: Maintenance & Infrastructure

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 8 is the standing home for work that is neither a new feature nor a redesign: keeping the runtime and toolchain current, and paying down verified technical debt without threading that work through a feature or redesign epic. It matters because the alternatives are worse — an end-of-life runtime sits under the app while the package-level audit gate reports green, deprecation warnings become permanent noise, and defects that destroy or orphan user data stay parked in a ledger. Stories land here only after they are real: runtime and toolchain upgrades with a verified compatibility basis, and deferred-work bundles that earned a story number after a sweep verified each entry against the actual code. The epic adds no product capability; every story either closes a security or correctness gap in already-shipped behaviour or keeps the platform beneath it supported.

## Stories

- Story 8.1: Node 24 LTS Runtime Upgrade — CI, Local, and Server
- Story 8.2: `middleware.ts` Becomes `proxy.ts`
- Story 8.3: Uploaded Media Behind the Login
- Story 8.4: Media Deletion That Deletes Only Its Own File
- Story 8.5: Travel Segments That Match Their Day

## Requirements & Constraints

- **Authenticated access covers all trip data, uploads included.** The security requirement was never limited to database rows; anything a user uploads is trip data and must be reachable only by a signed-in user with access to that trip. The driver is rights as much as secrecy — trip photos are frequently not the owner's to publish.
- **Backup and restore fidelity is non-negotiable.** Export/import must keep working across every change in this epic, verified by an actual round trip rather than by inspection. Restore must not silently drop a class of record.
- **No behaviour change beyond the stated fix.** These stories re-skin nothing and add nothing. Stored URLs, rendered output, existing tests, and API contracts stay as they are unless a story's criteria say otherwise.
- **Prove it, don't reason about it.** Where a story's outcome is observable (a file genuinely removed, a page printed, images still rendering, a native module loaded), verification is an observation, not an argument from the code.
- **A green package audit is not a green runtime.** Dependency scanning cannot see the runtime beneath it; the runtime's support status is tracked separately and deliberately.
- **Deployment reality must be written down.** The deployment guide and configuration docs are placeholders; any story that touches the server fills in what it discovers — process manager, service names, install paths, which application runs on which runtime, and where mutable data lives.

## Technical Decisions

- **Target runtime is Node 24 LTS**, matching the declared infrastructure spine (Debian 13, Nginx for TLS, systemd process management, basic logging). Node 22 was rejected because it would need repeating within a year. The upgrade is one coordinated change across CI, the development machine, and the server.
- **The server is shared.** A second application runs on the older runtime there; both runtimes coexist, only this app's service is repointed, and the system-wide default is left alone.
- **Native modules matter.** The SQLite driver is compiled against the runtime ABI. Prebuilt binaries must be downloaded rather than compiled for both `darwin-arm64` and `linux-x64`, and correctness is confirmed by real queries, not by a successful install.
- **Uploaded media lives outside the statically served tree** and is served by an authorised catch-all route handler. Because every stored URL carries the trip id in a fixed position and the write path already has a single source of truth, this requires no URL change, no data migration, and no component change. Access uses the existing session and trip-read-access predicates, which admit owner, viewer and contributor alike.
- **The media route is a file server, not a shortcut.** Path resolution must be asserted against traversal inputs rather than trusted to path joining; byte-range requests must be answered with partial content, or some PDF viewers refuse to open; caching is private, content type derives from the stored extension only, and content-type sniffing is disabled. Absence of the old public directory is asserted, not merely non-use.
- **Deletion has a blast radius, and it must be one file.** Removing a cover image must never take out a shared parent directory containing other entries' photos and documents. Note the routes do not necessarily already know the previous URL — verify what a repository actually selects before assuming.
- **Post-commit filesystem failures are not user-facing failures.** Once a row delete has committed, an unlink failure is logged, and the response reports the deletion that actually happened, consistently across every media route.
- **Concurrent imports of one trip are serialised** by an exclusive per-trip sentinel released in a `finally`, with an explicit staleness timeout. Restored upload URLs belonging to a different trip are nulled and counted in the summary rather than rendered.
- **Travel segments turn on one distinction:** if an endpoint ceased to exist, the segment is unrepairable and is deleted in the same transaction as its endpoint, via one helper serving both endpoint types. If both endpoints still exist and only adjacency changed, the segment holds user-measured data (mode, duration, distance) that is not derivable and must be surfaced as an orphaned leg with a removal control — never silently discarded. Creation of a non-adjacent pair still refuses; removal must not. Totals count only what the timeline actually draws.

## Cross-Story Dependencies

- **Story 8.1 waits for Epic 7 to complete** (its final story). Changing the runtime under in-flight UI work would put a variable beneath it.
- **Story 8.2 is independent** of everything else here; the route matcher pattern must survive the rename character for character, including the trailing-slash handling that keeps the import endpoint out.
- **Stories 8.4 and 8.5 depend on nothing.** Each bundles four verified deferred-work entries; two of 8.4's entries carry recorded decisions that are the specification, not an open question.
- **Story 8.3 is a prerequisite for Epic 9** (travel documents). Building document handling on a publicly served path means moving the same files and writing the same route afterwards.
- 8.3, 8.4 and 8.5 all touch the export/import path; each must leave the round trip intact.
