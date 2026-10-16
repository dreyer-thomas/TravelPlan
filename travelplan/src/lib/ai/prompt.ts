import "server-only";
import type { DaySuggestionContext, DaySuggestionPlace } from "@/lib/repositories/tripRepo";
import type { SuggestionMode } from "@/lib/validation/daySuggestionSchemas";

/**
 * Story 12.1. The words sent to Claude for one day-suggestion search, as a pure function so the privacy
 * rule can be tested on its output.
 *
 * **What is sent** is exactly the PRD's domain note: the day's date, the start and end places (names and
 * coordinates), the free-text wish, the travel mode and the titles of the day's existing activities. The
 * input type is `DaySuggestionContext`, which carries nothing else, so no user, trip name, member, note,
 * cost or link can reach this function, let alone the request.
 *
 * **The system prompt is constant.** Everything day-specific goes into the user message, so the system
 * prompt is a stable prefix that a later story can cache without touching this one.
 *
 * The field list is spelled out even though `output_config.format` already constrains the answer: if the
 * API turns out not to accept a JSON schema alongside web search (Story 12.1 Task 1, still open), the
 * request drops the format and these sentences are the only description of the shape left.
 */

export const SUGGESTION_SYSTEM_PROMPT = `You suggest stops for one day of a trip: concrete, real places or activities that are open on the given date.

Rules:
- Every suggestion must be a findable place with a precise label a geocoder can resolve, for example "Neues Museum, Bodestraße 1, Berlin", never "a nice museum".
- Use web search to check opening hours, closures and events on the given date. Leave out anything closed that day.
- Give a realistic visit duration in minutes.
- Respect the travel mode you are given. Its distances are guidance for choosing places, not a hard limit.
- Do not suggest any of the day's existing activities again.
- Write titles and descriptions in the language of the traveller's wish.
- Return between 3 and 8 suggestions.

Answer with JSON only: an object with a "suggestions" array. Each entry has:
- "title": a short name for the stop.
- "description": two or three sentences on why it fits the wish, about 600 characters at most.
- "locationLabel": the precise, geocodable place label described above.
- "lat", "lng": the place's coordinates in decimal degrees.
- "durationMinutes": a realistic visit length, a whole number of minutes.
- "wikiTitle": the exact title of the place's Wikipedia article, if it has one; otherwise omit it.`;

const MODE_MEANING: Record<SuggestionMode, string> = {
  car: "car - anywhere sensible between or around the start and the end, with reasonable detours.",
  walking: "walking - stops within comfortable walking distance (about 3 km) of the start or the end.",
  cycling: "cycling - stops within about 15 km by bike of the start or the end.",
};

/**
 * Other trip members write activity titles, so each one is put on a single line (a newline could
 * otherwise start a heading of its own, such as "The traveller's wish:") and cut to 200 characters,
 * and at most `MAX_EXISTING_TITLES` are listed, so a very full day cannot inflate the paid prompt.
 */
export const MAX_EXISTING_TITLES = 50;
const EXISTING_TITLE_MAX_LENGTH = 200;

const listExistingTitles = (titles: string[]) => {
  const lines = titles
    .map((title) => title.replace(/\s+/g, " ").trim().slice(0, EXISTING_TITLE_MAX_LENGTH))
    .filter((title) => title.length > 0)
    .slice(0, MAX_EXISTING_TITLES)
    .map((title) => `- ${title}`);
  return lines.length > 0 ? lines.join("\n") : "none";
};

const describePlace = (place: DaySuggestionPlace) => {
  const coordinates = place.lat !== null && place.lng !== null ? `(${place.lat}, ${place.lng})` : "";
  return [place.label, coordinates].filter((part) => part.length > 0).join(" ");
};

export const buildSuggestionPrompt = (
  context: DaySuggestionContext,
  { prompt, mode }: { prompt: string; mode: SuggestionMode },
) => {
  const existing = listExistingTitles(context.existingTitles);

  const user = [
    `Date: ${context.date}`,
    `Start: ${context.start ? describePlace(context.start) : "unknown"}`,
    `End: ${context.end ? describePlace(context.end) : "none"}`,
    `Travel mode: ${MODE_MEANING[mode]}`,
    `Existing activities (do not suggest these again):\n${existing}`,
    `The traveller's wish:\n${prompt}`,
  ].join("\n\n");

  return { system: SUGGESTION_SYSTEM_PROMPT, user };
};
