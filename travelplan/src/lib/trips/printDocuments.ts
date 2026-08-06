/**
 * The one definition of "the day's documents, in order" and of "what an itinerary entry is called"
 * (Story 9.2).
 *
 * Both halves of the story import it: `TripDayPrintDocument.tsx` renders one page per image document
 * and an appendix naming the PDFs, and `documents/packet/route.ts` merges the same list into one PDF.
 * They are deliberately different mechanisms - HTML `window.print()` on one side, `pdf-lib` on the
 * other - so the only way they cannot disagree about *which* documents a day has, in *which* order, or
 * about *what* each one is attached to, is for the traversal and the label rule to exist once.
 *
 * **It re-derives no order.** `getTripDayPrintPayloadForUser` already built the `timeline` array -
 * `previousStay` → plan items sorted by `compareDayPlanItemsByStartTime` → `currentStay`, with travel
 * segments interleaved - and each entry already carries its documents ordered by `sortOrder`. This
 * module flattens that; it does not sort.
 *
 * **Importable from both runtimes, and that is a constraint on its import graph, not a coincidence.**
 * `tripRepo.ts` is `import type` only (erased at compile time, so no Prisma in a client bundle), the
 * label rule comes from `@/lib/trips/planText` rather than from the `"use client"` component it used to
 * live in, and there is no `"use client"` module anywhere below this one. A single value import from a
 * client module would leave the packet route calling a client reference, which compiles and throws.
 */
import type { TripDayPrintTimelineEntry } from "@/lib/repositories/tripRepo";
import { isPdfDocumentUrl } from "@/lib/trips/documentUploads";
import { parsePlanText } from "@/lib/trips/planText";

/**
 * How much of a plan item's body text may stand in for a missing title, and how much of a stay's notes
 * the sheet prints.
 *
 * Moved here from `TripDayPrintDocument.tsx` unchanged: the label rule below needs it, and the
 * component imports both back so there is still one value. Not a general text limit - it is the print
 * sheet's, which is why the name says so.
 */
export const PRINT_MAX_CHARS = 300;

export const truncateText = (text: string) =>
  text.length > PRINT_MAX_CHARS ? `${text.slice(0, PRINT_MAX_CHARS).trimEnd()}…` : text;

/**
 * What the printed sheet calls one timeline entry, and therefore what a document page is labelled with.
 *
 * This is the sheet's existing three-step expression, moved rather than rewritten: an explicit title,
 * else the item's own body text truncated, else a positional `Plan item N`. `index` is the index into
 * the **timeline** array - segments included - because that is what the sheet's card already counts, and
 * a packet label naming a different number than the card it belongs to would be worse than no number.
 *
 * A stay is named by `stay.name`, truncated to the same `PRINT_MAX_CHARS` the item branch already uses.
 * The truncation is load-bearing rather than tidy: `Accommodation.name` has no `.max()` in its schema and
 * no length limit in Prisma, and the packet's label page lays its lines out by subtracting from a fixed
 * page height - so a name of a few hundred characters pushes the file name and AC5's explanation below
 * `y = 0`, where they are drawn but invisible. Truncating the label is strictly better than a label page
 * that silently omits the one thing it exists to say. The itinerary card is untouched and still prints
 * `stay.name` whole.
 *
 * A travel segment has no name on this sheet and carries no documents, so it has no label to give: `""`
 * is returned rather than a placeholder nobody would ever see, and `collectTimelineDocuments` never asks.
 */
export const getPrintEntryLabel = (entry: TripDayPrintTimelineEntry, index: number): string => {
  if (entry.kind === "previousStay" || entry.kind === "currentStay") {
    return truncateText(entry.stay.name);
  }
  if (entry.kind === "planItem") {
    const rawLabel = entry.item.title?.trim() || truncateText(parsePlanText(entry.item.contentJson));
    return rawLabel || `Plan item ${index + 1}`;
  }
  return "";
};

/**
 * One document of the day, flattened out of the timeline and told apart by its URL.
 *
 * `isPdf` is resolved here, once, so neither consumer re-decides it - and it comes from `documentUrl`,
 * never from `fileName`; see `documentUrlExtension` for why that distinction is load-bearing. Note that
 * `isPdf === false` does **not** promise an embeddable image: a `.webp` lands here as a non-PDF and the
 * packet degrades it to a label page, because `pdf-lib` has only `embedJpg` and `embedPng`.
 */
export type PrintTimelineDocument = {
  entryLabel: string;
  fileName: string;
  documentUrl: string;
  isPdf: boolean;
};

/**
 * Every document attached to the day, in timeline order, each tagged with the entry it belongs to.
 *
 * Travel segments are skipped because nothing attaches to one. A day with no documents returns `[]`,
 * which is what makes AC3 ("prints exactly as it does today") and the packet's `no_documents` refusal
 * the same question asked once.
 */
export const collectTimelineDocuments = (
  timeline: readonly TripDayPrintTimelineEntry[],
): PrintTimelineDocument[] => {
  const collected: PrintTimelineDocument[] = [];

  timeline.forEach((entry, index) => {
    const documents =
      entry.kind === "previousStay" || entry.kind === "currentStay"
        ? entry.stay.documents
        : entry.kind === "planItem"
          ? entry.item.documents
          : null;
    if (!documents || documents.length === 0) return;

    const entryLabel = getPrintEntryLabel(entry, index);
    for (const document of documents) {
      collected.push({
        entryLabel,
        fileName: document.fileName,
        documentUrl: document.documentUrl,
        isPdf: isPdfDocumentUrl(document.documentUrl),
      });
    }
  });

  return collected;
};
