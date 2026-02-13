"use client";

import { Fragment } from "react";
import { Menu, MenuItem, Typography } from "@mui/material";
import { useI18n } from "@/i18n/provider";
import type { Language } from "@/i18n";

const languageToKey = (value: Language) => `language.${value}`;

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
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      PaperProps={{
        sx: {
          mt: -0.5,
          borderRadius: 3,
          px: 1,
          backgroundColor: "#ffffff",
          border: "1px solid rgba(17, 18, 20, 0.08)",
          boxShadow: "0 20px 40px rgba(17, 18, 20, 0.18)",
        },
      }}
    >
      {(["en", "de"] as Language[]).map((value) => (
        <MenuItem key={value} onClick={() => handleSelect(value)}>
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
      <MenuItem onClick={onOpen}>
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
