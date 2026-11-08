"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  IconButton,
  Skeleton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import { formatMessage, INTL_LOCALES } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import AiBadge from "@/components/ui/AiBadge";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import { CheckIcon, PencilIcon } from "@/components/features/trips/TripIcons";
import { formatShortDate } from "@/lib/trips/formatShortDate";
import { canTripAccessRoleWrite, type TripAccessRole } from "@/lib/auth/tripAccessRole";
import {
  groupPackingItems,
  normalizePackingCategory,
  PACKING_CATEGORY_MAX,
  PACKING_ITEM_NAME_MAX,
  resolvePackingCategorySelection,
  suggestedPackingCategories,
} from "@/lib/trips/packingList";

/**
 * Story 16.1 (FR58). The trip's packing list page: one shared list, grouped by category, that planners
 * extend and tick off and viewers read. Built for packing with the phone in one hand: the add row at the
 * top, big rows, the checkbox on the left, 44px targets.
 *
 * The edit controls come from `accessRole` in the GET answer; the API's 403 is the protection, this only
 * hides what would be refused.
 */

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export type PackingItemWire = {
  id: string;
  name: string;
  category: string | null;
  packed: boolean;
  dayCount: number;
  /** Story 16.2. The linked days, ascending by `dayIndex`; `date` is the stored UTC-midnight ISO string. */
  days: { id: string; dayIndex: number; date: string }[];
  aiChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Filter = "all" | "open";

/** The viewer's filter choice, remembered per browser. Every access is guarded: storage may throw. */
export const PACKING_FILTER_STORAGE_KEY = "travelplan.packingList.filter";

const readStoredFilter = (): Filter => {
  try {
    return window.localStorage.getItem(PACKING_FILTER_STORAGE_KEY) === "open" ? "open" : "all";
  } catch {
    return "all";
  }
};

const storeFilter = (filter: Filter) => {
  try {
    window.localStorage.setItem(PACKING_FILTER_STORAGE_KEY, filter);
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
};

/**
 * Story 16.6. The viewer's category selection, remembered per browser and per trip (each trip has its own
 * categories): a JSON array of group keys, `null` standing for the "Other" group. Guarded like the filter.
 */
export const packingCategoryStorageKey = (tripId: string) => `travelplan.packingList.categories.${tripId}`;

const readStoredCategories = (tripId: string): (string | null)[] => {
  try {
    const raw = window.localStorage.getItem(packingCategoryStorageKey(tripId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string | null => entry === null || typeof entry === "string");
  } catch {
    return [];
  }
};

const storeCategories = (tripId: string, keys: readonly (string | null)[]) => {
  try {
    window.localStorage.setItem(packingCategoryStorageKey(tripId), JSON.stringify(keys));
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
};

/** The group key an item falls under: the same folding as `groupPackingItems`. */
const packingGroupKey = (category: string | null) => normalizePackingCategory(category)?.toLowerCase() ?? null;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const HIGHLIGHT_MS = 2000;
const TOUCH_TARGET_PX = 44;

/** The packing API's error codes as messages; shared by this page and the day section (Story 16.2). */
export const packingApiErrorMessage = (t: (key: string) => string, code?: string) => {
  switch (code) {
    case "unauthorized":
      return t("errors.unauthorized");
    case "csrf_invalid":
      return t("errors.csrfInvalid");
    case "server_error":
      return t("errors.server");
    case "invalid_json":
      return t("errors.invalidJson");
    case "forbidden":
      return t("trips.packingList.forbidden");
    case "duplicate_name":
      return t("trips.packingList.duplicateName");
    default:
      return t("trips.packingList.saveError");
  }
};

/**
 * The category suggestions of the add and edit fields: the defaults in the UI language plus the trip's
 * own categories. Shared with the day section (Story 16.2), so both offer the same list.
 */
export const usePackingCategoryOptions = (items: readonly Pick<PackingItemWire, "category">[]) => {
  const { t, language } = useI18n();
  const locale = INTL_LOCALES[language];
  return useMemo(
    () =>
      suggestedPackingCategories(
        [
          t("trips.packingList.suggest.clothing"),
          t("trips.packingList.suggest.electronics"),
          t("trips.packingList.suggest.toiletries"),
          t("trips.packingList.suggest.documents"),
          t("trips.packingList.suggest.medication"),
          t("trips.packingList.other"),
        ],
        items.map((item) => item.category),
        locale,
      ),
    [items, locale, t],
  );
};

type TripPackingListProps = {
  tripId: string;
};

export default function TripPackingList({ tripId }: TripPackingListProps) {
  const { t, language } = useI18n();
  const { tokens } = useTheme().palette;
  const locale = INTL_LOCALES[language];

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState<PackingItemWire[]>([]);
  const [accessRole, setAccessRole] = useState<TripAccessRole | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // Story 16.6. What the viewer chose (may hold vanished categories, kept so they apply again if they come
  // back) and the items shown outside the selection for now (added or recategorized there; session only).
  const [storedSelection, setStoredSelection] = useState<(string | null)[]>([]);
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set());
  // The trip whose remembered selection was last restored (reveals reset, add form prefilled).
  const restoredForTrip = useRef<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The nonce restarts the scroll + 2 s highlight when the same item is reported again.
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  const highlightId = highlight?.id ?? null;

  const [editTarget, setEditTarget] = useState<PackingItemWire | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<PackingItemWire | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  // Per-item sequence of tick requests: only the latest one's answer (or failure) touches the row.
  const toggleSeq = useRef(new Map<string, number>());

  const canEdit = canTripAccessRoleWrite(accessRole);

  const resolveApiError = useCallback((code?: string) => packingApiErrorMessage(t, code), [t]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/trips/${tripId}/packing-items`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const body = (await response.json()) as ApiEnvelope<{ accessRole: TripAccessRole; items: PackingItemWire[] }>;
        if (!active) return;
        if (response.status === 404) {
          setNotFound(true);
        } else if (!response.ok || body.error || !body.data) {
          setLoadError(t("trips.packingList.loadError"));
        } else {
          setItems(body.data.items);
          setAccessRole(body.data.accessRole);
          // The remembered filter is read here, after mount and never during render, so the server HTML
          // and the first client render agree (the list is only shown once this has run).
          setFilter(readStoredFilter());
          const stored = readStoredCategories(tripId);
          setStoredSelection(stored);
          // The effect also re-runs on a language switch (`t`); the reveals and the prefill belong to the
          // trip's first load only, so a reload never drops a reveal or overwrites what the person typed.
          if (restoredForTrip.current !== tripId) {
            restoredForTrip.current = tripId;
            setRevealedIds(new Set());
            // Prefill here and in the chip handlers, never in an effect over the selection: an effect
            // would overwrite what the person typed whenever the list changes. The group is looked up by
            // key, and a real category's label is its first spelling met, so neither the locale (it only
            // affects the order) nor the "Other" label (Other prefills empty) matters here.
            const loadedGroups = groupPackingItems(body.data.items, "", "en");
            const restored = resolvePackingCategorySelection(
              stored,
              loadedGroups.map((group) => group.key),
            );
            if (restored.length === 1) {
              const only = loadedGroups.find((group) => group.key === restored[0]);
              setCategory(only && only.key !== null ? only.label : "");
            }
          }
        }
      } catch {
        if (active) setLoadError(t("trips.packingList.loadError"));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [t, tripId]);

  // Scroll the highlighted row into view, then drop the highlight after ~2 s.
  useEffect(() => {
    if (!highlight) return;
    const row = rowRefs.current.get(highlight.id);
    row?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlight]);

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

  /** One write: answers the envelope and the status, or throws on a network or CSRF failure. */
  const send = useCallback(
    async <T,>(method: "POST" | "PATCH" | "DELETE", payload: unknown) => {
      const token = await ensureCsrfToken();
      const response = await fetch(`/api/trips/${tripId}/packing-items`, {
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

  const categoryOptions = usePackingCategoryOptions(items);

  const groups = useMemo(() => groupPackingItems(items, t("trips.packingList.other"), locale), [items, locale, t]);
  const packedCount = items.filter((item) => item.packed).length;
  const selection = useMemo(
    () => resolvePackingCategorySelection(storedSelection, groups.map((group) => group.key)),
    [groups, storedSelection],
  );
  const selectedGroups = groups.filter((group) => selection.includes(group.key));
  const visibleGroups = groups
    .map((group) => {
      const inSelection =
        selection.length === 0 || selection.includes(group.key)
          ? group.items
          : group.items.filter((item) => revealedIds.has(item.id));
      return { ...group, visible: filter === "open" ? inSelection.filter((item) => !item.packed) : inSelection };
    })
    .filter((group) => group.visible.length > 0);

  const changeFilter = (next: Filter) => {
    setFilter(next);
    storeFilter(next);
  };

  /** Story 16.6. Stores a chip change, ends any reveal, and prefills the add form for a single category. */
  const changeSelection = (next: (string | null)[]) => {
    setStoredSelection(next);
    storeCategories(tripId, next);
    setRevealedIds(new Set());
    if (next.length === 1) {
      const only = groups.find((group) => group.key === next[0]);
      setCategory(only && only.key !== null ? only.label : "");
    }
  };

  const toggleCategory = (key: string | null) =>
    changeSelection(
      selection.includes(key)
        ? selection.filter((entry) => entry !== key)
        : groups.map((group) => group.key).filter((entry) => entry === key || selection.includes(entry)),
    );

  /**
   * Keeps an item that landed outside the selection visible for now, without touching the stored choice.
   * Decided against the stored choice, not the effective one: the save itself can change the groups (a
   * second group makes a dormant stored choice apply again), so the effective selection from before the
   * request is stale. A reveal while nothing is filtered is harmless.
   */
  const revealIfOutsideSelection = (item: PackingItemWire) => {
    if (storedSelection.length === 0) return;
    const wanted = storedSelection.map((key) => (key === null ? null : key.toLowerCase()));
    if (wanted.includes(packingGroupKey(item.category))) return;
    setRevealedIds((current) => new Set(current).add(item.id));
  };

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || addBusy) return;
    setAddBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      const { response, body } = await send<{ item: PackingItemWire; existed: boolean }>("POST", {
        name: trimmed,
        category: category.trim() || null,
      });
      if (!response.ok || body.error || !body.data) {
        setActionError(resolveApiError(body.error?.code));
        return;
      }
      const { item, existed } = body.data;
      setName("");
      // Upsert in both cases: an "existed" item may have been added by someone else after this page loaded.
      upsertItem(item);
      revealIfOutsideSelection(item);
      if (existed) {
        // Show the hidden packed item for now, without overwriting the viewer's remembered filter.
        if (item.packed && filter === "open") setFilter("all");
        setNotice(formatMessage(t("trips.packingList.alreadyOnList"), { name: item.name }));
        setHighlight((current) => ({ id: item.id, nonce: (current?.nonce ?? 0) + 1 }));
      }
    } catch {
      setActionError(t("trips.packingList.saveError"));
    } finally {
      setAddBusy(false);
      nameInputRef.current?.focus();
    }
  };

  /** Sets only `packed` on the current row, so a rename saved meanwhile is not overwritten. */
  const setPacked = (itemId: string, packed: boolean) =>
    setItems((current) => current.map((entry) => (entry.id === itemId ? { ...entry, packed } : entry)));

  const handleToggle = async (item: PackingItemWire) => {
    const nextPacked = !item.packed;
    const seq = (toggleSeq.current.get(item.id) ?? 0) + 1;
    toggleSeq.current.set(item.id, seq);
    const isLatest = () => toggleSeq.current.get(item.id) === seq;
    setActionError(null);
    setPacked(item.id, nextPacked);
    try {
      const { response, body } = await send<{ item: PackingItemWire }>("PATCH", { itemId: item.id, packed: nextPacked });
      if (!isLatest()) return;
      if (!response.ok || body.error || !body.data) {
        setPacked(item.id, item.packed);
        setActionError(resolveApiError(body.error?.code));
        return;
      }
      upsertItem(body.data.item);
      // Someone else may have moved the item out of the selection meanwhile; keep the tapped row visible.
      revealIfOutsideSelection(body.data.item);
    } catch {
      if (!isLatest()) return;
      setPacked(item.id, item.packed);
      setActionError(t("trips.packingList.saveError"));
    }
  };

  const openEdit = (item: PackingItemWire) => {
    setEditTarget(item);
    setEditName(item.name);
    setEditCategory(item.category ?? "");
    setEditError(null);
  };

  const closeEdit = () => {
    if (editBusy) return;
    setEditTarget(null);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const { response, body } = await send<{ item: PackingItemWire }>("PATCH", {
        itemId: editTarget.id,
        name: trimmed,
        category: editCategory.trim() || null,
      });
      if (!response.ok || body.error || !body.data) {
        setEditError(resolveApiError(body.error?.code));
        return;
      }
      upsertItem(body.data.item);
      revealIfOutsideSelection(body.data.item);
      setEditTarget(null);
    } catch {
      setEditError(t("trips.packingList.saveError"));
    } finally {
      setEditBusy(false);
    }
  };

  /**
   * Deletes with the day count the person confirmed (0 when no confirmation was shown). Answers `null`
   * when it worked, the fresh item when the server says the day links changed meanwhile (Story 16.2,
   * DW-432 - the caller then asks with the fresh count), or the error text.
   */
  const deleteItem = async (
    item: PackingItemWire,
  ): Promise<{ error: string } | { daysChanged: PackingItemWire } | null> => {
    try {
      const { response, body } = await send<{ deleted: boolean }>("DELETE", {
        itemId: item.id,
        confirmedDayCount: item.dayCount,
      });
      if (response.status === 409 && body.error?.code === "days_changed") {
        const details = body.error.details as { dayCount?: unknown } | undefined;
        const dayCount = typeof details?.dayCount === "number" ? details.dayCount : item.dayCount;
        // Only the count is fresh; the linked days line catches up on the next load.
        const fresh = { ...item, dayCount };
        setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, dayCount } : entry)));
        return { daysChanged: fresh };
      }
      if (!response.ok || body.error) return { error: resolveApiError(body.error?.code) };
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      return null;
    } catch {
      return { error: t("trips.packingList.saveError") };
    }
  };

  const handleDeleteFromEdit = async () => {
    if (!editTarget) return;
    if (editTarget.dayCount > 0) {
      setDeleteError(null);
      setDeleteTarget(editTarget);
      return;
    }
    setEditBusy(true);
    const result = await deleteItem(editTarget);
    setEditBusy(false);
    if (result === null) setEditTarget(null);
    else if ("error" in result) setEditError(result.error);
    else {
      // Linked to a day since the page loaded: ask with the fresh count.
      setDeleteError(null);
      setDeleteTarget(result.daysChanged);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const result = await deleteItem(deleteTarget);
    setDeleteBusy(false);
    if (result === null) {
      setDeleteTarget(null);
      setEditTarget(null);
    } else if ("error" in result) {
      setDeleteError(result.error);
    } else {
      // The confirmation text now shows the fresh count; the next confirm sends it.
      setDeleteTarget(result.daysChanged);
    }
  };

  const cardSx = {
    backgroundColor: tokens.card,
    border: "1px solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    padding: "18px",
  } as const;

  const title = (
    // component= is mandatory: labelCaps has no variantMapping entry. h1: the card label is this
    // screen's only heading, as on the cost overview.
    <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft, display: "block" }}>
      {t("trips.packingList.title")}
    </Typography>
  );

  if (loading) {
    return (
      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          {title}
          <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
            {t("trips.packingList.loading")}
          </Typography>
          <Skeleton variant="rectangular" width="100%" height={120} />
        </Box>
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box sx={cardSx}>
        <Box display="flex" flexDirection="column" gap={2}>
          <Typography variant="heading" component="h1" sx={{ color: tokens.ink }}>
            {t("trips.detail.notFoundTitle")}
          </Typography>
          <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
            {t("trips.detail.notFoundBody")}
          </Typography>
        </Box>
      </Box>
    );
  }

  const deleteDaysText = (count: number) =>
    count === 1
      ? t("trips.packingList.deleteDaysOne")
      : formatMessage(t("trips.packingList.deleteDays"), { count });

  return (
    <Box sx={{ ...cardSx, minWidth: 0 }} data-testid="packing-list-card">
      <Box display="flex" flexDirection="column" gap={2} sx={{ minWidth: 0 }}>
        <Box display="flex" flexDirection="column" gap={0.5}>
          {title}
          {!loadError && (
            <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-progress">
              {formatMessage(t("trips.packingList.progress"), { packed: packedCount, total: items.length })}
            </Typography>
          )}
          {!loadError && selection.length > 0 && (
            <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-selection-progress">
              {formatMessage(t("trips.packingList.selectionProgress"), {
                packed: selectedGroups.reduce((sum, group) => sum + group.packed, 0),
                total: selectedGroups.reduce((sum, group) => sum + group.total, 0),
              })}
            </Typography>
          )}
        </Box>

        {loadError && <Alert severity="error">{loadError}</Alert>}

        {!loadError && canEdit && (
          <Box
            component="form"
            onSubmit={handleAdd}
            sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "flex-start", minWidth: 0 }}
          >
            <TextField
              inputRef={nameInputRef}
              label={t("trips.packingList.nameLabel")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              size="small"
              slotProps={{ htmlInput: { maxLength: PACKING_ITEM_NAME_MAX } }}
              sx={{ flex: "1 1 180px", minWidth: 0 }}
            />
            <Autocomplete
              freeSolo
              options={categoryOptions}
              inputValue={category}
              onInputChange={(_event, value) => setCategory(value)}
              sx={{ flex: "1 1 160px", minWidth: 0 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t("trips.packingList.categoryLabel")}
                  size="small"
                  slotProps={{ htmlInput: { ...params.inputProps, maxLength: PACKING_CATEGORY_MAX } }}
                />
              )}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={addBusy || name.trim().length === 0}
              sx={{ minHeight: TOUCH_TARGET_PX, flex: "0 0 auto" }}
            >
              {t("trips.packingList.add")}
            </Button>
          </Box>
        )}

        {notice && (
          <Alert severity="info" onClose={() => setNotice(null)} data-testid="packing-notice">
            {notice}
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}

        {!loadError && items.length > 0 && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={filter}
            onChange={(_event, value: Filter | null) => {
              if (value) changeFilter(value);
            }}
            aria-label={t("trips.packingList.filterLabel")}
            sx={{ alignSelf: "flex-start" }}
          >
            <ToggleButton value="all" sx={{ minHeight: TOUCH_TARGET_PX, px: 2 }}>
              {t("trips.packingList.filterAll")}
            </ToggleButton>
            <ToggleButton value="open" sx={{ minHeight: TOUCH_TARGET_PX, px: 2 }}>
              {t("trips.packingList.filterOpen")}
            </ToggleButton>
          </ToggleButtonGroup>
        )}

        {/* Story 16.6: one chip per group, same order and labels as the list; scrolls instead of wrapping. */}
        {!loadError && groups.length >= 2 && (
          <Box
            role="group"
            aria-label={t("trips.packingList.categoryFilterLabel")}
            data-testid="packing-category-chips"
            sx={{
              display: "flex",
              flexWrap: "nowrap",
              gap: 1,
              overflowX: "auto",
              minWidth: 0,
              maxWidth: "100%",
              pb: 0.5,
            }}
          >
            {[
              { reactKey: "all", label: t("trips.packingList.allCategories"), selected: selection.length === 0, onClick: () => changeSelection([]) },
              ...groups.map((group) => ({
                reactKey: group.key === null ? "none" : `category:${group.key}`,
                label: group.label,
                selected: selection.includes(group.key),
                onClick: () => toggleCategory(group.key),
              })),
            ].map((chip) => (
              <Chip
                key={chip.reactKey}
                label={chip.label}
                clickable
                onClick={chip.onClick}
                aria-pressed={chip.selected}
                variant={chip.selected ? "filled" : "outlined"}
                color={chip.selected ? "primary" : "default"}
                sx={{
                  height: TOUCH_TARGET_PX,
                  flex: "0 0 auto",
                  borderRadius: "22px",
                  "& .MuiChip-label": { whiteSpace: "nowrap" },
                }}
              />
            ))}
          </Box>
        )}

        {!loadError && items.length === 0 && (
          <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-empty">
            {t("trips.packingList.empty")}
          </Typography>
        )}

        {!loadError && items.length > 0 && visibleGroups.length === 0 && (
          <Typography variant="body2" sx={{ color: tokens.inkSoft }}>
            {selection.length > 0 ? t("trips.packingList.allPackedSelection") : t("trips.packingList.allPacked")}
          </Typography>
        )}

        {visibleGroups.map((group, groupIndex) => (
          <Box key={group.key === null ? "none" : `category:${group.key}`} component="section" sx={{ minWidth: 0 }}>
            {groupIndex > 0 && <Divider sx={{ borderColor: tokens.border, mb: 1.5 }} />}
            <Typography
              variant="labelCaps"
              component="h2"
              sx={{ color: tokens.inkSoft, display: "block", mb: 0.5 }}
              data-testid="packing-group-heading"
            >
              {formatMessage(t("trips.packingList.groupCount"), {
                category: group.label,
                packed: group.packed,
                total: group.total,
              })}
            </Typography>
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {group.visible.map((item) => {
                const highlighted = highlightId === item.id;
                return (
                  <Box
                    component="li"
                    key={item.id}
                    ref={(node: HTMLElement | null) => {
                      if (node) rowRefs.current.set(item.id, node);
                      else rowRefs.current.delete(item.id);
                    }}
                    data-testid="packing-row"
                    data-highlighted={highlighted ? "true" : undefined}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      minHeight: TOUCH_TARGET_PX,
                      minWidth: 0,
                      borderRadius: "6px",
                      backgroundColor: highlighted ? tokens.warnBg : "transparent",
                      transition: "background-color 300ms",
                      "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                    }}
                  >
                    {canEdit ? (
                      <Checkbox
                        checked={item.packed}
                        onChange={() => void handleToggle(item)}
                        slotProps={{
                          input: {
                            "aria-label": formatMessage(t("trips.packingList.toggleAria"), { name: item.name }),
                          },
                        }}
                        sx={{ width: TOUCH_TARGET_PX, height: TOUCH_TARGET_PX, flex: "0 0 auto" }}
                      />
                    ) : (
                      <Box
                        sx={{
                          width: TOUCH_TARGET_PX,
                          height: TOUCH_TARGET_PX,
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
                    )}
                    <Box sx={{ flex: "1 1 auto", minWidth: 0 }}>
                      <Typography
                        variant="body1"
                        sx={{
                          overflowWrap: "anywhere",
                          color: item.packed ? tokens.inkSoft : tokens.ink,
                          textDecoration: item.packed ? "line-through" : "none",
                        }}
                      >
                        {item.name}
                      </Typography>
                      {/* Story 16.2: the days the item is linked to, as short dates (UTC, ascending). */}
                      {item.days.length > 0 && (
                        <Typography
                          variant="body2"
                          sx={{ color: tokens.inkSoft, overflowWrap: "anywhere" }}
                          data-testid="packing-row-days"
                        >
                          {item.days
                            .map((day) => formatShortDate(day.date, language))
                            .filter((label): label is string => label !== null)
                            .join(" · ")}
                        </Typography>
                      )}
                    </Box>
                    {item.aiChangedAt && <AiBadge />}
                    {canEdit && (
                      <IconButton
                        onClick={() => openEdit(item)}
                        aria-label={formatMessage(t("trips.packingList.editAria"), { name: item.name })}
                        sx={{ width: TOUCH_TARGET_PX, height: TOUCH_TARGET_PX, flex: "0 0 auto", color: tokens.inkSoft }}
                      >
                        <PencilIcon />
                      </IconButton>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>

      <Dialog open={Boolean(editTarget)} onClose={closeEdit} fullWidth maxWidth="xs">
        <DialogTitleWithClose label={t("common.close")} onClose={closeEdit} disabled={editBusy}>
          {t("trips.packingList.editTitle")}
        </DialogTitleWithClose>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} sx={{ pt: 1 }}>
            {editError && (
              <Alert severity="error" data-testid="packing-edit-error">
                {editError}
              </Alert>
            )}
            <TextField
              label={t("trips.packingList.nameLabel")}
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              size="small"
              autoFocus
              slotProps={{ htmlInput: { maxLength: PACKING_ITEM_NAME_MAX } }}
            />
            <Autocomplete
              freeSolo
              options={categoryOptions}
              inputValue={editCategory}
              onInputChange={(_event, value) => setEditCategory(value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t("trips.packingList.categoryLabel")}
                  size="small"
                  slotProps={{ htmlInput: { ...params.inputProps, maxLength: PACKING_CATEGORY_MAX } }}
                />
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          <Button color="error" onClick={() => void handleDeleteFromEdit()} disabled={editBusy} sx={{ minHeight: TOUCH_TARGET_PX }}>
            {t("trips.packingList.delete")}
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={editBusy || editName.trim().length === 0}
            sx={{ minHeight: TOUCH_TARGET_PX }}
          >
            {editBusy ? <CircularProgress size={22} /> : t("trips.packingList.save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleteBusy && setDeleteTarget(null)} fullWidth maxWidth="xs">
        <DialogTitleWithClose label={t("common.close")} onClose={() => setDeleteTarget(null)} disabled={deleteBusy}>
          {t("trips.packingList.deleteTitle")}
        </DialogTitleWithClose>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            {deleteTarget ? deleteDaysText(deleteTarget.dayCount) : null}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy} sx={{ minHeight: TOUCH_TARGET_PX }}>
            {t("trips.packingList.deleteKeep")}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleConfirmDelete()}
            disabled={deleteBusy}
            sx={{ minHeight: TOUCH_TARGET_PX }}
          >
            {deleteBusy ? <CircularProgress size={22} /> : t("trips.packingList.deleteConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
