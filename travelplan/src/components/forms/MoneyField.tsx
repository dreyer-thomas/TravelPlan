"use client";

import type { Ref } from "react";
import { Box, MenuItem, Select, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FormField from "@/components/forms/FormField";
import { WarningTriangleIcon } from "@/components/features/trips/TripIcons";
import { ECB_CURRENCIES } from "@/lib/rates/exchangeRateService";

/**
 * The selector's codes, sorted.
 *
 * `ECB_CURRENCIES` deliberately keeps the order the ECB publishes - it mirrors the feed document,
 * and that constant is the one place in the codebase that knows its shape - so the sort happens here
 * rather than there. The published order is four blocks, each alphabetical inside itself (the two
 * majors, then EU non-euro members, then other European, then the rest of the world), which reads as
 * almost-sorted and is worse than either: `GBP` lands in the middle and `NZD` is the twenty-fifth of
 * twenty-nine. Someone opening a 92px menu is looking for a code they already know, not comparing it
 * against ecb.europa.eu.
 *
 * Computed once at module scope: the list only changes when the constant does, and re-sorting on
 * every render of every money field would be work for nothing.
 */
const CURRENCY_OPTIONS = [...ECB_CURRENCIES].sort();

/**
 * A cost amount and the currency it is quoted in, as one field.
 *
 * Composes `FormField` rather than re-styling an input: the 44px height, the `cardAlt` fill, the
 * focus ring and the error treatment all come from `theme.ts`'s `MuiOutlinedInput` override through
 * that component, and a second implementation of them would drift from the first on the next theme
 * change.
 *
 * **The currency pair is optional, and that is the design.** `currency` + `onCurrencyChange` given,
 * the field renders its selector; omitted, it renders the amount alone. A payment row uses the second
 * shape, which is how DESIGN.md's "one selector per entry - the select is the entry's control, not
 * the field's" is expressed in code that cannot be got wrong, rather than in a comment that can be
 * ignored. Two rates inside one entry would break the exact-integer
 * `sum(payments.amountCents) === costCents` the server enforces in three places.
 *
 * The caption slot below the field holds exactly one line - the converted figure, the
 * rate-unavailable notice, or the field's own hint - and **nothing at all** when a EUR field has no
 * hint. No reserved height: a euro field must lay out exactly as it did before this component
 * existed.
 */

type MoneyFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  /** The single-payment row mirrors the cost box rather than being edited; it is not disabled. */
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Present together with `onCurrencyChange`, or the selector is not rendered at all. */
  currency?: string;
  onCurrencyChange?: (currency: string) => void;
  /**
   * The accessible name of the selector - the caller passes the translated string.
   *
   * No default. Story 10.1 review: it used to fall back to the English literal `"Currency"`, which
   * both callers always override, so the only way to see it was to add a third caller and forget.
   */
  currencyLabel?: string;
  /** The converted EUR figure, already formatted and already wrapped in its caption template. */
  convertedCaption?: string | null;
  /**
   * The publication date of the rate behind `convertedCaption`, already wrapped in its template.
   *
   * Story 10.1 review. Rendered as a second, quieter line under the converted figure rather than
   * folded into it: the conversion answers "how much is this in euros", the date answers "priced
   * when", and an entry reopened months later needs the second to make sense of the first. Shown
   * only alongside a conversion - a notice means there is no rate, so there is no date either.
   */
  rateDateCaption?: string | null;
  /** Rate lookup failed. Takes precedence over `convertedCaption`: there is no figure to show. */
  notice?: string | null;
};

export default function MoneyField({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  hint,
  disabled,
  readOnly,
  inputRef,
  currency,
  onCurrencyChange,
  currencyLabel,
  convertedCaption,
  rateDateCaption,
  notice,
}: MoneyFieldProps) {
  const theme = useTheme();
  const showSelector = Boolean(currency && onCurrencyChange);

  /*
    Precedence, and it is deliberate rather than incidental: a notice means no rate was obtained, so
    there is no converted figure to show beside it, and the notice is the more urgent of the two. The
    field's own hint yields to both - it describes the field in general, they describe this value.
  */
  const caption = notice ?? convertedCaption ?? null;

  const field = (
    <FormField
      id={id}
      label={label}
      error={error}
      // The hint goes to `FormField` only when the caption slot below is not carrying anything: two
      // helper lines under one input is not a state this field has.
      hint={caption ? undefined : hint}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      // `type="text"` + `inputMode="decimal"`, never `type="number"`: Story 6.27: a `type="number"`
      // input calls a comma `badInput` and hands React `""`, which silently dropped the price of
      // every stay entered on a German keyboard.
      type="text"
      slotProps={{ htmlInput: { inputMode: "decimal", readOnly: Boolean(readOnly) } }}
      inputRef={inputRef}
    />
  );

  return (
    <Box>
      {/*
        `flex-start`, not `flex-end`.

        The two columns are not the same shape: the left is label + input + `FormField`'s helper line
        ("Optionaler Betrag (z. B. 10,00 oder 10.00)", or an error), the right is label + select and
        nothing under it. Aligning by the *bottom* therefore pushed the whole currency column down by
        the height of that helper line - about 50px in the German activity dialog - so `WÄHRUNG` sat
        well below `KOSTEN` and the select's box below the amount box, although the two labels are
        deliberately styled identically to sit on one baseline.

        From the top they do sit on one baseline: both labels are 11px/0.06em with `mb: 7px`, so the
        input and the select start at the same y and the helper line hangs below the amount alone,
        which is where it belongs.
      */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{field}</Box>
        {showSelector ? (
          <Box>
            <Typography
              component="span"
              aria-hidden
              variant="labelCaps"
              sx={{
                // The same two deltas `FormField` applies to `labelCaps`, so the two labels sit on
                // one baseline rather than one pixel apart.
                fontSize: 11,
                letterSpacing: "0.06em",
                color: theme.palette.tokens.inkSoft,
                display: "block",
                mb: "7px",
              }}
            >
              {currencyLabel}
            </Typography>
            <Select
              id={`${id}-currency`}
              value={currency}
              onChange={(event) => onCurrencyChange?.(event.target.value)}
              disabled={disabled}
              /*
                `aria-label` is the selector's whole accessible name, so the visible text above is
                `aria-hidden` and carries no `htmlFor`. It used to have one: MUI's `Select` is not a
                native control, it puts the `htmlFor` target on a hidden input, and the `aria-label`
                won the accessible name anyway - so the label was announced twice and clicking the
                visible word opened nothing, unlike every other labelled field in these dialogs.
              */
              inputProps={{ "aria-label": currencyLabel }}
              sx={{ width: 92, minHeight: 44 }}
            >
              {/*
                EUR first and outside the list, because it is not one of the twenty-nine: the ECB
                document quotes every rate *against* the euro, so it has no row of its own - and
                because it is this field's default, which belongs at the top whatever the rest do.
                Then the codes alphabetically; see `CURRENCY_OPTIONS`.
              */}
              <MenuItem value="EUR">EUR</MenuItem>
              {CURRENCY_OPTIONS.map((code) => (
                <MenuItem key={code} value={code}>
                  {code}
                </MenuItem>
              ))}
              {/*
                Story 10.1 review. An entry can hold a code this list does not: `costCurrency` accepts
                any non-EUR ISO code, and `ECB_CURRENCIES` is a moving target - BGN left the feed on
                euro accession, HRK before it. Without a row of its own such a value rendered an empty
                box the user could neither read nor re-select. Tightening the schema to the constant
                instead would be the wrong half to fix: editing the list would then invalidate stored
                data, which the story's AC correction explicitly rules out.
              */}
              {currency && currency !== "EUR" && !ECB_CURRENCIES.includes(currency as never) ? (
                <MenuItem value={currency}>{currency}</MenuItem>
              ) : null}
            </Select>
          </Box>
        ) : null}
      </Box>
      {caption ? (
        <Typography
          data-testid="money-field-caption"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            mt: "6px",
            fontSize: 11,
            fontWeight: notice ? 700 : 600,
            // A notice is `warn`, a conversion is `ink-soft`. Neither touches the input's border or
            // background: an unreachable rate feed is not a value the user must fix.
            color: notice ? theme.palette.warning.main : theme.palette.tokens.inkSoft,
            // A compared numeric value, per DESIGN.md's hard rule in Typography.
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {notice ? <WarningTriangleIcon sx={{ fontSize: 14, flexShrink: 0 }} /> : null}
          {caption}
        </Typography>
      ) : null}
      {!notice && convertedCaption && rateDateCaption ? (
        <Typography
          data-testid="money-field-rate-date"
          sx={{
            mt: "2px",
            fontSize: 11,
            fontWeight: 600,
            color: theme.palette.tokens.inkSoft,
            opacity: 0.8,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {rateDateCaption}
        </Typography>
      ) : null}
    </Box>
  );
}
