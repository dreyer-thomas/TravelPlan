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
  Collapse,
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
import AiChangesNotice from "@/components/features/trips/AiChangesNotice";
import { DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PencilIcon } from "@/components/features/trips/TripIcons";
import { formatShortDate } from "@/lib/trips/formatShortDate";
import { canTripAccessRoleWrite, type TripAccessRole } from "@/lib/auth/tripAccessRole";
import {
  PackingNameWithTags,
  PackingTagInput,
  commitPackingTagText,
  samePackingTags,
  usePackingTagOptions,
} from "@/components/features/trips/PackingTags";
import {
  collectPackingTags,
  groupPackingItems,
  itemHasAnyPackingTag,
  normalizePackingCategory,
  PACKING_CATEGORY_MAX,
  PACKING_ITEM_NAME_MAX,
  packingTagKey,
  resolvePackingCategorySelection,
  resolvePackingTagSelection,
  suggestedPackingCategories,
} from "@/lib/trips/packingList";

/**
 * Story 16.1 (FR58). The trip's packing list page: one shared list, grouped by category, that planners
 * extend and tick off and viewers read. Built for packing with the phone in one hand: the add row at the
 * top, big rows, the checkbox on the left, 44px targets.
 *
 * The edit controls come from `accessRole` in the GET answer; the API's 403 is the protection, this only
 * hides what would be refused.
 *
 * Story 16.7: an item can be "not needed this time". Such items leave the category groups and every count
 * and live in their own collapsed section after the last group (hidden by "Noch offen", filtered by the
 * category chips), greyed and without a checkbox; writers mark them needed again from there. Marking an
 * item linked to days not needed asks first and sends the confirmed day count (DW-432 pattern).
 *
 * Story 16.8: items carry free tags, shown as chips after the name; planners set them in the add form and
 * the edit dialog (`PackingTags.tsx`). A second chip row filters by tag: any selected tag (OR), combined with
 * the category selection and "Noch offen" by AND; remembered per trip like the categories. Group heading
 * counts keep counting the whole category (D6); the selection progress line counts the filtered view.
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
  /** Story 16.7. Not needed this time: then never packed and never linked to a day. */
  notNeeded: boolean;
  /** Story 16.8. The item's tags (tag-key order; shown alphabetically). */
  tags: string[];
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

/**
 * Story 16.8. The viewer's tag selection, remembered per browser and per trip: a JSON array of tag keys.
 * Guarded like the category selection.
 */
export const packingTagStorageKey = (tripId: string) => `travelplan.packingList.tags.${tripId}`;

const readStoredTags = (tripId: string): string[] => {
  try {
    const raw = window.localStorage.getItem(packingTagStorageKey(tripId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
};

const storeTags = (tripId: string, keys: readonly string[]) => {
  try {
    window.localStorage.setItem(packingTagStorageKey(tripId), JSON.stringify(keys));
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
    case "not_needed":
      return t("trips.packingList.notNeededError");
    case "too_many_tags":
      return t("trips.packingList.tooManyTags");
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
  // Story 16.8. The remembered tag selection (tag keys; vanished ones kept, as for categories).
  const [storedTagSelection, setStoredTagSelection] = useState<string[]>([]);
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set());
  // The trip whose remembered selection was last restored (reveals reset, add form prefilled).
  const restoredForTrip = useRef<string | null>(null);
  // Story 16.4. `reloadKey` reads the list again after an undo in the AI-changes notice; `loadCount` counts
  // completed loads and `writeCount` the person's own successful writes; their sum is the notice's
  // `refreshKey`, so it reads its changes again with the list and after every edit here (an edited item's
  // connector change is then shown as no longer undoable, as in the day view).
  const [reloadKey, setReloadKey] = useState(0);
  const [loadCount, setLoadCount] = useState(0);
  const [writeCount, setWriteCount] = useState(0);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  // Story 16.8. The add form's tags and the text typed in the tags field (added on submit).
  const [tags, setTags] = useState<string[]>([]);
  const [tagText, setTagText] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The nonce restarts the scroll + 2 s highlight when the same item is reported again.
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  const highlightId = highlight?.id ?? null;

  const [editTarget, setEditTarget] = useState<PackingItemWire | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagText, setEditTagText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<PackingItemWire | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Story 16.7. The not-needed section's open state (session only), and whether it was opened by an add of
  // a not-needed name: then its body renders without the collapse animation, so the scroll and highlight
  // land on a row at its full height.
  const [notNeededOpen, setNotNeededOpen] = useState(false);
  const [notNeededInstant, setNotNeededInstant] = useState(false);
  const [notNeededTarget, setNotNeededTarget] = useState<PackingItemWire | null>(null);
  const [notNeededBusy, setNotNeededBusy] = useState(false);
  const [notNeededError, setNotNeededError] = useState<string | null>(null);
  const [markNeededBusyId, setMarkNeededBusyId] = useState<string | null>(null);

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
          // A reload after an AI undo may follow a failed one: drop its error.
          setLoadError(null);
          setItems(body.data.items);
          setAccessRole(body.data.accessRole);
          setLoadCount((count) => count + 1);
          // The remembered filter is read here, after mount and never during render, so the server HTML
          // and the first client render agree (the list is only shown once this has run).
          setFilter(readStoredFilter());
          const stored = readStoredCategories(tripId);
          setStoredSelection(stored);
          const storedTags = readStoredTags(tripId);
          setStoredTagSelection(storedTags);
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
            // Story 16.8. The same for one remembered tag: the add form's tags start with it.
            const loadedTags = collectPackingTags(body.data.items);
            const restoredTags = resolvePackingTagSelection(
              storedTags,
              loadedTags.map((chip) => chip.key),
            );
            if (restoredTags.length === 1) {
              const only = loadedTags.find((chip) => chip.key === restoredTags[0]);
              if (only) setTags([only.label]);
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
  }, [t, tripId, reloadKey]);

  const reloadAfterAiUndo = useCallback(() => setReloadKey((key) => key + 1), []);

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
      if (response.ok && !body.error) setWriteCount((count) => count + 1);
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
  const tagOptions = usePackingTagOptions(items);

  // Story 16.7. Three groupings: every item for the chips and the selection (a category that only has
  // not-needed items still gets a chip), the needed items for the list and its counts, and the not-needed
  // items for their own section.
  const chipGroups = useMemo(
    () => groupPackingItems(items, t("trips.packingList.other"), locale),
    [items, locale, t],
  );
  const neededItems = useMemo(() => items.filter((item) => !item.notNeeded), [items]);
  const neededGroups = useMemo(
    () => groupPackingItems(neededItems, t("trips.packingList.other"), locale),
    [neededItems, locale, t],
  );
  const notNeededGroups = useMemo(
    () => groupPackingItems(items.filter((item) => item.notNeeded), t("trips.packingList.other"), locale),
    [items, locale, t],
  );
  const packedCount = neededItems.filter((item) => item.packed).length;
  const selection = useMemo(
    () => resolvePackingCategorySelection(storedSelection, chipGroups.map((group) => group.key)),
    [chipGroups, storedSelection],
  );
  // Story 16.8. The tag chips over every item (needed or not), and the effective tag selection.
  const tagChips = useMemo(() => collectPackingTags(items, locale), [items, locale]);
  const tagSelection = useMemo(
    () => resolvePackingTagSelection(storedTagSelection, tagChips.map((chip) => chip.key)),
    [tagChips, storedTagSelection],
  );
  /** Whether the item matches the selected categories AND any selected tag (no selection matches all). */
  const matchesSelection = (item: PackingItemWire) =>
    (selection.length === 0 || selection.includes(packingGroupKey(item.category))) &&
    itemHasAnyPackingTag(item, tagSelection);
  const selectionActive = selection.length > 0 || tagSelection.length > 0;
  // The selection progress counts needed items only, ignoring reveals.
  const selectedItems = neededItems.filter(matchesSelection);
  const selectedTotal = selectedItems.length;
  const selectedPacked = selectedItems.filter((item) => item.packed).length;
  /** The group's items the selection shows: those matching it, and those revealed for now. */
  const inSelection = <T extends { items: PackingItemWire[] }>(group: T) =>
    group.items.filter((item) => revealedIds.has(item.id) || matchesSelection(item));
  const visibleGroups = neededGroups
    .map((group) => {
      const shown = inSelection(group);
      return { ...group, visible: filter === "open" ? shown.filter((item) => !item.packed) : shown };
    })
    .filter((group) => group.visible.length > 0);
  // Story 16.7. "Noch offen" hides the whole section; the category selection applies to it as to the list.
  // Sub-headings take the chip's label, so a category reads the same in both places.
  const chipLabel = (key: string | null, fallback: string) =>
    chipGroups.find((group) => group.key === key)?.label ?? fallback;
  const notNeededVisible =
    filter === "all"
      ? notNeededGroups
          .map((group) => ({ ...group, label: chipLabel(group.key, group.label), visible: inSelection(group) }))
          .filter((group) => group.visible.length > 0)
      : [];
  const notNeededShownCount = notNeededVisible.reduce((sum, group) => sum + group.visible.length, 0);

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
      const only = chipGroups.find((group) => group.key === next[0]);
      setCategory(only && only.key !== null ? only.label : "");
    }
  };

  /** Story 16.8. Stores a tag chip change, ends any reveal, and prefills the add form's tags for one tag. */
  const changeTagSelection = (next: string[]) => {
    setStoredTagSelection(next);
    storeTags(tripId, next);
    setRevealedIds(new Set());
    if (next.length === 1) {
      const only = tagChips.find((chip) => chip.key === next[0]);
      if (only) setTags([only.label]);
    }
  };

  const toggleTag = (key: string) =>
    changeTagSelection(
      tagSelection.includes(key)
        ? tagSelection.filter((entry) => entry !== key)
        : tagChips.map((chip) => chip.key).filter((entry) => entry === key || tagSelection.includes(entry)),
    );

  const toggleCategory = (key: string | null) =>
    changeSelection(
      selection.includes(key)
        ? selection.filter((entry) => entry !== key)
        : chipGroups.map((group) => group.key).filter((entry) => entry === key || selection.includes(entry)),
    );

  /**
   * Keeps an item that landed outside the selection visible for now, without touching the stored choice.
   * Decided against the stored choice, not the effective one: the save itself can change the groups (a
   * second group makes a dormant stored choice apply again), so the effective selection from before the
   * request is stale. A reveal while nothing is filtered is harmless.
   *
   * Story 16.8: outside the stored category selection, or outside the stored tag selection (none of its tags).
   */
  const revealIfOutsideSelection = (item: PackingItemWire) => {
    const wanted = storedSelection.map((key) => (key === null ? null : key.toLowerCase()));
    const outsideCategories = storedSelection.length > 0 && !wanted.includes(packingGroupKey(item.category));
    const wantedTags = new Set(storedTagSelection.map((key) => key.toLowerCase()));
    const outsideTags = wantedTags.size > 0 && !item.tags.some((tag) => wantedTags.has(packingTagKey(tag)));
    if (!outsideCategories && !outsideTags) return;
    setRevealedIds((current) => new Set(current).add(item.id));
  };

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || addBusy) return;
    // Story 16.8. Text still typed in the tags field becomes a tag; past the limit nothing is sent and the
    // field keeps the text with its limit message.
    const committed = commitPackingTagText(tags, tagText);
    if (committed.refused) return;
    setTags(committed.tags);
    setTagText("");
    setAddBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      const { response, body } = await send<{ item: PackingItemWire; existed: boolean }>("POST", {
        name: trimmed,
        category: category.trim() || null,
        tags: committed.tags,
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
        // Story 16.7. A not-needed item: open its section (and leave "Noch offen", which hides it) so the
        // highlight points at a rendered row. Nothing is marked needed.
        if (item.notNeeded) {
          if (filter === "open") setFilter("all");
          if (!notNeededOpen) {
            setNotNeededInstant(true);
            setNotNeededOpen(true);
          }
        }
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
        // Story 16.7. Marked not needed elsewhere since this page loaded: read the list again.
        if (body.error?.code === "not_needed") reloadAfterAiUndo();
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
    setEditTags(item.tags);
    setEditTagText("");
    setEditError(null);
  };

  const closeEdit = () => {
    if (editBusy) return;
    setEditTarget(null);
  };

  /**
   * Story 16.7 review. The name and category typed in the edit dialog that differ from the item, sent with
   * "Diesmal nicht nötig" / "Doch nötig" so pressing one of them does not drop an unsaved edit. Empty when
   * nothing changed or the dialog is not open for this item.
   */
  const pendingEditsFor = (item: PackingItemWire): { name?: string; category?: string | null; tags?: string[] } => {
    if (editTarget?.id !== item.id) return {};
    const name = editName.trim();
    const category = editCategory.trim() || null;
    // Story 16.8. The tags too, typed text included (what the limit turns away is not sent).
    const { tags } = commitPackingTagText(editTags, editTagText);
    return {
      ...(name && name !== item.name ? { name } : {}),
      ...(category !== item.category ? { category } : {}),
      ...(!samePackingTags(tags, item.tags) ? { tags } : {}),
    };
  };

  const handleSave = async () => {
    if (!editTarget) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    const committed = commitPackingTagText(editTags, editTagText);
    if (committed.refused) return;
    setEditTags(committed.tags);
    setEditTagText("");
    setEditBusy(true);
    setEditError(null);
    try {
      const { response, body } = await send<{ item: PackingItemWire }>("PATCH", {
        itemId: editTarget.id,
        name: trimmed,
        category: editCategory.trim() || null,
        // Only a changed tag list is sent: a full replacement of an untouched list would drop tags added
        // elsewhere while the dialog was open.
        ...(!samePackingTags(committed.tags, editTarget.tags) ? { tags: committed.tags } : {}),
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

  /**
   * Story 16.7. Marks the item not needed with the day count the person confirmed (0 when no confirmation
   * was shown). Answers `null` when it worked, the item with the fresh count when the day links changed
   * meanwhile (the caller then asks with it), or the error text. Mirrors `deleteItem`.
   */
  const sendNotNeeded = async (
    item: PackingItemWire,
  ): Promise<{ error: string } | { daysChanged: PackingItemWire } | null> => {
    try {
      const { response, body } = await send<{ item: PackingItemWire }>("PATCH", {
        itemId: item.id,
        ...pendingEditsFor(item),
        notNeeded: true,
        confirmedDayCount: item.dayCount,
      });
      if (response.status === 409 && body.error?.code === "days_changed") {
        const details = body.error.details as { dayCount?: unknown } | undefined;
        const dayCount = typeof details?.dayCount === "number" ? details.dayCount : item.dayCount;
        setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, dayCount } : entry)));
        return { daysChanged: { ...item, dayCount } };
      }
      if (!response.ok || body.error || !body.data) return { error: resolveApiError(body.error?.code) };
      upsertItem(body.data.item);
      revealIfOutsideSelection(body.data.item);
      return null;
    } catch {
      return { error: t("trips.packingList.saveError") };
    }
  };

  /** Typed tag text the 10-tag limit turns away: the dialog's actions then send nothing, as Save does. */
  const editTagTextRefused = () => commitPackingTagText(editTags, editTagText).refused;

  const handleNotNeededFromEdit = async () => {
    if (!editTarget || editTagTextRefused()) return;
    setEditError(null);
    if (editTarget.dayCount > 0) {
      setNotNeededError(null);
      setNotNeededTarget(editTarget);
      return;
    }
    setEditBusy(true);
    const result = await sendNotNeeded(editTarget);
    setEditBusy(false);
    if (result === null) setEditTarget(null);
    else if ("error" in result) setEditError(result.error);
    else {
      // Linked to a day since the page loaded: ask with the fresh count.
      setNotNeededError(null);
      setNotNeededTarget(result.daysChanged);
    }
  };

  const handleConfirmNotNeeded = async () => {
    if (!notNeededTarget) return;
    setNotNeededBusy(true);
    setNotNeededError(null);
    const result = await sendNotNeeded(notNeededTarget);
    setNotNeededBusy(false);
    if (result === null) {
      setNotNeededTarget(null);
      setEditTarget(null);
    } else if ("error" in result) {
      setNotNeededError(result.error);
    } else {
      // The confirmation text now shows the fresh count; the next confirm sends it.
      setNotNeededTarget(result.daysChanged);
    }
  };

  /** Story 16.7. Marks a not-needed item needed again (open); no confirmation. Answers whether it worked. */
  const markNeeded = async (item: PackingItemWire, onError: (message: string) => void) => {
    try {
      const { response, body } = await send<{ item: PackingItemWire }>("PATCH", {
        itemId: item.id,
        ...pendingEditsFor(item),
        notNeeded: false,
      });
      if (!response.ok || body.error || !body.data) {
        onError(resolveApiError(body.error?.code));
        return false;
      }
      upsertItem(body.data.item);
      revealIfOutsideSelection(body.data.item);
      return true;
    } catch {
      onError(t("trips.packingList.saveError"));
      return false;
    }
  };

  const handleMarkNeededFromRow = async (item: PackingItemWire) => {
    if (markNeededBusyId) return;
    setActionError(null);
    setMarkNeededBusyId(item.id);
    await markNeeded(item, setActionError);
    setMarkNeededBusyId(null);
  };

  const handleMarkNeededFromEdit = async () => {
    if (!editTarget || editTagTextRefused()) return;
    setEditBusy(true);
    setEditError(null);
    const worked = await markNeeded(editTarget, setEditError);
    setEditBusy(false);
    if (worked) setEditTarget(null);
  };

  const toggleNotNeededSection = () => {
    setNotNeededInstant(false);
    setNotNeededOpen((open) => !open);
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

  const notNeededDaysText = (count: number) =>
    count === 1
      ? t("trips.packingList.notNeededDaysOne")
      : formatMessage(t("trips.packingList.notNeededDays"), { count });

  /** A filter chip row (Story 16.6 categories, Story 16.8 tags): toggles, 44px, scrolls instead of wrapping. */
  const chipRow = (
    ariaLabel: string,
    testId: string,
    chips: { reactKey: string; label: string; selected: boolean; onClick: () => void }[],
  ) => (
    <Box
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
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
      {chips.map((chip) => (
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
  );

  /** The ref a row registers for the scroll-to highlight (Story 16.1). */
  const rowRef = (itemId: string) => (node: HTMLElement | null) => {
    if (node) rowRefs.current.set(itemId, node);
    else rowRefs.current.delete(itemId);
  };

  return (
    <Box sx={{ ...cardSx, minWidth: 0 }} data-testid="packing-list-card">
      <Box display="flex" flexDirection="column" gap={2} sx={{ minWidth: 0 }}>
        <Box display="flex" flexDirection="column" gap={0.5}>
          {title}
          {!loadError && (
            <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-progress">
              {formatMessage(t("trips.packingList.progress"), { packed: packedCount, total: neededItems.length })}
            </Typography>
          )}
          {/* Story 16.7 review: no "0 of 0" line for a selection that holds only not-needed items. */}
          {!loadError && selectionActive && selectedTotal > 0 && (
            <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-selection-progress">
              {formatMessage(t("trips.packingList.selectionProgress"), {
                packed: selectedPacked,
                total: selectedTotal,
              })}
            </Typography>
          )}
        </Box>

        {loadError && <Alert severity="error">{loadError}</Alert>}

        {/* Story 16.4. The connector's changes to the list, for writers, above the add form and the filters. */}
        {!loadError && canEdit && (
          <AiChangesNotice
            tripId={tripId}
            scope="packing"
            refreshKey={loadCount + writeCount}
            ensureCsrfToken={ensureCsrfToken}
            onDayChanged={reloadAfterAiUndo}
          />
        )}

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
            {/* Story 16.8. Before Add in the tab order, shown on its own full-width line below it (flex order),
                so the Add button stays on the first line. */}
            <PackingTagInput
              value={tags}
              onChange={setTags}
              inputValue={tagText}
              onInputValueChange={setTagText}
              options={tagOptions}
              disabled={addBusy}
              order={1}
              testId="packing-add-tags"
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
        {!loadError &&
          chipGroups.length >= 2 &&
          chipRow(t("trips.packingList.categoryFilterLabel"), "packing-category-chips", [
            { reactKey: "all", label: t("trips.packingList.allCategories"), selected: selection.length === 0, onClick: () => changeSelection([]) },
            ...chipGroups.map((group) => ({
              reactKey: group.key === null ? "none" : `category:${group.key}`,
              label: group.label,
              selected: selection.includes(group.key),
              onClick: () => toggleCategory(group.key),
            })),
          ])}

        {/* Story 16.8: the trip's tags, below the categories (or alone); same look and behaviour. */}
        {!loadError &&
          tagChips.length >= 1 &&
          chipRow(t("trips.packingList.tagFilterLabel"), "packing-tag-chips", [
            { reactKey: "all", label: t("trips.packingList.allTags"), selected: tagSelection.length === 0, onClick: () => changeTagSelection([]) },
            ...tagChips.map((chip) => ({
              reactKey: `tag:${chip.key}`,
              label: chip.label,
              selected: tagSelection.includes(chip.key),
              onClick: () => toggleTag(chip.key),
            })),
          ])}

        {!loadError && items.length === 0 && (
          <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-empty">
            {t("trips.packingList.empty")}
          </Typography>
        )}

        {!loadError && items.length > 0 && visibleGroups.length === 0 && (
          <Typography variant="body2" sx={{ color: tokens.inkSoft }} data-testid="packing-all-done">
            {neededItems.length === 0
              ? t("trips.packingList.allNotNeeded")
              : selectionActive
                ? selectedTotal === 0
                  ? t("trips.packingList.allNotNeededSelection")
                  : t("trips.packingList.allPackedSelection")
                : t("trips.packingList.allPacked")}
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
                    ref={rowRef(item.id)}
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
                      <PackingNameWithTags tags={item.tags}>
                        <Typography
                          variant="body1"
                          sx={{
                            minWidth: 0,
                            overflowWrap: "anywhere",
                            color: item.packed ? tokens.inkSoft : tokens.ink,
                            textDecoration: item.packed ? "line-through" : "none",
                          }}
                        >
                          {item.name}
                        </Typography>
                      </PackingNameWithTags>
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

        {/* Story 16.7. The not-needed items: after every category, collapsed by default, grouped like the
            list, greyed (no strike-through: that means packed) and without a checkbox. */}
        {!loadError && notNeededShownCount > 0 && (
          <Box component="section" sx={{ minWidth: 0 }} data-testid="packing-not-needed-section">
            {visibleGroups.length > 0 && <Divider sx={{ borderColor: tokens.border, mb: 0.5 }} />}
            <Typography variant="labelCaps" component="h2" sx={{ display: "block", m: 0 }}>
              <Box
                component="button"
                type="button"
                onClick={toggleNotNeededSection}
                aria-expanded={notNeededOpen}
                aria-controls="packing-not-needed-body"
                data-testid="packing-not-needed-toggle"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  width: "100%",
                  minHeight: TOUCH_TARGET_PX,
                  p: 0,
                  border: 0,
                  background: "none",
                  cursor: "pointer",
                  color: tokens.inkSoft,
                  textAlign: "left",
                  font: "inherit",
                  "&:focus-visible": { outline: "2px solid", outlineColor: tokens.ink, outlineOffset: "2px" },
                }}
              >
                <Box component="span">
                  {formatMessage(t("trips.packingList.notNeededSection"), { count: notNeededShownCount })}
                </Box>
                {notNeededOpen ? <ChevronUpIcon sx={{ fontSize: 18 }} /> : <ChevronDownIcon sx={{ fontSize: 18 }} />}
              </Box>
            </Typography>
            {(() => {
              const body = (
                <Box id="packing-not-needed-body" sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  {notNeededVisible.map((group) => (
                    <Box key={group.key === null ? "none" : `category:${group.key}`} sx={{ minWidth: 0 }}>
                      <Typography
                        variant="labelCaps"
                        component="h3"
                        sx={{ color: tokens.inkSoft, display: "block", mb: 0.5 }}
                        data-testid="packing-not-needed-heading"
                      >
                        {group.label}
                      </Typography>
                      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                        {group.visible.map((item) => {
                          const highlighted = highlightId === item.id;
                          return (
                            <Box
                              component="li"
                              key={item.id}
                              ref={rowRef(item.id)}
                              data-testid="packing-not-needed-row"
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
                              {/* The checkbox column stays as an empty slot, so the names line up. */}
                              <Box sx={{ width: TOUCH_TARGET_PX, height: TOUCH_TARGET_PX, flex: "0 0 auto" }} />
                              <Box sx={{ flex: "1 1 auto", minWidth: 0 }}>
                                <PackingNameWithTags tags={item.tags}>
                                  <Typography
                                    variant="body1"
                                    sx={{ minWidth: 0, overflowWrap: "anywhere", color: tokens.inkSoft }}
                                  >
                                    {item.name}
                                  </Typography>
                                </PackingNameWithTags>
                              </Box>
                              {item.aiChangedAt && <AiBadge />}
                              {canEdit && (
                                <Button
                                  variant="text"
                                  onClick={() => void handleMarkNeededFromRow(item)}
                                  disabled={markNeededBusyId !== null}
                                  aria-label={formatMessage(t("trips.packingList.markNeededAria"), { name: item.name })}
                                  sx={{ minHeight: TOUCH_TARGET_PX, flex: "0 0 auto", whiteSpace: "nowrap" }}
                                >
                                  {t("trips.packingList.markNeeded")}
                                </Button>
                              )}
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
              );
              // Opened by an add of a not-needed name: no animation, so the highlighted row has its height
              // when the scroll runs. Otherwise the collapse, without animation under reduced motion.
              if (notNeededInstant && notNeededOpen) return body;
              return (
                <Collapse in={notNeededOpen} timeout={prefersReducedMotion() ? 0 : "auto"}>
                  {body}
                </Collapse>
              );
            })()}
          </Box>
        )}
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
            <PackingTagInput
              value={editTags}
              onChange={setEditTags}
              inputValue={editTagText}
              onInputValueChange={setEditTagText}
              options={tagOptions}
              disabled={editBusy}
              testId="packing-edit-tags"
            />
            {/* Story 16.7. Full width above the actions, so three actions fit 360px without wrapping. */}
            <Button
              variant="outlined"
              fullWidth
              onClick={() => void (editTarget?.notNeeded ? handleMarkNeededFromEdit() : handleNotNeededFromEdit())}
              // It saves the typed name too (Story 16.7 review), so like Save it needs one.
              disabled={editBusy || editName.trim().length === 0}
              sx={{ minHeight: TOUCH_TARGET_PX }}
              data-testid="packing-edit-not-needed"
            >
              {editTarget?.notNeeded ? t("trips.packingList.markNeeded") : t("trips.packingList.markNotNeeded")}
            </Button>
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

      {/* Story 16.7. Not needed, for an item linked to days: they lose it. Not destructive, so no red. */}
      <Dialog
        open={Boolean(notNeededTarget)}
        onClose={() => !notNeededBusy && setNotNeededTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitleWithClose label={t("common.close")} onClose={() => setNotNeededTarget(null)} disabled={notNeededBusy}>
          {t("trips.packingList.notNeededTitle")}
        </DialogTitleWithClose>
        <DialogContent>
          {notNeededError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {notNeededError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" data-testid="packing-not-needed-days">
            {notNeededTarget ? notNeededDaysText(notNeededTarget.dayCount) : null}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNotNeededTarget(null)} disabled={notNeededBusy} sx={{ minHeight: TOUCH_TARGET_PX }}>
            {t("trips.packingList.notNeededCancel")}
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleConfirmNotNeeded()}
            disabled={notNeededBusy}
            sx={{ minHeight: TOUCH_TARGET_PX }}
          >
            {notNeededBusy ? <CircularProgress size={22} /> : t("trips.packingList.notNeededConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
