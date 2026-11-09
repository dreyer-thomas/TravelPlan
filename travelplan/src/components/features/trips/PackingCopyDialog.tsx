"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, ButtonBase, Checkbox, CircularProgress, Typography, useTheme } from "@mui/material";
import { formatMessage, INTL_LOCALES } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import DialogShell, { useOpenInstanceKey } from "@/components/ui/DialogShell";
import { PackingNameWithTags } from "@/components/features/trips/PackingTags";
import { groupPackingItems, packingNameKey } from "@/lib/trips/packingList";
import type { PackingItemWire } from "@/components/features/trips/TripPackingList";

/**
 * Story 16.5 (FR60). "Aus anderer Reise übernehmen": step 1 picks another trip that has a packing list
 * (D1), step 2 picks its items - grouped like the list, not-needed items inside their category, all
 * selected at first, with hints for names already on this trip and items not needed there (D2). The parent
 * does the POST (it owns the items, the write counter and the notice); this dialog only shows the error it
 * gets back and stays on step 2 with the selection.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export type PackingCopySourceWire = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  itemCount: number;
};

type PackingCopyDialogProps = {
  open: boolean;
  tripId: string;
  currentItems: readonly Pick<PackingItemWire, "name">[];
  onClose: () => void;
  onCopy: (sourceTripId: string, itemIds: string[]) => Promise<{ error?: string }>;
};

const TOUCH_TARGET_PX = 44;

export default function PackingCopyDialog(props: PackingCopyDialogProps) {
  const key = useOpenInstanceKey(props.open);
  return <PackingCopyDialogBody key={key} {...props} />;
}

function PackingCopyDialogBody({ open, tripId, currentItems, onClose, onCopy }: PackingCopyDialogProps) {
  const { t, language } = useI18n();
  const locale = INTL_LOCALES[language];
  const { tokens } = useTheme().palette;

  const [sources, setSources] = useState<PackingCopySourceWire[] | null>(null);
  const [sourcesError, setSourcesError] = useState(false);
  const [source, setSource] = useState<PackingCopySourceWire | null>(null);
  const [sourceItems, setSourceItems] = useState<PackingItemWire[] | null>(null);
  const [itemsError, setItemsError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/trips/${tripId}/packing-items/copy`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const body = (await response.json()) as ApiEnvelope<{ trips: PackingCopySourceWire[] }>;
        if (!active) return;
        if (!response.ok || body.error || !body.data) setSourcesError(true);
        else setSources(body.data.trips);
      } catch {
        if (active) setSourcesError(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [open, tripId]);

  useEffect(() => {
    if (!source) return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/trips/${source.id}/packing-items`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const body = (await response.json()) as ApiEnvelope<{ items: PackingItemWire[] }>;
        if (!active) return;
        if (!response.ok || body.error || !body.data) {
          setItemsError(true);
        } else {
          setSourceItems(body.data.items);
          setSelected(new Set(body.data.items.map((item) => item.id)));
        }
      } catch {
        if (active) setItemsError(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [source]);

  const formatDate = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    return (value: string) => format.format(new Date(value));
  }, [locale]);

  const existingKeys = useMemo(() => new Set(currentItems.map((item) => packingNameKey(item.name))), [currentItems]);
  const groups = useMemo(
    () => (sourceItems ? groupPackingItems(sourceItems, t("trips.packingList.other"), locale) : []),
    [sourceItems, locale, t],
  );

  const chooseSource = (next: PackingCopySourceWire) => {
    setSource(next);
    setSourceItems(null);
    setItemsError(false);
    setSelected(new Set());
    setCopyError(null);
  };

  const backToTrips = () => {
    setSource(null);
    setSourceItems(null);
    setItemsError(false);
    setSelected(new Set());
    setCopyError(null);
  };

  const toggleItem = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (ids: string[], allSelected: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const confirm = async () => {
    if (!source || selected.size === 0) return;
    setBusy(true);
    setCopyError(null);
    let failed = true;
    try {
      const result = await onCopy(source.id, [...selected]);
      // On success the parent closes the dialog; on failure stay on step 2 with the selection.
      if (result.error) setCopyError(result.error);
      else failed = false;
    } catch {
      setCopyError(t("errors.server"));
    } finally {
      // Never leave the dialog stuck in its undismissable busy state.
      if (failed) setBusy(false);
    }
  };

  const itemCountLabel = (count: number) =>
    count === 1
      ? t("trips.packingList.copyItemCountOne")
      : formatMessage(t("trips.packingList.copyItemCount"), { count });

  const footer = source ? (
    <>
      <Button onClick={backToTrips} disabled={busy} sx={{ minHeight: TOUCH_TARGET_PX }}>
        {t("trips.packingList.copyBack")}
      </Button>
      <Button
        variant="contained"
        onClick={() => void confirm()}
        disabled={busy || selected.size === 0}
        sx={{ minHeight: TOUCH_TARGET_PX }}
        data-testid="packing-copy-confirm"
      >
        {formatMessage(t("trips.packingList.copyConfirm"), { count: selected.size })}
      </Button>
    </>
  ) : null;

  const hint = (text: string) => (
    <Typography variant="caption" component="span" sx={{ color: tokens.inkSoft, fontSize: 12 }}>
      {text}
    </Typography>
  );

  const loadErrorAlert = (
    <Alert severity="error" data-testid="packing-copy-load-error">
      {t("trips.packingList.copyLoadError")}
    </Alert>
  );

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={t("trips.packingList.copyTitle")}
      closeLabel={t("common.close")}
      width={520}
      fullScreenOnPhone
      disableDismiss={busy}
      footer={footer}
      footerSx={{ justifyContent: "space-between" }}
    >
      {!source && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }} data-testid="packing-copy-step-trips">
          <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
            {t("trips.packingList.copyChooseTrip")}
          </Typography>
          {sourcesError && loadErrorAlert}
          {!sourcesError && sources === null && <CircularProgress size={24} sx={{ alignSelf: "center", my: 2 }} />}
          {sources !== null && sources.length === 0 && (
            <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-copy-no-sources">
              {t("trips.packingList.copyNoSources")}
            </Typography>
          )}
          {sources?.map((trip) => (
            <ButtonBase
              key={trip.id}
              onClick={() => chooseSource(trip)}
              data-testid="packing-copy-source"
              sx={{
                minHeight: TOUCH_TARGET_PX,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                textAlign: "left",
                px: 1.5,
                py: 1,
                borderRadius: 1,
                border: 1,
                borderColor: tokens.border,
                minWidth: 0,
              }}
            >
              <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                {trip.name}
              </Typography>
              <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
                {`${formatDate(trip.startDate)} – ${formatDate(trip.endDate)} · ${itemCountLabel(trip.itemCount)}`}
              </Typography>
            </ButtonBase>
          ))}
        </Box>
      )}

      {source && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }} data-testid="packing-copy-step-items">
          <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
            {source.name}
          </Typography>
          {itemsError && loadErrorAlert}
          {!itemsError && sourceItems === null && <CircularProgress size={24} sx={{ alignSelf: "center", my: 2 }} />}
          {sourceItems !== null && (
            <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-copy-count">
              {formatMessage(t("trips.packingList.copySelectedCount"), {
                selected: selected.size,
                total: sourceItems.length,
              })}
            </Typography>
          )}
          {copyError && (
            <Alert severity="error" data-testid="packing-copy-error">
              {copyError}
            </Alert>
          )}
          {groups.map((group) => {
            const ids = group.items.map((item) => item.id);
            const count = ids.filter((id) => selected.has(id)).length;
            const allSelected = count === ids.length;
            return (
              <Box
                key={group.key === null ? "none" : `category:${group.key}`}
                component="section"
                data-testid="packing-copy-group"
                sx={{ minWidth: 0 }}
              >
                <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer" }}>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={count > 0 && !allSelected}
                    onChange={() => toggleGroup(ids, allSelected)}
                    disabled={busy}
                    slotProps={{
                      input: {
                        "aria-label": formatMessage(t("trips.packingList.copySelectGroupAria"), {
                          category: group.label,
                        }),
                      },
                    }}
                    sx={{ width: TOUCH_TARGET_PX, height: TOUCH_TARGET_PX }}
                  />
                  <Typography variant="labelCaps" component="h3" sx={{ color: tokens.inkSoft }}>
                    {group.label}
                  </Typography>
                </Box>
                {group.items.map((item) => (
                  <Box
                    key={item.id}
                    component="label"
                    data-testid="packing-copy-item"
                    sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 2, minWidth: 0, cursor: "pointer" }}
                  >
                    <Checkbox
                      checked={selected.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      disabled={busy}
                      sx={{ width: TOUCH_TARGET_PX, height: TOUCH_TARGET_PX, flex: "0 0 auto" }}
                    />
                    <Box sx={{ flex: "1 1 auto", minWidth: 0, py: 0.5 }}>
                      <PackingNameWithTags tags={item.tags}>
                        <Typography variant="body1" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                          {item.name}
                        </Typography>
                      </PackingNameWithTags>
                      {(existingKeys.has(packingNameKey(item.name)) || item.notNeeded) && (
                        <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 1 }}>
                          {existingKeys.has(packingNameKey(item.name)) && hint(t("trips.packingList.copyAlreadyOnList"))}
                          {item.notNeeded && hint(t("trips.packingList.copyWasNotNeeded"))}
                        </Box>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            );
          })}
        </Box>
      )}
    </DialogShell>
  );
}
