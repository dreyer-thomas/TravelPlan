import type { Metadata } from "next";
import { Box } from "@mui/material";
import TripDayPrintPage from "@/components/features/trips/TripDayPrintPage";
import { getServerT } from "@/i18n/server";

type TripDayPrintPageProps = {
  params: Promise<{
    id: string;
    dayId: string;
  }>;
};

/**
 * DW-230. The tab title is not only chrome here: browsers print the document title into the page header,
 * so an English title on a German sheet is English text on the paper. This is an async server component,
 * so `getServerT()` - which reads the same `lang` cookie through `next/headers` - is the right reader.
 *
 * The `id / dayId` suffix stays. It is not a user-facing label but the thing that tells two printed sheets
 * apart in a browser's print history, and translating the ids would be meaningless.
 */
export async function generateMetadata({ params }: TripDayPrintPageProps): Promise<Metadata> {
  const { id, dayId } = await params;
  const t = await getServerT();
  return { title: `${t("trips.dayPrint.metaTitle")} — ${id} / ${dayId}` };
}

export default async function TripDayPrintPageRoute({ params }: TripDayPrintPageProps) {
  const { id, dayId } = await params;
  return (
    <Box
      sx={{
        backgroundColor: "#fff",
        // On screen this is the whole point of the box: the white sheet reaches the bottom of the
        // window instead of stopping at the end of a short itinerary. Kept exactly as it was.
        minHeight: "100vh",
        /* Neutralised for print, which is DW-198's fix: every documents-free day used to emit a trailing
           blank sheet. `vh` is not a viewport unit in a paginated context - it resolves against the *page
           box* - so `min-height: 100vh` here is a floor of "one whole sheet" no matter how short the day
           is. Anything laid out above this Box then has nowhere to go but a second sheet. Today that is
           `AppHeader` from `(routes)/layout.tsx`: `position="static"`, so it is in normal flow, and its
           Toolbar is 72px plus a 1px border. One page + 73px = two pages, and the overflow carries no
           content. That is exactly the observed signature - the blank page appeared independently of
           content volume, present on a completely empty day and gone once the itinerary genuinely
           exceeded a page.

           Note what is *not* the cause, because the obvious suspects are innocent: this shell's `py: 3`
           and the sheet wrapper's `padding: "24px 0"` are on descendants of this Box, and with
           `globals.css`'s `* { box-sizing: border-box }` their padding counts toward content height, which
           a `min-height` floor absorbs whole while the content is short. They cannot produce a
           content-independent blank page.

           Measured, not deduced: headless Chrome `Page.printToPDF({ preferCSSPageSize: true })` against a
           production build, page count from `/Type /Page` and blankness from each page's inflated content
           stream. Documents-free fixtures went 2 → 1; genuinely two-page days and the image-document
           fixture were unchanged. The wrapper padding and a footer `page-break-before: avoid` were each
           measured independently and are deliberately not applied - the footer rule moved no fixture at
           all, and the padding moves a different number (the separate trailing sheet after the last
           `.print-document-page`, still open). Full table in
           `_bmad-output/implementation-artifacts/spec-print-day-sheet-fixes.md`.

           No test guards this - jsdom applies no `@media print` rule, so an assertion here would prove
           nothing. Re-measure with the method above if anything above or around this Box in the routes
           layout changes height or leaves the flow (AppHeader being the whole of it today), or if this
           shell's padding, the sheet wrapper's padding, or `.print-document-page`'s height changes. */
        "@media print": { minHeight: "auto" },
      }}
    >
      <TripDayPrintPage tripId={id} dayId={dayId} />
    </Box>
  );
}
