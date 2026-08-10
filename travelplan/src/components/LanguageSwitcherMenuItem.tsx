"use client";

import { Fragment } from "react";
import { Menu, MenuItem, Typography } from "@mui/material";
import { useI18n } from "@/i18n/provider";
import type { Language } from "@/i18n";

const languageToKey = (value: Language) => `language.${value}`;

/**
 * DW-180, the same doubled selector `HeaderMenu`, `TripDayView` and `AdminUsersList` use. The mechanism is
 * written out once, on `HEADER_MENU_ITEM_SX` in `HeaderMenu.tsx`, rather than restated here: the short of
 * it is that a bare `sx={{ minHeight: 44 }}` is one class and loses to MUI's own `sm` reset, and `&&` is
 * not.
 *
 * Its own const rather than an import from that file: every other site in the app is local to where it is
 * used, and this file's three rows are the whole of its usage.
 */
const LANGUAGE_MENU_ITEM_SX = { "&&": { minHeight: 44 } } as const;

/**
 * The trigger row and the submenu it opens, each needing the other's id: `aria-controls` points down and
 * `aria-labelledby` points back up, so neither can be spelled inline.
 */
const LANGUAGE_MENU_ID = "header-language-menu";
const LANGUAGE_TRIGGER_ID = "header-language-menu-button";

const buildLanguageLabel = (value: Language, t: (key: string) => string) =>
  `${t(languageToKey(value))} (${value.toUpperCase()})`;

type LanguageMenuProps = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onLanguageChange?: (language: Language) => void;
};

const LanguageMenu = ({ anchorEl, open, onClose, onLanguageChange }: LanguageMenuProps) => {
  const { language, setLanguage, t } = useI18n();

  const handleSelect = (value: Language) => {
    setLanguage(value);
    onLanguageChange?.(value);
    onClose();
  };

  return (
    <Menu
      id={LANGUAGE_MENU_ID}
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      // `slotProps.paper`, not the deprecated `PaperProps` (MUI 7), same as the two menus above this one.
      slotProps={{
        paper: {
          sx: {
            mt: -0.5,
            borderRadius: 3,
            px: 1,
            backgroundColor: "#ffffff",
            border: "1px solid rgba(17, 18, 20, 0.08)",
            boxShadow: "0 20px 40px rgba(17, 18, 20, 0.18)",
          },
        },
        // Named by the row that opens it, so the submenu is not announced as an unnamed pair of options.
        list: { "aria-labelledby": LANGUAGE_TRIGGER_ID },
      }}
    >
      {(["en", "de"] as Language[]).map((value) => (
        <MenuItem key={value} onClick={() => handleSelect(value)} sx={LANGUAGE_MENU_ITEM_SX}>
          <Typography sx={{ width: 24, textAlign: "center", mr: 1 }} aria-hidden="true">
            {language === value ? "•" : ""}
          </Typography>
          <Typography>{t(languageToKey(value))}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
            {value.toUpperCase()}
          </Typography>
        </MenuItem>
      ))}
    </Menu>
  );
};

type LanguageSwitcherMenuItemProps = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onOpen: (event: React.MouseEvent<HTMLElement>) => void;
  onClose: () => void;
  onLanguageChange?: (language: Language) => void;
};

export default function LanguageSwitcherMenuItem({
  anchorEl,
  open,
  onOpen,
  onClose,
  onLanguageChange,
}: LanguageSwitcherMenuItemProps) {
  const { language, t } = useI18n();
  const label = t("language.label");

  return (
    <Fragment>
      {/* A row that opens a second menu, so it announces one - the same defect DW-97 records on the
          hamburger, in the one other file this change opens. `>` at the end of the row is the only signal
          a sighted user has and there was no equivalent for anyone else; `aria-controls` is gated on
          `open` because the submenu is not rendered while closed. */}
      <MenuItem
        id={LANGUAGE_TRIGGER_ID}
        onClick={onOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? LANGUAGE_MENU_ID : undefined}
        sx={LANGUAGE_MENU_ITEM_SX}
      >
        <Typography sx={{ display: "flex", alignItems: "center", width: "100%" }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {buildLanguageLabel(language, t)}
        </Typography>
        <Typography sx={{ marginLeft: "auto" }} aria-hidden="true">
          {">"}
        </Typography>
      </MenuItem>
      <LanguageMenu anchorEl={anchorEl} open={open} onClose={onClose} onLanguageChange={onLanguageChange} />
    </Fragment>
  );
}
