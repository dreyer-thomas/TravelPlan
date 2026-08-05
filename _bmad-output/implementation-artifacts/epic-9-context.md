# Epic 9 Context: Travel Documents

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Travellers currently reduce tickets and booking confirmations to screenshots of a first screen, losing the multi-page, legible, forwardable original. Epic 9 lets users attach the actual file — PDF or image — to the accommodation or day plan item it belongs to, see and open it from the day timeline, and take a day's documents offline as a single merged PDF. It matters because the document is only useful at the moment of travel, which is exactly when signal is least reliable and a screenshot of page one is least sufficient.

## Stories

- Story 9.1: Documents on Stays and Activities
- Story 9.2: Documents in Print and an Offline Packet

## Requirements & Constraints

- Documents (PDF **or** image files) attach to both accommodation entries and day plan items. The distinction between "photo" and "document" is semantic, not technical — a ticket screenshot is a document — so the user chooses the bucket and the app never infers it from MIME type.
- Attached documents are visible on the entry in the day timeline, openable, and deletable from the entry's dialog.
- A day's attached documents can be produced as one offline PDF packet.
- Limits: up to 10 documents per entry, each up to 10 MB (deliberately above the 5 MB photo limit, since a ticket PDF with an embedded map exceeds it).
- Authenticated access is required for all trip data, uploaded document files included. Nothing in this epic may write to or serve from a statically served directory; documents carry names, addresses and booking codes.
- The backup/restore archive must round-trip documents with their entries, names and order. A backup mechanism that silently drops a class of files is a worse failure than one that refuses to run.
- Every user-facing string lives in both dictionaries under a `trips.documents.*` namespace, held in agreement by the existing dictionary-parity test.
- Any new dependency must keep the 0-vulnerability audit gate green.

**Success criteria for the epic:** a trip with documents survives an export/import round trip with documents attached; a day's packet opens as one PDF containing every document of that day, verified against a real multi-page ticket rather than a synthetic fixture.

## Technical Decisions

- **Data model:** two new tables, one per parent type, shaped like their existing image counterparts — same cascade behaviour and the same `(parentId, sortOrder)` uniqueness that keeps ordering total. A migration accompanies them.
- **Upload routes** mirror the existing image upload routes. The client-side type gate mirrors the server's accepted list the same way the existing image-upload helper does, but the route remains the authoritative check.
- **Serving** goes through the authorised uploads route handler (delivered by the prerequisite story), which enforces read access, supports byte ranges, sets `Cache-Control: private` and `nosniff`, and derives content type from the stored extension only. Documents must not bypass it.
- **No PDF rasterising anywhere.** No preview thumbnails, no first-page rendering, no OCR, no booking-code extraction. The chip's text label is the identification mechanism.
- **Printing:** the day plan stays `window.print()` over HTML. Image documents can append as full pages; **PDF documents cannot be printed by any browser** from an `<iframe>` or `<embed>`, so they are listed in a named appendix that states plainly they are not included. A silent omission on an offline artefact is the failure mode that matters.
- **Offline packet:** merged server-side into a single PDF with `pdf-lib` — a runtime server dependency only. Headless-Chrome rendering of the whole day plan was rejected (a browser in the deployment for one feature); a names-only list was rejected (not an offline packet). Two offline files, each doing its job.
- **Packet contents:** the day's documents in timeline order, PDFs page-for-page, images embedded as pages, each labelled with its entry name and document name so the packet is navigable without the app. A day with no documents yields a clear refusal, not an empty PDF.
- **Out of scope, deliberately:** trip-level documents (insurance, passports, a flight with no single day), an in-app document viewer, and renaming a document after upload. The file name at upload time is the label forever.
- Layout thresholds are to be **measured in a browser**, not derived by arithmetic or picked as a breakpoint — this project has been burned by guessed layout numbers before.

## UX & Interaction Patterns

- Documents live in the existing `Medien & Links` tab of both dialogs — no new tab. The document field must be **visibly distinct in label** from the photo field, so a JPEG's destination is the user's choice; a file placed in one bucket never appears in the other.
- A document has no thumbnail, so the timeline card element is a labelled chip (`doc-chip`), not a square. Rounded-sm, neutral pill track, ~14px file-type glyph plus the document name minus its extension, single-line and ellipsised at ~160px, 44px minimum height (the system-wide interactive floor; below the 56px photo strip, so chips beside photos add no card height).
- **The label is the content.** Unlabelled squares would force the user to open each document to find the ticket with their own name on it — the per-person ticket case is why this component exists.
- Placement on the `tl-card` media row: chips trail beside the photo strip while the row can hold at least two of them; below that measured threshold the whole chip group wraps to its own row beneath the photos. Truncating to one chip was explicitly rejected.
- Overflow reuses the photo strip's existing `+N` affordance, but it opens a **list of names**, not a viewer.
- Activating a chip or list entry opens the document in a new tab — **including image documents**, which never enter the fullscreen photo viewer. That viewer belongs to the trip's photographs; a ticket is not one.
- Staged-but-unsaved documents follow the dialog's existing dirty/discard semantics exactly as staged photos do.

## Cross-Story Dependencies

- **Story 9.1 depends on Story 8.3** (uploaded media moved behind the login and served by an authorised route). This ordering is arithmetic, not preference: building documents on a publicly served path means moving the same files and writing the same route afterwards, with booking confirmations openly readable in the meantime.
- **Story 9.2 depends on Story 9.1.** It carries the epic's only new dependency and its only technical unknown, and is held separately so an unsatisfying merged output cannot block the part that removes the screenshot workaround. The packet route must enforce the same access check as the media-serving route.
- Story 9.1 also touches the existing v2 backup archive (trip JSON plus uploaded files) and the shared media tab of both the accommodation and day plan item dialogs.
