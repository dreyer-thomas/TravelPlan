"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  TextField,
  Typography,
  createFilterOptions,
  useTheme,
} from "@mui/material";
import { formatMessage, INTL_LOCALES } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import AiBadge from "@/components/ui/AiBadge";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import { CheckIcon, CloseXIcon, PlusIcon } from "@/components/features/trips/TripIcons";
import {
  packingApiErrorMessage,
  usePackingCategoryOptions,
  type PackingItemWire,
} from "@/components/features/trips/TripPackingList";
import { groupPackingItems, PACKING_CATEGORY_MAX, PACKING_ITEM_NAME_MAX, packingNameKey } from "@/lib/trips/packingList";

/**
 * Story 16.2 (FR59). What the day needs: the packing items linked to this day, in the day view's side
 * column. Information only - no checkbox; a packed item (on the trip list) shows a check mark so a
 * missing one stands out. Planners add an item of the trip list, or a new one, and remove an item from
 * the day (the item stays on the trip list).
 *
 * The section owns its fetch of the whole trip list (`GET /packing-items`, viewers included): the picker
 * needs every item anyway, and the day view's own load stays as it is. The API's 403 is the protection;
 * `canEdit` only hides what would be refused.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type CreateOption = { kind: "create"; name: string };
type PickerOption = PackingItemWire | CreateOption;

const isCreateOption = (option: PickerOption | string): option is CreateOption =>
  typeof option !== "string" && "kind" in option && option.kind === "create";

const TOUCH_TARGET_PX = 44;

const substringFilter = createFilterOptions<PackingItemWire>({
  stringify: (option) => option.name,
  ignoreCase: true,
  ignoreAccents: false,
  matchFrom: "any",
});

type TripDayPackingSectionProps = {
  tripId: string;
  dayId: string;
  canEdit: boolean;
  /** Story 16.4. Bumped by the day view after an undo in the AI-changes notice: read the items again. */
  refreshKey?: number;
};

export default function TripDayPackingSection({ tripId, dayId, canEdit, refreshKey = 0 }: TripDayPackingSectionProps) {
  const { t, language } = useI18n();
  const { tokens } = useTheme().palette;
  const locale = INTL_LOCALES[language];

  const [items, setItems] = useState<PackingItemWire[]>([]);
  // The day the list was last loaded for: loading until it equals this day (no reset inside the effect).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // An add/remove error belongs to the day it was made on; it is not shown on another day.
  const [actionError, setActionError] = useState<{ day: string; message: string } | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  // Rows whose remove request is running: their button is disabled, so a double click sends one request.
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());

  // The day the picker was opened for: it is closed on any other day (navigation keeps us mounted).
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [createName, setCreateName] = useState<string | null>(null);
  const [createCategory, setCreateCategory] = useState("");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // The day a request was sent for; an answer arriving after navigating to another day is dropped.
  const activeDay = useRef(dayId);
  useEffect(() => {
    activeDay.current = dayId;
  }, [dayId]);

  const resolveApiError = useCallback((code?: string) => packingApiErrorMessage(t, code), [t]);

  // Re-fetched on every day: prev/next navigation keeps this component mounted. Story 16.4: and on every
  // `refreshKey` bump; the cleanup drops an answer for a day the user has left.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/trips/${tripId}/packing-items`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const body = (await response.json()) as ApiEnvelope<{ items: PackingItemWire[] }>;
        if (!active) return;
        setActionError(null);
        if (!response.ok || body.error || !body.data) {
          setItems([]);
          setLoadError(t("trips.packingList.dayLoadError"));
        } else {
          setItems(body.data.items);
          setLoadError(null);
        }
      } catch {
        if (active) {
          setItems([]);
          setLoadError(t("trips.packingList.dayLoadError"));
        }
      } finally {
        if (active) setLoadedFor(dayId);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [t, tripId, dayId, refreshKey]);

  const ensureCsrfToken = useCallback(async () => {
    if (csrfToken) return csrfToken;
    const response = await fetch("/api/auth/csrf", { method: "GET", credentials: "include", cache: "no-store" });
    const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
    if (!response.ok || body.error || !body.data?.csrfToken) {
      throw new Error("csrf");
    }
    setCsrfToken(body.data.csrfToken);
    return body.data.csrfToken;
  }, [csrfToken]);

  const send = useCallback(
    async <T,>(method: "POST" | "DELETE", payload: unknown) => {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/packing-items/day-links`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": token },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as ApiEnvelope<T>;
      return { response, body };
    },
    [ensureCsrfToken, tripId],
  );

  const upsertItem = (item: PackingItemWire) =>
    setItems((current) => {
      const index = current.findIndex((entry) => entry.id === item.id);
      if (index === -1) return [...current, item];
      const next = [...current];
      next[index] = item;
      return next;
    });

  const loading = loadedFor !== dayId;
  const isOnDay = useCallback((item: PackingItemWire) => item.days.some((day) => day.id === dayId), [dayId]);
  const dayItems = useMemo(() => items.filter(isOnDay), [items, isOnDay]);
  const groups = useMemo(() => groupPackingItems(dayItems, t("trips.packingList.other"), locale), [dayItems, locale, t]);
  const pickable = useMemo(() => items.filter((item) => !isOnDay(item)), [items, isOnDay]);
  const categoryOptions = usePackingCategoryOptions(items);

  const inputKey = packingNameKey(input);
  const exactMatch = inputKey ? items.find((item) => packingNameKey(item.name) === inputKey) ?? null : null;
  const exactMatchLinked = exactMatch !== null && isOnDay(exactMatch);

  const pickerOpen = pickerFor === dayId;

  const openPicker = () => {
    setPickerFor(dayId);
    setInput("");
    setCreateName(null);
    setCreateCategory("");
    setPickerError(null);
  };

  const closePicker = () => {
    if (pickerBusy) return;
    setPickerFor(null);
  };

  /**
   * One add: links the item or adds the name; closes the picker on success. The answered item is the
   * trip's (all its days), so it is kept even when the person has moved to another day meanwhile.
   */
  const addToDay = async (payload: { itemId: string } | { name: string; category: string | null }) => {
    const requestedDay = dayId;
    setPickerBusy(true);
    setPickerError(null);
    try {
      const { response, body } = await send<{ item: PackingItemWire; created: boolean }>("POST", {
        tripDayId: requestedDay,
        ...payload,
      });
      if (!response.ok || body.error || !body.data) {
        if (activeDay.current === requestedDay) setPickerError(resolveApiError(body.error?.code));
        return;
      }
      upsertItem(body.data.item);
      setPickerFor((current) => (current === requestedDay ? null : current));
    } catch {
      if (activeDay.current === requestedDay) setPickerError(t("trips.packingList.saveError"));
    } finally {
      setPickerBusy(false);
    }
  };

  /** A picked option, or Enter on typed text (`freeSolo` hands it over as a string). */
  const handlePick = (_event: SyntheticEvent, value: PickerOption | string | null) => {
    if (value === null || pickerBusy) return;
    if (isCreateOption(value)) {
      setCreateName(value.name);
      return;
    }
    if (typeof value !== "string") {
      void addToDay({ itemId: value.id });
      return;
    }
    const key = packingNameKey(value);
    if (!key) return;
    const match = items.find((item) => packingNameKey(item.name) === key);
    if (!match) {
      setCreateName(value.trim());
      return;
    }
    // Typing a name the trip already has links that item; one already on the day is left alone.
    if (!isOnDay(match)) void addToDay({ itemId: match.id });
  };

  const handleCreate = () => {
    if (createName === null) return;
    void addToDay({ name: createName, category: createCategory.trim() || null });
  };

  const handleRemove = async (item: PackingItemWire) => {
    if (removing.has(item.id)) return;
    const requestedDay = dayId;
    const removedLink = item.days.find((day) => day.id === requestedDay);
    setActionError(null);
    setRemoving((current) => new Set(current).add(item.id));
    // Optimistic: the row leaves at once and comes back if the server refuses.
    upsertItem({ ...item, days: item.days.filter((day) => day.id !== requestedDay) });
    // Puts back only this day's link, so an update of the item answered meanwhile is kept.
    const restore = () => {
      if (!removedLink) return;
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id && !entry.days.some((day) => day.id === requestedDay)
            ? { ...entry, days: [...entry.days, removedLink].sort((a, b) => a.dayIndex - b.dayIndex) }
            : entry,
        ),
      );
    };
    const fail = (message: string) => {
      restore();
      if (activeDay.current === requestedDay) setActionError({ day: requestedDay, message });
    };
    try {
      const { response, body } = await send<{ item: PackingItemWire }>("DELETE", { tripDayId: requestedDay, itemId: item.id });
      if (response.status === 404) {
        // The link is gone either way: the item was deleted from the trip list (DW-433), or the day
        // (re-dated trip) or the trip itself is gone. A deleted item also leaves the local list.
        if (body.error?.message === "Packing item not found") {
          setItems((current) => current.filter((entry) => entry.id !== item.id));
        }
      } else if (!response.ok || body.error || !body.data) {
        fail(resolveApiError(body.error?.code));
      } else {
        upsertItem(body.data.item);
      }
    } catch {
      fail(t("trips.packingList.saveError"));
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  if (!canEdit && (loading || loadError || dayItems.length === 0)) {
    return null;
  }

  const cardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "18px",
  } as const;

  const showList = !loading && !loadError && dayItems.length > 0;

  return (
    <Box sx={{ ...cardSx, minWidth: 0 }} data-testid="day-packing-section">
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, minWidth: 0 }}>
        {/* h6, as the side column's other card labels; labelCaps needs the explicit component. */}
        <Typography variant="labelCaps" component="h6" sx={{ color: tokens.inkSoft, display: "block" }}>
          {t("trips.packingList.dayTitle")}
        </Typography>
        {/* Loading or failed: the heading alone (no greyed button that would jump in later). */}
        {canEdit && !loading && !loadError && (
          <IconButton
            onClick={openPicker}
            aria-label={t("trips.packingList.dayAddAria")}
            title={t("trips.packingList.dayAdd")}
            sx={{ width: TOUCH_TARGET_PX, height: TOUCH_TARGET_PX, my: -1.25, mr: -1.25, color: tokens.inkSoft }}
          >
            <PlusIcon />
          </IconButton>
        )}
      </Box>

      {loadError && (
        <Alert severity="error" sx={{ mt: 1.25 }}>
          {loadError}
        </Alert>
      )}
      {actionError?.day === dayId && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mt: 1.25 }}>
          {actionError.message}
        </Alert>
      )}

      {showList &&
        groups.map((group) => (
          <Box key={group.key === null ? "none" : `category:${group.key}`} component="section" sx={{ mt: 1.25, minWidth: 0 }}>
            <Typography
              variant="labelCaps"
              component="p"
              sx={{ color: tokens.inkSoft, display: "block", fontSize: "10px" }}
              data-testid="day-packing-group"
            >
              {group.label}
            </Typography>
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, "& > li:last-child": { borderBottom: "none" } }}>
              {group.items.map((item) => (
                <Box
                  component="li"
                  key={item.id}
                  data-testid="day-packing-row"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    minHeight: TOUCH_TARGET_PX,
                    minWidth: 0,
                    borderBottom: "1px solid",
                    borderColor: tokens.border,
                  }}
                >
                  {/* A fixed slot, so names align whether packed or not. */}
                  <Box
                    sx={{
                      width: 24,
                      flex: "0 0 auto",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: tokens.inkSoft,
                    }}
                  >
                    {item.packed && (
                      <Box component="span" role="img" aria-label={t("trips.packingList.packedMark")} sx={{ display: "inline-flex" }}>
                        <CheckIcon sx={{ fontSize: 18 }} />
                      </Box>
                    )}
                  </Box>
                  <Typography
                    sx={{ flex: "1 1 auto", minWidth: 0, fontSize: "12.5px", fontWeight: 600, color: tokens.ink, overflowWrap: "anywhere" }}
                  >
                    {item.name}
                  </Typography>
                  {item.aiChangedAt && <AiBadge />}
                  {canEdit && (
                    <IconButton
                      onClick={() => void handleRemove(item)}
                      disabled={removing.has(item.id)}
                      aria-label={formatMessage(t("trips.packingList.dayRemoveAria"), { name: item.name })}
                      sx={{ width: TOUCH_TARGET_PX, height: TOUCH_TARGET_PX, flex: "0 0 auto", mr: -1.25, color: tokens.inkSoft }}
                    >
                      <CloseXIcon />
                    </IconButton>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        ))}

      {canEdit && (
        <Dialog open={pickerOpen} onClose={closePicker} fullWidth maxWidth="xs">
          <DialogTitleWithClose label={t("common.close")} onClose={closePicker} disabled={pickerBusy}>
            {t("trips.packingList.dayPickerTitle")}
          </DialogTitleWithClose>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2} sx={{ pt: 1 }}>
              {pickerError && (
                <Alert severity="error" data-testid="day-packing-picker-error">
                  {pickerError}
                </Alert>
              )}
              {createName === null ? (
                <Autocomplete<PickerOption, false, false, true>
                  freeSolo
                  openOnFocus
                  options={pickable}
                  value={null}
                  inputValue={input}
                  onInputChange={(_event, value, reason) => {
                    // A pick resets the input to the option's label; keep what was typed instead.
                    if (reason !== "reset") setInput(value);
                  }}
                  onChange={handlePick}
                  disabled={pickerBusy}
                  filterOptions={(options, state) => {
                    const filtered: PickerOption[] = substringFilter(options as PackingItemWire[], state);
                    const trimmed = state.inputValue.trim();
                    if (trimmed && !exactMatch) {
                      filtered.push({ kind: "create", name: trimmed });
                    }
                    return filtered;
                  }}
                  getOptionLabel={(option) =>
                    typeof option === "string"
                      ? option
                      : isCreateOption(option)
                        ? formatMessage(t("trips.packingList.dayCreateOption"), { name: option.name })
                        : option.name
                  }
                  renderOption={(props, option) => {
                    const { key, ...rest } = props as typeof props & { key: string };
                    if (isCreateOption(option)) {
                      return (
                        <li key={key} {...rest}>
                          {formatMessage(t("trips.packingList.dayCreateOption"), { name: option.name })}
                        </li>
                      );
                    }
                    return (
                      <li key={key} {...rest}>
                        <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span>{option.name}</span>
                          {option.category && (
                            <Typography component="span" variant="body2" sx={{ color: tokens.inkSoft }}>
                              {option.category}
                            </Typography>
                          )}
                        </Box>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      autoFocus
                      label={t("trips.packingList.dayPickerLabel")}
                      size="small"
                      helperText={exactMatchLinked ? t("trips.packingList.dayAlreadyLinked") : undefined}
                      slotProps={{ htmlInput: { ...params.inputProps, maxLength: PACKING_ITEM_NAME_MAX } }}
                    />
                  )}
                />
              ) : (
                <>
                  <Typography sx={{ color: tokens.ink, fontWeight: 600, overflowWrap: "anywhere" }} data-testid="day-packing-create-name">
                    {createName}
                  </Typography>
                  <Autocomplete
                    freeSolo
                    options={categoryOptions}
                    inputValue={createCategory}
                    onInputChange={(_event, value) => setCreateCategory(value)}
                    disabled={pickerBusy}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        autoFocus
                        label={t("trips.packingList.categoryLabel")}
                        size="small"
                        slotProps={{ htmlInput: { ...params.inputProps, maxLength: PACKING_CATEGORY_MAX } }}
                      />
                    )}
                  />
                </>
              )}
            </Box>
          </DialogContent>
          {createName !== null && (
            <DialogActions>
              <Button variant="contained" onClick={handleCreate} disabled={pickerBusy} sx={{ minHeight: TOUCH_TARGET_PX }}>
                {pickerBusy ? <CircularProgress size={22} /> : t("trips.packingList.dayCreate")}
              </Button>
            </DialogActions>
          )}
        </Dialog>
      )}
    </Box>
  );
}
