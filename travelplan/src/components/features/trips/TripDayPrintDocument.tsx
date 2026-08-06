"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TripDayPrintPayload, TripDayPrintTimelineEntry } from "@/lib/repositories/tripRepo";
import { parsePlanText } from "@/lib/trips/planText";
import { collectTimelineDocuments, getPrintEntryLabel, truncateText } from "@/lib/trips/printDocuments";
import type { TripDayMapPoint } from "@/lib/trips/dayMapData";

/**
 * How long the print dialog waits on each `<img>` that has not settled, and the ceiling on the whole wait.
 *
 * A ceiling, not a delay: it only applies when an `<img>` neither loads nor errors, which on an
 * authenticated media route means a stalled connection rather than a 404 (a 404 fires `error`). Long
 * enough that a 10 MB ticket over a slow link still makes it onto the page, short enough that the user
 * is not left staring at a page with no print dialog. The itinerary prints either way.
 *
 * **Per outstanding image, because the wait is for all of them at once.** One flat budget for the whole
 * set means the per-image reasoning above stops being true as soon as a day has more than one document:
 * six 3 MB tickets sharing 8 seconds fire the dialog with three of them still blank, which is the exact
 * failure this wait exists to prevent, arriving silently instead of immediately. The itinerary's own
 * 56x44 thumbnails are in the same set and equally cold, so they count too. Capped in absolute terms so
 * that a document-heavy day with a stalled connection still cannot hold the dialog shut for minutes.
 */
const IMAGE_SETTLE_TIMEOUT_PER_IMAGE_MS = 8000;
const IMAGE_SETTLE_TIMEOUT_CEILING_MS = 40000;

const TRANSPORT_LABELS: Record<string, string> = {
  car: "Car",
  ship: "Ship",
  flight: "Flight",
  walking: "Walking",
  cycling: "Cycling",
};

const formatDuration = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

const GOOGLE_MAPS_MAX_STOPS = 9;

const buildGoogleMapsUrl = (points: TripDayMapPoint[]): string | null => {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => a.order - b.order);
  let sampled: typeof ordered;
  if (ordered.length <= GOOGLE_MAPS_MAX_STOPS) {
    sampled = ordered;
  } else {
    const mid = ordered.slice(1, -1);
    const step = Math.ceil(mid.length / (GOOGLE_MAPS_MAX_STOPS - 2));
    sampled = [ordered[0], ...mid.filter((_, i) => i % step === 0), ordered[ordered.length - 1]];
  }
  const stops = sampled.map((p) => `${p.position[0].toFixed(6)},${p.position[1].toFixed(6)}`);
  return `https://www.google.com/maps/dir/${stops.join("/")}`;
};

const getEntryDisplayName = (entry: TripDayPrintTimelineEntry | undefined): string | null => {
  if (!entry) return null;
  if (entry.kind === "planItem") return entry.item.title?.trim() || null;
  if (entry.kind === "previousStay" || entry.kind === "currentStay") return entry.stay.name.trim() || null;
  return null;
};


type TripDayPrintDocumentProps = {
  payload: TripDayPrintPayload;
  onReady?: () => void;
};

export default function TripDayPrintDocument({ payload, onReady }: TripDayPrintDocumentProps) {
  const { trip, day, timeline, map } = payload;

  const googleMapsUrl = useMemo(() => buildGoogleMapsUrl(map.points), [map.points]);
  const hasMapPoints = map.points.length > 0;

  // One traversal of the day's documents, from the module the packet route also imports, so the sheet
  // and the packet cannot disagree about which documents this day has or in what order.
  //
  // Split by `isPdf` rather than by "is this an image": the two halves are exhaustive over what the
  // upload routes can store (`pdf`, `jpg`, `jpeg`, `png`, `webp`), and a browser renders all four image
  // spellings. A URL with no recognised extension therefore lands in the image half and prints as a
  // broken `<img>` - a visibly missing picture on an HTML sheet, which is a better failure than being
  // listed in an appendix as a PDF it is not. The packet half, which has to hand the bytes to a parser,
  // refuses that case outright with a label page.
  const { imageDocuments, pdfDocuments } = useMemo(() => {
    const documents = collectTimelineDocuments(timeline);
    return {
      imageDocuments: documents.filter((document) => !document.isPdf),
      pdfDocuments: documents.filter((document) => document.isPdf),
    };
  }, [timeline]);

  const root = useRef<HTMLDivElement | null>(null);

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(day.date));

  const dayHeading = day.note?.trim()
    ? `Day ${day.dayIndex}: ${day.note.trim()}`
    : `Day ${day.dayIndex}`;

  // `onReady` is what fires `window.print()` (`TripDayPrintPage.tsx`), and the print dialog snapshots
  // the page at the moment it opens - a later image load does not update the preview. Before Story 9.2
  // the only images on this sheet were two 56x44 thumbnails per entry, so firing on mount cost at most
  // a missing thumbnail. Now a full page per image document IS the deliverable, and those bytes are
  // never warm: the day view renders documents as chips, never as `<img>`, so nothing has fetched them.
  // Firing on mount therefore prints blank ticket pages on the first visit, which is precisely the
  // failure the feature exists to prevent.
  //
  // So wait for every `<img>` in this subtree to settle - loaded OR failed, since a broken document
  // must not hold the dialog shut - behind a timeout, because an image that never settles must not stop
  // the user printing the itinerary at all. `decode()` is not used: it resolves off the decode pipeline
  // and `complete` plus a layout frame is what print needs.
  useEffect(() => {
    if (!onReady) return;

    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      onReady();
    };

    const images = Array.from(root.current?.querySelectorAll("img") ?? []);
    const settled = images
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
      );

    // Nothing outstanding: fire in this tick, so the existing no-image behaviour is unchanged.
    if (settled.length === 0) {
      fire();
      return;
    }

    const timeout = window.setTimeout(
      fire,
      Math.min(IMAGE_SETTLE_TIMEOUT_PER_IMAGE_MS * settled.length, IMAGE_SETTLE_TIMEOUT_CEILING_MS),
    );
    void Promise.all(settled).then(() => {
      // One frame after the last load, so the laid-out height is the one the dialog captures.
      window.requestAnimationFrame(fire);
    });

    return () => {
      window.clearTimeout(timeout);
      done = true;
    };
  }, [onReady, imageDocuments]);

  return (
    <>
      <style>{`
        @page {
          size: A4 portrait;
          margin: 16mm 14mm 16mm 14mm;
        }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-no-break { page-break-inside: avoid; break-inside: avoid; }
          .print-map { page-break-inside: avoid; break-inside: avoid; }
          .print-hide { display: none !important; }
          /* break-before only, and never break-after. A break-after on the last document page is
             exactly what produces the trailing blank sheet AC1 forbids: the browser opens a page for
             the break and then has nothing to put on it. Pushing each page open from its own front
             edge needs no exemption for the last one. Both spellings because the legacy
             page-break-before is what older print engines honour and break-before is the current
             property; they say the same thing. */
          /* A *fixed* height, not just a break, and the number is measured rather than derived.
             A4 is 297mm and the @page margin takes 16mm off each end, leaving a 265mm printable box.
             The footer that follows the last document page measures 6.3mm plus a 5.3mm top margin, and
             the container adds 6.3mm of bottom padding - 17.9mm this page does not get. Capping only the
             *image* at 245mm left the last page at 255.3 + 17.9 = 273.2mm, and the browser opened a
             third sheet carrying nothing but the trip name and the date: exactly the trailing page AC1
             forbids, and invisible unless the last document is tall enough to reach the cap.
             Measured at 1280px with a 900x1600 ticket, which is why it is 245mm here and not arithmetic.

             Pinning the block rather than the image is what makes it hold for *any* caption: a long
             entry label wraps to more lines, and with a definite height that eats into the image's share
             instead of pushing the footer off the page. */
          .print-document-page {
            page-break-before: always;
            break-before: page;
            height: 245mm;
            display: flex;
            flex-direction: column;
          }
          /* min-height: 0 because a flex item will not shrink below its content size without it, and
             the image's content size is its intrinsic height. max-height: 100% then resolves against the
             block above, so the image takes whatever the caption leaves. width/height auto keeps the
             aspect ratio - scaled down when oversized, left alone when small, never cropped or stretched,
             which is what AC1's "without cropping or distortion" asks for.
             No backticks anywhere in this block: it is a JS template literal, and one would end it. */
          .print-document-page img {
            display: block;
            max-width: 100%;
            max-height: 100%;
            min-height: 0;
            width: auto;
            height: auto;
            margin: 0 auto;
            object-fit: contain;
          }
        }
      `}</style>

      <div
        ref={root}
        style={{
          fontFamily: "Georgia, serif",
          color: "#111",
          maxWidth: "680px",
          margin: "0 auto",
          padding: "24px 0",
          fontSize: "13px",
          lineHeight: "1.5",
        }}
      >
        {/* Header */}
        <div
          className="print-no-break"
          style={{
            borderBottom: "2px solid #111",
            paddingBottom: "10px",
            marginBottom: "16px",
          }}
        >
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#555" }}>
            {trip.name}
          </div>
          <h1 style={{ margin: "4px 0 2px", fontSize: "20px", fontWeight: 700 }}>{dayHeading}</h1>
          <div style={{ fontSize: "12px", color: "#444" }}>{formattedDate}</div>
        </div>

        {/* Map section — navigation link for offline use */}
        {hasMapPoints && googleMapsUrl && (
          <div
            data-testid="print-map-section"
            className="print-no-break print-map"
            style={{ marginBottom: "16px" }}
          >
            <div
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "#666",
                marginBottom: "4px",
                fontWeight: 600,
              }}
            >
              Day route
            </div>
            <div style={{ fontSize: "11px", color: "#333" }}>
              <a
                data-testid="print-map-link"
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#333", wordBreak: "break-all" }}
              >
                Navigate in Google Maps ↗
              </a>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div>
          <div
            style={{
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#666",
              marginBottom: "8px",
              fontWeight: 600,
            }}
          >
            Itinerary
          </div>

          {timeline.length === 0 && (
            <p style={{ color: "#666", fontSize: "12px" }}>No details recorded for this day.</p>
          )}

          {timeline.map((entry, index) => {
            if (entry.kind === "travelSegment") {
              const seg = entry.segment;
              const transport = TRANSPORT_LABELS[seg.transportType] ?? seg.transportType;
              const duration = formatDuration(seg.durationMinutes);
              const distance = seg.distanceKm != null && seg.distanceKm > 0 ? `${seg.distanceKm} km` : null;
              const label = [transport, duration, distance].filter(Boolean).join(" · ");
              const fromName = getEntryDisplayName(timeline[index - 1]);
              const toName = getEntryDisplayName(timeline[index + 1]);
              return (
                <div
                  key={`seg-${index}`}
                  data-testid="print-timeline-entry"
                  data-kind="travelSegment"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    padding: "4px 8px",
                    color: "#555",
                    fontSize: "11px",
                  }}
                >
                  <span style={{ borderLeft: "2px dashed #aaa", height: "14px", display: "inline-block", marginTop: "2px", flexShrink: 0 }} />
                  <span>
                    <span>{label}</span>
                    {(fromName || toName) && (
                      <span
                        data-testid="print-segment-route"
                        style={{ display: "block", fontSize: "10px", color: "#888", marginTop: "1px" }}
                      >
                        {fromName ?? "—"} → {toName ?? "—"}
                      </span>
                    )}
                  </span>
                </div>
              );
            }

            if (entry.kind === "previousStay" || entry.kind === "currentStay") {
              const stay = entry.stay;
              const label =
                entry.kind === "previousStay"
                  ? "Previous night accommodation"
                  : "Tonight's accommodation";
              const images = stay.images.slice(0, 2);
              return (
                <div
                  key={`${entry.kind}-${index}`}
                  data-testid="print-timeline-entry"
                  data-kind={entry.kind}
                  className="print-no-break"
                  style={{
                    border: "1px solid #ccc",
                    borderLeft: entry.kind === "previousStay" ? "3px solid #888" : "4px solid #333",
                    borderRadius: "4px",
                    padding: "8px 10px",
                    marginBottom: "6px",
                    background: entry.kind === "previousStay" ? "#fafafa" : "#f0f4ff",
                  }}
                >
                  <div
                    style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#777", marginBottom: "2px" }}
                  >
                    {label}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "13px" }}>{stay.name}</div>
                      {stay.checkOutTime && entry.kind === "previousStay" && (
                        <div style={{ fontSize: "11px", color: "#555" }}>Check-out: {stay.checkOutTime}</div>
                      )}
                      {stay.checkInTime && entry.kind === "currentStay" && (
                        <div style={{ fontSize: "11px", color: "#555" }}>Check-in: {stay.checkInTime}</div>
                      )}
                      {stay.notes && (
                        <div style={{ fontSize: "11px", color: "#444", marginTop: "2px" }}>
                          {truncateText(stay.notes)}
                        </div>
                      )}
                    </div>
                    {images.length > 0 && (
                      <div data-testid="print-image-strip" style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                        {images.map((img) => (
                          <img
                            key={img.id}
                            data-testid="print-thumbnail"
                            src={img.imageUrl}
                            alt=""
                            style={{ width: "56px", height: "44px", objectFit: "cover", borderRadius: "3px" }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            if (entry.kind === "planItem") {
              const item = entry.item;
              // The same call the document pages and the packet's label pages make, so a loose printed
              // page names its activity with the byte-identical string this card shows. The three-step
              // expression it replaces is unchanged - it moved, it was not rewritten.
              const label = getPrintEntryLabel(entry, index);
              const description = item.title?.trim() ? truncateText(parsePlanText(item.contentJson)) : null;
              const timeTag =
                item.fromTime && item.toTime
                  ? `${item.fromTime} – ${item.toTime}`
                  : item.fromTime ?? item.toTime ?? null;
              const images = item.images.slice(0, 2);
              return (
                <div
                  key={`item-${index}`}
                  data-testid="print-timeline-entry"
                  data-kind="planItem"
                  className="print-no-break"
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    padding: "8px 10px",
                    marginBottom: "6px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      {timeTag && (
                        <div style={{ fontSize: "10px", color: "#555", fontWeight: 600, marginBottom: "2px" }}>
                          {timeTag}
                        </div>
                      )}
                      <div style={{ fontWeight: 600, fontSize: "13px" }}>{label}</div>
                      {description && description !== label && (
                        <div style={{ fontSize: "11px", color: "#444", marginTop: "2px" }}>{description}</div>
                      )}
                    </div>
                    {images.length > 0 && (
                      <div data-testid="print-image-strip" style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                        {images.map((img) => (
                          <img
                            key={img.id}
                            data-testid="print-thumbnail"
                            src={img.imageUrl}
                            alt=""
                            style={{ width: "56px", height: "44px", objectFit: "cover", borderRadius: "3px" }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>

        {/* Image documents: one full page each, after the itinerary (Story 9.2 AC1).
            Nothing at all is emitted when the day has no image documents - `map` over an empty array
            renders no node, which is what keeps AC3's "byte-for-byte what it is today" true without a
            guard around it. */}
        {imageDocuments.map((document, index) => (
          <div
            key={`document-page-${index}-${document.documentUrl}`}
            data-testid="print-document-page"
            className="print-document-page"
          >
            <div style={{ marginBottom: "6px" }}>
              <div
                style={{
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#666",
                  fontWeight: 600,
                }}
              >
                {document.entryLabel}
              </div>
              <div style={{ fontSize: "12px", color: "#333", wordBreak: "break-all" }}>
                {document.fileName}
              </div>
            </div>
            {/* alt="" on purpose: the caption directly above already names this document, and an alt
                repeating it would announce the same string twice. The printed page is the artefact
                here; the caption is what makes a loose sheet matchable back to its activity.
                The inline style is the on-screen preview's - the print box is the @media print rule. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- `next/image` renders a sized,
                lazy-loading, srcset-driven element, and a print sheet needs the opposite of all three:
                the browser must have the full-resolution bytes laid out before `window.print()` fires,
                at whatever intrinsic size the ticket has. The two existing thumbnails in this file are
                plain `<img>` for the same reason. */}
            <img
              data-testid="print-document-image"
              src={document.documentUrl}
              alt=""
              style={{ display: "block", maxWidth: "100%", height: "auto" }}
            />
          </div>
        ))}

        {/* PDF appendix (AC2). PDFs cannot be printed from an HTML page by any browser, so the one
            thing this sheet must not do is drop them in silence - a traveller finds that out at the
            gate. Naming them and saying plainly that they are absent is what keeps the printout honest
            about what it is. Rendered only when there is at least one, per AC3. */}
        {pdfDocuments.length > 0 && (
          <div
            data-testid="print-document-appendix"
            className="print-no-break"
            style={{
              border: "1px solid #ccc",
              borderRadius: "4px",
              padding: "8px 10px",
              marginTop: "16px",
              background: "#fafafa",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "#666",
                marginBottom: "4px",
                fontWeight: 600,
              }}
            >
              Documents not included in this printout
            </div>
            <ul style={{ margin: "0 0 6px", paddingLeft: "18px", fontSize: "11px", color: "#333" }}>
              {pdfDocuments.map((document, index) => (
                <li
                  key={`document-appendix-${index}-${document.documentUrl}`}
                  data-testid="print-document-appendix-item"
                  style={{ wordBreak: "break-word" }}
                >
                  {document.entryLabel} — {document.fileName}
                </li>
              ))}
            </ul>
            <div style={{ fontSize: "11px", color: "#444" }}>
              These PDF files are not part of this printout. Download the day&apos;s document packet from
              the day screen to have them offline.
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="print-no-break"
          style={{
            borderTop: "1px solid #ccc",
            marginTop: "20px",
            paddingTop: "8px",
            fontSize: "10px",
            color: "#888",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{trip.name}</span>
          <span>{formattedDate}</span>
        </div>
      </div>
    </>
  );
}
