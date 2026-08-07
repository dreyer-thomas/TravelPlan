"use client";

import { Box, Button, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useI18n } from "@/i18n/provider";
import { formatMessage } from "@/i18n";

export type LocationCandidate = { lat: number; lng: number; label: string };

type LocationCandidateListProps = {
  candidates: LocationCandidate[];
  onSelect: (candidate: LocationCandidate) => void;
  disabled?: boolean;
  /** Unique per surface — the trip-create form renders two of these, one per end of the trip. */
  idPrefix: string;
};

/**
 * The list of places a search came back with, and the one presentation all four surfaces share.
 *
 * Story 6.28 AC5. Until now `api/geocode` asked with `limit=1` and every caller adopted `body[0]`, so
 * "for some activities it only ever offers wrong places" was literally true — there was one candidate
 * and it was pinned without ever being offered. This is where the offer happens: with more than one
 * result **nothing** is resolved until a row here is activated, and the row's own label is what gets
 * stored, not the typed query.
 *
 * **`Button`s in an explicit `role="group"`, not a `listbox`.** There is no `ListItemButton`,
 * `Autocomplete` or selectable list anywhere in `src/components` to follow, and two constraints decided
 * the shape. First, `test/tripDayPlanDialog.test.tsx` mocks `@mui/material` with an exhaustive factory
 * that throws on an undeclared export, and `List`, `ListItem`, `ListItemButton`, `MenuItem` and `Stack`
 * are not in it — so this file may use `Box`, `Button` and `Typography` and nothing else. Second, plain
 * buttons are Tab-reachable and each carries its candidate's name as its accessible name, which meets
 * Epic 6's keyboard floor without inventing a `listbox` and the arrow-key handling that comes with it.
 *
 * There is deliberately **no selected state**: activating a row resolves the pin and dismisses the list
 * in the same gesture, so a row could only ever be selected for the instant before it disappeared. The
 * feedback is the read-only coordinate line the caller already renders below.
 *
 * The bordered-row skin is `TripShareDialog.tsx`'s collaborator list — `borderTop` on the group, a
 * `borderBottom` per row, none on the last — rather than a new treatment, and the 44px floor comes from
 * `theme.ts`'s `MuiButton` override, so it is not restated here. While empty this renders nothing the eye
 * can find — an empty bordered list is a stray hairline, which is the same judgement the share dialog
 * records — but it is not `null`, for the live-region reason recorded at the `return` below.
 */
export default function LocationCandidateList({
  candidates,
  onSelect,
  disabled = false,
  idPrefix,
}: LocationCandidateListProps) {
  const { t } = useI18n();
  const { tokens } = useTheme().palette;

  const headingId = `${idPrefix}-candidates-label`;
  const isEmpty = candidates.length === 0;

  /*
    One element tree in both states, empty included (6.28 follow-up review). The obvious spelling was an
    early `return null` while there are no candidates, and it silently cost the announcement below its
    only job: a live region inserted into the DOM *together with* its first text is routinely not read
    out, because there was no region there to observe a change in. Keeping the heading mounted and empty
    means the rows are the only thing that appears and disappears, and the count arriving is a content
    change in a region assistive tech is already watching. Nothing visible changes: an empty `span` has no
    box, the gap collapses with it, and the bordered group — the stray hairline the share dialog's
    judgement is about — is still rendered only when there is something in it.
  */
  return (
    <Box display="flex" flexDirection="column" gap={isEmpty ? 0 : 1}>
      {/*
        `variant="labelCaps"` rather than a hand-rolled 11px/700/0.06em with no `text-transform` (6.28
        review). DESIGN.md's `candidate-list` entry cites {typography.label-caps} for this heading, and a
        local approximation of it made that record false. Bare, as every section label in `TripImportDialog`
        and `TripsDashboard` takes it — `FormField.tsx` and `TripShareDialog.tsx` override the size to
        11px/0.06em, but only because the mockup's `.field-label` differs, and this is not a field label.
        `component` is mandatory: `labelCaps` has no `variantMapping` entry, so Typography would otherwise
        pick its own element — and a `span` is what this is, a label for the group rather than a document
        heading that would insert itself into the dialog's outline.

        `role="status"` because the list otherwise arrives in complete silence: focus stays parked on
        *Find*, and "Select a place (2)" is the only thing that says a choice is now waiting. The nearest
        thing to a precedent is `TripDayView.tsx:3106`, which announces its own recomputed line with a bare
        `aria-live="polite"`; `role="status"` is the implicit-live-region spelling of the same thing and is
        preferred here because this element also carries the group's accessible name via `aria-labelledby`,
        so it needs a role that permits one. (An earlier draft of this block cited that file and
        `FullscreenPhotoViewer.tsx` as `role="status"` precedents — neither uses the role, and the second
        has no live region at all. 6.28 follow-up review.)
      */}
      <Typography
        id={headingId}
        role="status"
        variant="labelCaps"
        component="span"
        sx={{ display: "block", color: tokens.inkSoft }}
      >
        {isEmpty ? "" : formatMessage(t("trips.location.resultsLabel"), { count: candidates.length })}
      </Typography>
      {/*
        `role="group"` is load-bearing, not decoration: a bare `<div>` carries the implicit `generic` role,
        which **prohibits** an accessible name, so assistive tech dropped the `aria-labelledby` entirely
        and the group this docblock and DESIGN.md both describe did not exist for the users it is for.
      */}
      {isEmpty ? null : (
      <Box role="group" aria-labelledby={headingId} sx={{ borderTop: `1px solid ${tokens.border}` }}>
        {candidates.map((candidate, index) => (
          <Button
            // Two Nominatim rows can share a centroid, so the pair alone is not unique and the index goes
            // into the key as well — duplicate keys are a React warning and a reconciliation hazard.
            key={`${candidate.lat},${candidate.lng},${index}`}
            // Explicit, not inherited from `ButtonBase`'s default: the bucket-list panel renders this
            // list inside its `<form>`, where a `<button>` with no `type` submits it.
            type="button"
            variant="text"
            fullWidth
            disabled={disabled}
            onClick={() => onSelect(candidate)}
            sx={{
              justifyContent: "flex-start",
              textAlign: "left",
              textTransform: "none",
              fontWeight: 600,
              color: tokens.ink,
              borderRadius: 0,
              px: "10px",
              borderBottom: index === candidates.length - 1 ? "none" : `1px solid ${tokens.border}`,
            }}
          >
            {candidate.label}
          </Button>
        ))}
      </Box>
      )}
    </Box>
  );
}
