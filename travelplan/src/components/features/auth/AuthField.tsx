"use client";

import type { Ref } from "react";
import { Box, TextField, type TextFieldProps, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { WarningTriangleIcon } from "@/components/features/trips/TripIcons";

/**
 * The above-field label + input + inline error triple every auth screen uses (`.field-block`).
 *
 * The `htmlFor`/`id` pair IS the accessible name — the mockup has no floating label, and
 * `test/loginPage.test.tsx` resolves both login fields through `getByLabelText`. A placeholder is
 * never the only description of a field (placeholder text uses `inkMuted`, which is below AA).
 *
 * The 44px height, `cardAlt` fill, `borderStrong` border, accent focus ring and the error border/fill
 * swap all come from `theme.ts`'s `MuiOutlinedInput` override — none of them is redeclared here.
 */

type AuthFieldProps = Omit<TextFieldProps, "id" | "label" | "error" | "helperText"> & {
  id: string;
  label: string;
  error?: string;
  /** React 19 treats `ref` as a plain prop; `react-hook-form`'s `register()` spreads one in. */
  ref?: Ref<HTMLDivElement>;
};

export default function AuthField({ id, label, error, ...rest }: AuthFieldProps) {
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
          ) : undefined
        }
        {...rest}
        sx={{
          "& .MuiOutlinedInput-input::placeholder": {
            color: theme.palette.tokens.inkMuted,
            opacity: 1,
            fontWeight: 600,
          },
          "& .MuiFormHelperText-root": {
            fontSize: 11,
            fontWeight: 700,
            marginLeft: 0,
            marginTop: "6px",
          },
          // MUI's default helper-text red is not in DESIGN.md; the warn family is what the system has.
          "& .MuiFormHelperText-root.Mui-error": { color: "warning.main" },
          ...rest.sx,
        }}
      />
    </Box>
  );
}
