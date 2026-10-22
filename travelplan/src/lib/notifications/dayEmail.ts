import { formatMessage, type Language } from "@/i18n";
import type { TripDayPrintPayload, TripDayPrintTimelineEntry } from "@/lib/repositories/tripRepo";
import { formatLongDate } from "@/lib/trips/formatLongDate";
import { parsePlanText } from "@/lib/trips/planText";
import { formatPrintDuration, getEntryDisplayName, getPrintEntryLabel } from "@/lib/trips/printDocuments";
import { TRANSPORT_LABEL_KEYS, isTransportType, transportTypeAllowsDistance } from "@/lib/trips/transportTypes";

/** What the mail says about the day's documents - decided by the route, which measured the mail. */
export type DayEmailDocuments = "attached" | "tooLarge" | "none";

export type DayEmail = { subject: string; text: string; html: string };

/**
 * One timeline entry, already worded. Both parts of the mail are rendered from these rows and from
 * nothing else, so the HTML and the plain text cannot carry different content (Story 9.3 AC6).
 * Every string here is raw user text or dictionary text; escaping happens at HTML interpolation only.
 */
type Row =
  | { kind: "stay"; current: boolean; label: string; name: string; time: string | null; notes: string | null }
  | {
      kind: "activity";
      time: string | null;
      duration: string;
      title: string;
      place: string | null;
      text: string | null;
    }
  | { kind: "leg"; line: string; route: string | null };

const DOCUMENTS_KEYS: Record<DayEmailDocuments, string> = {
  attached: "trips.dayEmail.documentsAttached",
  tooLarge: "trips.dayEmail.documentsTooLarge",
  none: "trips.dayEmail.documentsNone",
};

/** Every interpolated value in the HTML part goes through this - user text and dictionary text alike. */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toRows = (
  timeline: readonly TripDayPrintTimelineEntry[],
  t: (key: string) => string,
): Row[] => {
  const planItemFallback = (position: number) => formatMessage(t("trips.dayPrint.planItemFallback"), { position });

  return timeline.map((entry, index): Row => {
    if (entry.kind === "previousStay" || entry.kind === "currentStay") {
      const current = entry.kind === "currentStay";
      const { stay } = entry;
      // The print sheet's split: the previous night is about leaving (check-out), tonight about arriving.
      const time = current
        ? stay.checkInTime && formatMessage(t("trips.dayPrint.checkIn"), { time: stay.checkInTime })
        : stay.checkOutTime && formatMessage(t("trips.dayPrint.checkOut"), { time: stay.checkOutTime });
      return {
        kind: "stay",
        current,
        label: t(current ? "trips.dayPrint.currentStay" : "trips.dayPrint.previousStay"),
        name: stay.name,
        time: time || null,
        notes: current ? stay.notes?.trim() || null : null,
      };
    }

    if (entry.kind === "planItem") {
      const { item } = entry;
      // The label the sheet and the packet's label pages use, so all three name an activity identically.
      const title = getPrintEntryLabel(entry, index, planItemFallback);
      // Unlike the sheet, the body is not truncated: a mail is not paper. Dropped only when it *is* the
      // label already (an untitled item whose text is short enough to stand in for one).
      const text = parsePlanText(item.contentJson).trim();
      return {
        kind: "activity",
        // `null` times are an activity that does not fit the day (`daySchedule.ts` rule 5): duration only.
        time:
          item.fromTime && item.toTime ? `${item.fromTime} – ${item.toTime}` : (item.fromTime ?? item.toTime ?? null),
        duration: formatPrintDuration(item.durationMinutes, t),
        title,
        place: item.location?.label?.trim() || null,
        text: text && text !== title ? text : null,
      };
    }

    const { segment } = entry;
    // Membership before `t()`, as on the sheet: an unknown mode prints raw, never as a dictionary key.
    const transport = isTransportType(segment.transportType)
      ? t(TRANSPORT_LABEL_KEYS[segment.transportType])
      : segment.transportType;
    const distance =
      transportTypeAllowsDistance(segment.transportType) && segment.distanceKm != null && segment.distanceKm > 0
        ? `${segment.distanceKm} ${t("trips.travelSegment.kmSuffix")}`
        : null;
    const fromName = getEntryDisplayName(timeline[index - 1]);
    const toName = getEntryDisplayName(timeline[index + 1]);
    return {
      kind: "leg",
      line: [transport, formatPrintDuration(segment.durationMinutes, t), distance].filter(Boolean).join(" · "),
      route: fromName || toName ? `${fromName ?? "—"} → ${toName ?? "—"}` : null,
    };
  });
};

const rowToText = (row: Row): string => {
  if (row.kind === "stay") {
    return [row.label, row.name, row.time, row.notes].filter(Boolean).join("\n");
  }
  if (row.kind === "activity") {
    const when = [row.time, row.duration].filter(Boolean).join(" · ");
    return [when, row.title, row.place, row.text].filter(Boolean).join("\n");
  }
  return [row.line, row.route].filter(Boolean).join("\n");
};

const TEXT_STYLE = "word-break:break-word;overflow-wrap:anywhere";
const MUTED = "color:#555555";

const rowToHtml = (row: Row): string => {
  const line = (value: string | null, style = "") =>
    value ? `<div style="${style}${style ? ";" : ""}${TEXT_STYLE}">${escapeHtml(value)}</div>` : "";

  if (row.kind === "stay") {
    const border = row.current ? "4px solid #333333" : "3px solid #888888";
    return (
      `<div style="border-left:${border};padding:6px 10px;margin:0 0 12px 0">` +
      line(row.label, `font-size:12px;text-transform:uppercase;letter-spacing:0.05em;${MUTED}`) +
      line(row.name, "font-weight:bold") +
      line(row.time, `font-size:14px;${MUTED}`) +
      line(row.notes, "font-size:14px;white-space:pre-line") +
      `</div>`
    );
  }
  if (row.kind === "activity") {
    const when = [row.time, row.duration].filter(Boolean).join(" · ");
    return (
      `<div style="border:1px solid #dddddd;padding:8px 10px;margin:0 0 12px 0">` +
      line(when || null, `font-size:14px;font-weight:bold;${MUTED}`) +
      line(row.title, "font-weight:bold") +
      line(row.place, `font-size:14px;${MUTED}`) +
      line(row.text, "font-size:14px;margin-top:4px;white-space:pre-line") +
      `</div>`
    );
  }
  const text = [row.line, row.route].filter(Boolean).join(" — ");
  return line(text, `font-size:14px;${MUTED};margin:0 0 12px 10px`);
};

/**
 * The day plan as an email (Story 9.3, FR51): subject, plain text and HTML, from the print payload.
 *
 * Pure - no I/O, no clock, no environment - so the route decides *which* documents sentence applies
 * (it measured the finished mail) and this module only words it.
 *
 * **Nothing loads.** The HTML has no image, no stylesheet, no `<style>`, no font, no script and no URL but
 * the day link: inline `style=""` only, one column, `max-width:600px`. A mail read offline on a phone must
 * look the same as one read online, and remote content is what mail clients block first anyway.
 *
 * **Escaped at interpolation, every time** - trip name, day note, stay names and notes, titles, places,
 * plan text and the link itself. Plan content reaches the mail only as `parsePlanText` output, so no
 * stored HTML or Tiptap markup does.
 *
 * `language` and `t` must be one resolution of the request's `lang` cookie (`getRequestI18n`), as for the
 * packet: the date is formatted with `language`, every label comes through `t`.
 */
export const buildDayEmail = ({
  payload,
  language,
  t,
  dayUrl,
  documents,
}: {
  payload: TripDayPrintPayload;
  language: Language;
  t: (key: string) => string;
  dayUrl: string;
  documents: DayEmailDocuments;
}): DayEmail => {
  const { trip, day, timeline } = payload;
  const date = formatLongDate(day.date, language) ?? "";
  // The note is appended rather than interpolated, exactly as on the print sheet: it is user text.
  const dayIndexHeading = formatMessage(t("trips.dayPrint.dayHeading"), { index: day.dayIndex });
  const dayHeading = day.note?.trim() ? `${dayIndexHeading}: ${day.note.trim()}` : dayIndexHeading;
  const intro = t("trips.dayEmail.intro");
  const openDay = t("trips.dayEmail.openDay");
  const documentsSentence = t(DOCUMENTS_KEYS[documents]);
  const itinerary = t("trips.dayPrint.itinerarySection");
  const rows = toRows(timeline, t);
  const empty = rows.length === 0 ? t("trips.dayPrint.empty") : null;

  const subject = formatMessage(t("trips.dayEmail.subject"), { trip: trip.name, date }).trim();

  const text = [
    [trip.name, dayHeading, date].filter(Boolean).join("\n"),
    intro,
    `${openDay}:\n${dayUrl}`,
    documentsSentence,
    itinerary.toUpperCase(),
    ...(empty ? [empty] : rows.map(rowToText)),
  ].join("\n\n");

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#ffffff">` +
    `<div style="max-width:600px;margin:0 auto;padding:16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1a1a1a">` +
    `<div style="font-size:14px;${MUTED};${TEXT_STYLE}">${escapeHtml(trip.name)}</div>` +
    `<h1 style="font-size:22px;line-height:1.25;margin:4px 0;${TEXT_STYLE}">${escapeHtml(dayHeading)}</h1>` +
    (date ? `<div style="font-size:15px;${MUTED}">${escapeHtml(date)}</div>` : "") +
    `<p style="margin:16px 0 8px 0">${escapeHtml(intro)}</p>` +
    `<p style="margin:0 0 8px 0"><a href="${escapeHtml(dayUrl)}" style="color:#1a4fa0;font-weight:bold">${escapeHtml(openDay)}</a></p>` +
    `<p style="margin:0 0 20px 0">${escapeHtml(documentsSentence)}</p>` +
    `<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;${MUTED};font-weight:bold;margin:0 0 8px 0">${escapeHtml(itinerary)}</div>` +
    (empty ? `<p style="${MUTED}">${escapeHtml(empty)}</p>` : rows.map(rowToHtml).join("")) +
    `</div></body></html>`;

  return { subject, text, html };
};
