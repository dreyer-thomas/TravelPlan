import { describe, expect, it } from "vitest";
import { dictionaries, translate, type Language } from "@/i18n";
import type {
  TripDayPrintPayload,
  TripDayPrintPlanItem,
  TripDayPrintStay,
  TripDayPrintTimelineEntry,
} from "@/lib/repositories/tripRepo";
import { buildDayEmail } from "@/lib/notifications/dayEmail";

const DAY_URL = "https://plan.example.test/trips/trip-1/days/day-1";

const tFor = (language: Language) => (key: string) => translate(dictionaries[language], key);

const stay = (overrides: Partial<TripDayPrintStay> = {}): TripDayPrintStay => ({
  id: "stay",
  name: "Hotel Alpha",
  notes: null,
  status: "booked",
  costCents: null,
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
  link: null,
  checkInTime: null,
  checkOutTime: null,
  location: null,
  images: [],
  documents: [],
  ...overrides,
});

const planText = (text: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const item = (overrides: Partial<TripDayPrintPlanItem> = {}): TripDayPrintPlanItem => ({
  id: "item",
  title: "Museum",
  fromTime: "09:00",
  toTime: "11:00",
  scheduleMode: "FIXED",
  durationMinutes: 120,
  sortOrder: 0,
  contentJson: planText(""),
  costCents: null,
  costOriginalAmount: null,
  costCurrency: null,
  costRate: null,
  costRateDate: null,
  linkUrl: null,
  location: null,
  images: [],
  documents: [],
  ...overrides,
});

const segment = (transportType: string, durationMinutes: number, distanceKm: number | null) =>
  ({
    kind: "travelSegment",
    segment: { id: `seg-${transportType}`, transportType, durationMinutes, distanceKm, linkUrl: null },
  }) as unknown as TripDayPrintTimelineEntry;

const payload = (timeline: TripDayPrintTimelineEntry[], overrides: Partial<TripDayPrintPayload["trip"]> = {}) =>
  ({
    trip: { id: "trip-1", name: "Iceland", ...overrides },
    day: { id: "day-1", date: "2026-08-09T00:00:00.000Z", dayIndex: 3, note: "Ring road", imageUrl: null },
    timeline,
    map: { points: [], missingLocations: [] },
  }) as unknown as TripDayPrintPayload;

const build = (
  p: TripDayPrintPayload,
  language: Language = "en",
  documents: "attached" | "tooLarge" | "none" = "none",
) => buildDayEmail({ payload: p, language, t: tFor(language), dayUrl: DAY_URL, documents });

const FULL_DAY: TripDayPrintTimelineEntry[] = [
  { kind: "previousStay", stay: stay({ name: "Guesthouse Zero", checkOutTime: "10:00" }) },
  segment("car", 80, 85),
  {
    kind: "planItem",
    item: item({
      title: "Glacier walk",
      fromTime: "11:30",
      toTime: "14:00",
      durationMinutes: 150,
      location: { lat: 1, lng: 2, label: "Sólheimajökull" },
      contentJson: planText("Bring crampons"),
    }),
  },
  segment("flight", 45, 800),
  { kind: "planItem", item: item({ title: "Late dinner", fromTime: null, toTime: null, durationMinutes: 90 }) },
  { kind: "currentStay", stay: stay({ name: "Hotel Vík", checkInTime: "15:00", notes: "Ask for the sea view" }) },
];

describe("buildDayEmail", () => {
  it("names the trip and the long date in the subject", () => {
    const mail = build(payload(FULL_DAY));
    expect(mail.subject).toBe("Day plan: Iceland, Sunday, August 9, 2026");
  });

  it("lists the entries in timeline order in both parts", () => {
    const mail = build(payload(FULL_DAY));
    const names = ["Guesthouse Zero", "Car", "Glacier walk", "Flight", "Late dinner", "Hotel Vík"];
    for (const part of [mail.text, mail.html]) {
      const positions = names.map((name) => part.indexOf(name));
      expect(positions.every((position) => position >= 0), part).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it("carries the heading, stays, times, duration, place and plan text", () => {
    const mail = build(payload(FULL_DAY));
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("Iceland");
      expect(part).toContain("Day 3: Ring road");
      expect(part).toContain("Sunday, August 9, 2026");
      expect(part).toContain("Previous night accommodation");
      expect(part).toContain("Check-out: 10:00");
      expect(part).toContain("11:30 – 14:00");
      expect(part).toContain("2h 30m");
      expect(part).toContain("Sólheimajökull");
      expect(part).toContain("Bring crampons");
      expect(part).toContain("Check-in: 15:00");
      expect(part).toContain("Ask for the sea view");
    }
    expect(mail.text).toContain("Tonight's accommodation");
    expect(mail.html).toContain("Tonight&#39;s accommodation");
  });

  it("describes legs with mode, duration, distance where allowed, and from → to", () => {
    const mail = build(payload(FULL_DAY));
    expect(mail.text).toContain("Car · 1h 20m · 85 km");
    expect(mail.text).toContain("Guesthouse Zero → Glacier walk");
    // A flight cannot carry a distance, whatever the row holds - the print sheet's rule.
    expect(mail.text).toContain("Flight · 45m");
    expect(mail.text).not.toContain("800 km");
    expect(mail.text).toContain("Glacier walk → Late dinner");
    expect(mail.html).toContain("Guesthouse Zero → Glacier walk");
  });

  it("shows only the duration for an activity that does not fit the day", () => {
    const mail = build(payload(FULL_DAY));
    const block = mail.text.slice(mail.text.indexOf("Late dinner") - 40, mail.text.indexOf("Late dinner"));
    expect(block).not.toMatch(/\d\d:\d\d/);
    expect(mail.text).toMatch(/1h 30m\nLate dinner/);
  });

  it("names an untitled activity like the print sheet does", () => {
    const mail = build(payload([{ kind: "planItem", item: item({ title: null }) }]));
    expect(mail.text).toContain("Plan item 1");
  });

  it("does not truncate the plan text", () => {
    const long = "x".repeat(450);
    const mail = build(payload([{ kind: "planItem", item: item({ contentJson: planText(long) }) }]));
    expect(mail.text).toContain(long);
    expect(mail.html).toContain(long);
  });

  it("says when the day has nothing recorded", () => {
    const mail = build(payload([]));
    expect(mail.text).toContain("No details recorded for this day.");
  });

  it("puts the day link in both parts", () => {
    const mail = build(payload(FULL_DAY));
    expect(mail.text).toContain(DAY_URL);
    expect(mail.html).toContain(`href="${DAY_URL}"`);
  });

  it.each([
    ["attached", "The day's documents are attached as one PDF."],
    ["tooLarge", "The day's documents were too large for email. You can download them on the day page via the link."],
    ["none", "This day has no documents."],
  ] as const)("says the %s documents sentence", (documents, sentence) => {
    const mail = build(payload(FULL_DAY), "en", documents);
    expect(mail.text).toContain(sentence);
    expect(mail.html).toContain(sentence.replace("'", "&#39;"));
  });

  it("escapes hostile user text in the HTML and leaves it raw in the text", () => {
    const hostile = `<script>alert(1)</script>"><img src=x onerror=alert(2)> & co`;
    const p = payload(
      [
        { kind: "previousStay", stay: stay({ name: hostile }) },
        { kind: "planItem", item: item({ title: hostile, contentJson: planText(hostile), location: { lat: 0, lng: 0, label: hostile } }) },
        { kind: "currentStay", stay: stay({ name: hostile, notes: hostile }) },
      ],
      { name: hostile },
    );
    (p.day as { note: string | null }).note = hostile;
    const mail = build(p, "en", "tooLarge");

    expect(mail.text).toContain(hostile);
    expect(mail.html).not.toContain("<script");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=alert(2)&gt; &amp; co");
  });

  it("escapes the link inside the href", () => {
    const mail = buildDayEmail({
      payload: payload([]),
      language: "en",
      t: tFor("en"),
      dayUrl: `https://x.test/a?b=1&c="2"`,
      documents: "none",
    });
    expect(mail.html).toContain(`href="https://x.test/a?b=1&amp;c=&quot;2&quot;"`);
  });

  it("loads nothing from anywhere: no images, links, styles, scripts, fonts or other URLs", () => {
    const mail = build(payload(FULL_DAY), "en", "attached");
    for (const forbidden of ["<img", "<script", "<link", "<style", "url(", "@import", "<iframe"]) {
      expect(mail.html, forbidden).not.toContain(forbidden);
    }
    const urls = mail.html.match(/https?:\/\/[^\s"<]+/g) ?? [];
    expect(new Set(urls)).toEqual(new Set([DAY_URL]));
    expect(mail.html).toContain("max-width:600px");
    expect(mail.html).toContain('<meta charset="utf-8">');
  });

  it("speaks German when asked to", () => {
    const mail = build(payload(FULL_DAY), "de", "attached");
    expect(mail.subject).toBe("Tagesplan: Iceland, Sonntag, 9. August 2026");
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("Tag 3: Ring road");
      expect(part).toContain("Unterkunft der Vornacht");
      expect(part).toContain("Unterkunft heute Nacht");
      expect(part).toContain(`${dictionaries.de["trips.travelSegment.transport.car"]} · 1 Std. 20 Min. · 85 km`);
      expect(part).toContain("Die Dokumente des Tages hängen als ein PDF an.");
      expect(part).toContain("Diesen Tag in TravelPlan öffnen");
    }
  });

  it("prints an unknown transport type raw rather than a dictionary key", () => {
    const mail = build(payload([segment("hovercraft", 30, null)]));
    expect(mail.text).toContain("hovercraft · 30m");
    expect(mail.text).not.toContain("trips.travelSegment");
  });
});
