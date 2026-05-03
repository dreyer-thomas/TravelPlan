"use client";

import { useEffect, useMemo } from "react";
import type { TripDayPrintPayload, TripDayPrintTimelineEntry } from "@/lib/repositories/tripRepo";
import { parsePlanText } from "@/components/features/trips/TripDayPlanItemContent";
import type { TripDayMapPoint } from "@/lib/trips/dayMapData";

const TRANSPORT_LABELS: Record<string, string> = {
  car: "Car",
  ship: "Ship",
  flight: "Flight",
};

const formatDuration = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

const PRINT_MAX_CHARS = 300;

const truncateText = (text: string) =>
  text.length > PRINT_MAX_CHARS ? `${text.slice(0, PRINT_MAX_CHARS).trimEnd()}…` : text;

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

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(day.date));

  const dayHeading = day.note?.trim()
    ? `Day ${day.dayIndex}: ${day.note.trim()}`
    : `Day ${day.dayIndex}`;

  useEffect(() => {
    onReady?.();
  }, [onReady]);

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
        }
      `}</style>

      <div
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
              const rawLabel = item.title?.trim() || truncateText(parsePlanText(item.contentJson));
              const label = rawLabel || `Plan item ${index + 1}`;
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
