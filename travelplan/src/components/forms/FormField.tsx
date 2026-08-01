"use client";

import type { Ref } from "react";
import { Box, TextField, type TextFieldProps, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { WarningTriangleIcon } from "@/components/features/trips/TripIcons";

/**
 * The above-field label + input + inline hint/error triple every form surface uses (`.field-block`).
 *
 * Landed by Story 7.6 as `features/auth/AuthField`; moved here by 7.7 — the second consumer — because
 * `architecture.md:399-402` puts form components under `components/forms/*`. The move preserved 7.6's
 * contract; the only addition is the optional non-error `hint` line, which the auth screens never
 * rendered and the trip dialogs need on ~8 fields (`trips.plan.costHelper`, `trips.stay.linkHelper`,
 * `trips.form.heroImageHelper`, …). Auth's rendered output is unchanged: with `hint` absent and
 * `error` set, the helper line is still 11px/700/`warning.main`.
 *
 * The `htmlFor`/`id` pair IS the accessible name — the mockup has no floating label, and the auth,
 * trip-create, accommodation and day-plan tests all resolve their controls through `getByLabelText`.
 * A placeholder is never the only description of a field (placeholder text uses `inkMuted`, which is
 * below AA).
 *
 * Uppercase comes from the `labelCaps` variant's CSS `text-transform`, NEVER from uppercasing the
 * i18n string: `getByLabelText("Title")` matches on `textContent`, which CSS does not touch. For the
 * same reason nothing but the label text goes inside the `<label>` — no "optional" badge, no icon.
 *
 * The 44px height, `cardAlt` fill, `borderStrong` border, accent focus ring and the error border/fill
 * swap all come from `theme.ts`'s `MuiOutlinedInput` override — none of them is redeclared here.
 */

type FormFieldProps = Omit<TextFieldProps, "id" | "label" | "error" | "helperText"> & {
  id: string;
  label: string;
  error?: string;
  /** `.field-hint` — the non-error helper line. An error replaces it rather than stacking above it. */
  hint?: string;
  /** React 19 treats `ref` as a plain prop; `react-hook-form`'s `register()` spreads one in. */
  ref?: Ref<HTMLDivElement>;
};

export default function FormField({ id, label, error, hint, ...rest }: FormFieldProps) {
  const theme = useTheme();

  return (
    <Box>
      <Typography
        component="label"
        htmlFor={id}
        variant="labelCaps"
        sx={{
          // `labelCaps` is 10.5px/0.08em; the mockup's `.field-label` is 11px/0.06em. Override the two
          // deltas here rather than inventing a variant or editing theme.ts.
          fontSize: 11,
          letterSpacing: "0.06em",
          color: theme.palette.tokens.inkSoft,
          display: "block",
          mb: "7px",
        }}
      >
        {label}
      </Typography>
      <TextField
        id={id}
        fullWidth
        error={Boolean(error)}
        helperText={
          error ? (
            <Box component="span" sx={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <WarningTriangleIcon sx={{ fontSize: 12, flexShrink: 0 }} />
              {error}
            </Box>
          ) : (
            hint
          )
        }
        {...rest}
        sx={[
          {
            "& .MuiOutlinedInput-input::placeholder": {
              color: theme.palette.tokens.inkMuted,
              opacity: 1,
              fontWeight: 600,
            },
            // `.field-hint` is 11px/600/#8A8677; `.field-hint.error` is 11px/700/#8A5A2B.
            "& .MuiFormHelperText-root": {
              fontSize: 11,
              fontWeight: 600,
              color: theme.palette.tokens.inkMuted,
              marginLeft: 0,
              marginTop: "6px",
            },
            // MUI's default helper-text red is not in DESIGN.md; the warn family is what the system has.
            "& .MuiFormHelperText-root.Mui-error": { color: "warning.main", fontWeight: 700 },
          },
          // MUI's array form, not an object spread: `TextFieldProps["sx"]` legitimately accepts an
          // array or a callback, and spreading either into an object literal drops it silently.
          ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx]),
        ]}
      />
    </Box>
  );
}
