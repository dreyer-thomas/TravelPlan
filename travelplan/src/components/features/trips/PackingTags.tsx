"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Autocomplete, Box, Chip, TextField, useTheme } from "@mui/material";
import { formatMessage, INTL_LOCALES } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { CloseXIcon } from "@/components/features/trips/TripIcons";
import {
  normalizePackingTag,
  PACKING_TAG_MAX,
  PACKING_TAGS_PER_ITEM_MAX,
  packingTagKey,
  sortPackingTags,
  suggestedPackingTags,
} from "@/lib/trips/packingList";

/**
 * Story 16.8 (FR58). The packing list's tag pieces: the display chips on an item (trip list, not-needed
 * section, day section), the tags field of the add form and the edit dialog, and its suggestions.
 *
 * The tags field is controlled twice over: the chosen tags (`value`) and the text being typed
 * (`inputValue`) both live in the parent, so the parent can add the typed text as a tag when the form is
 * submitted (`commitPackingTagText`) - text typed but not yet entered is never silently dropped.
 */

const TOUCH_TARGET_PX = 44;

/**
 * Adds `incoming` to `current`: normalized, empties and tags already there (ignoring case) skipped, at most
 * 10 in all. `refused` says a tag was turned away by the limit.
 */
export const addPackingTags = (current: readonly string[], incoming: readonly string[]) => {
  const tags = [...current];
  const keys = new Set(current.map(packingTagKey));
  let refused = false;
  for (const raw of incoming) {
    const tag = normalizePackingTag(raw).slice(0, PACKING_TAG_MAX);
    const key = tag.toLowerCase();
    if (key.length === 0 || keys.has(key)) continue;
    if (tags.length >= PACKING_TAGS_PER_ITEM_MAX) {
      refused = true;
      continue;
    }
    keys.add(key);
    tags.push(tag);
  }
  return { tags, refused };
};

/** The tags with the typed text added (split at commas), for a submit. */
export const commitPackingTagText = (current: readonly string[], text: string) =>
  addPackingTags(current, text.split(","));

/** Whether two tag lists hold the same tags, ignoring case and order. */
export const samePackingTags = (left: readonly string[], right: readonly string[]) => {
  const leftKeys = [...new Set(left.map(packingTagKey))].sort();
  const rightKeys = [...new Set(right.map(packingTagKey))].sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
};

/** The tags field's suggestions: the defaults in the UI language plus every tag used on the trip. */
export const usePackingTagOptions = (items: readonly { tags: readonly string[] }[]) => {
  const { t, language } = useI18n();
  const locale = INTL_LOCALES[language];
  return useMemo(
    () =>
      suggestedPackingTags(
        [
          t("trips.packingList.suggestTag.buy"),
          t("trips.packingList.suggestTag.repair"),
          t("trips.packingList.suggestTag.charge"),
          t("trips.packingList.suggestTag.customs"),
        ],
        items.flatMap((item) => item.tags),
        locale,
      ),
    [items, locale, t],
  );
};

/**
 * The soft `badge-pill` (accent text on accent-soft, 11px/800, radius 4px): the look of the day view's time
 * pill. Never the warn colours (reserved for gaps) and never the AI badge's neutral fill.
 */
const usePillSx = () => {
  const theme = useTheme();
  return {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: 800,
    lineHeight: 1.4,
    color: theme.palette.primary.main,
    backgroundColor: theme.palette.tokens.accentSoft,
    borderRadius: "4px",
    padding: "3px 8px",
    whiteSpace: "nowrap",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as const;
};

/**
 * An item's tags as display chips, alphabetically (D2). A fragment: the caller's `flex-wrap` box lays the
 * name and the chips out, so the chips wrap below the name at phone width instead of truncating it.
 */
export function PackingTagChips({ tags }: { tags: readonly string[] | undefined }) {
  const { language } = useI18n();
  const pillSx = usePillSx();
  // `undefined`: an item from a payload written before 16.8 (a page left open across a deploy).
  if (!tags || tags.length === 0) return null;
  return (
    <>
      {sortPackingTags(tags, INTL_LOCALES[language]).map((tag) => (
        <Box component="span" key={packingTagKey(tag)} data-testid="packing-tag" sx={pillSx}>
          {tag}
        </Box>
      ))}
    </>
  );
}

/** The name and its tag chips in one wrapping line; `children` is the name. */
export function PackingNameWithTags({ tags, children }: { tags: readonly string[] | undefined; children: ReactNode }) {
  return (
    <Box
      sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 0.75, rowGap: 0.5, minWidth: 0 }}
    >
      {children}
      <PackingTagChips tags={tags} />
    </Box>
  );
}

type PackingTagInputProps = {
  value: string[];
  onChange: (tags: string[]) => void;
  inputValue: string;
  onInputValueChange: (text: string) => void;
  options: readonly string[];
  disabled?: boolean;
  /** Flex `order` inside the parent's row (the add form shows the field below its Add button). */
  order?: number;
  testId?: string;
};

/**
 * The tags field: Enter or a comma turns the typed text into a tag, a suggestion adds itself, a duplicate
 * (ignoring case) is ignored, the 11th tag is turned away with "At most 10 tags.". Each chip is removed with
 * one tap on its delete control (a 44px hit area around a small cross).
 */
export function PackingTagInput({
  value,
  onChange,
  inputValue,
  onInputValueChange,
  options,
  disabled,
  order,
  testId,
}: PackingTagInputProps) {
  const { t } = useI18n();
  const [limitHit, setLimitHit] = useState(false);
  const chosen = useMemo(() => new Set(value.map(packingTagKey)), [value]);
  const available = useMemo(() => options.filter((option) => !chosen.has(packingTagKey(option))), [chosen, options]);
  const atLimit = value.length >= PACKING_TAGS_PER_ITEM_MAX;
  const showLimit = atLimit && (limitHit || inputValue.trim().length > 0);

  const add = (incoming: readonly string[]) => {
    const next = addPackingTags(value, incoming);
    if (next.refused) setLimitHit(true);
    if (next.tags.length !== value.length) onChange(next.tags);
  };

  return (
    <Autocomplete<string, true, false, true>
      multiple
      freeSolo
      disabled={disabled}
      options={available}
      value={value}
      inputValue={inputValue}
      onChange={(_event, next, reason) => {
        if (reason === "createOption" || reason === "selectOption") {
          // The new entry is the last one; route it through the same rules as a comma.
          add([next[next.length - 1] ?? ""]);
          return;
        }
        setLimitHit(false);
        onChange(next);
      }}
      onInputChange={(_event, text, reason) => {
        if (reason === "input" && text.includes(",")) {
          const pieces = text.split(",");
          const rest = pieces.pop() ?? "";
          add(pieces);
          onInputValueChange(rest);
          return;
        }
        onInputValueChange(text);
      }}
      sx={{ flex: "1 1 100%", minWidth: 0, ...(order !== undefined ? { order } : {}) }}
      data-testid={testId}
      renderValue={(tags, getItemProps) =>
        tags.map((tag, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return (
            <Chip
              key={key}
              {...itemProps}
              size="small"
              label={tag}
              data-testid="packing-tag-input-chip"
              deleteIcon={
                <Box
                  component="span"
                  role="button"
                  aria-label={formatMessage(t("trips.packingList.tagRemoveAria"), { tag })}
                  sx={{
                    // A 44px hit area around the small cross; the negative margins keep the chip compact.
                    width: TOUCH_TARGET_PX,
                    height: TOUCH_TARGET_PX,
                    margin: "-10px -12px -10px -8px !important",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 auto",
                  }}
                >
                  <CloseXIcon sx={{ fontSize: 14 }} />
                </Box>
              }
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={t("trips.packingList.tagsLabel")}
          size="small"
          helperText={showLimit ? t("trips.packingList.tagLimit") : undefined}
          // No maxLength here: the raw text can hold a pasted comma list; each piece is capped by addPackingTags.
          slotProps={{ htmlInput: params.inputProps }}
        />
      )}
    />
  );
}
