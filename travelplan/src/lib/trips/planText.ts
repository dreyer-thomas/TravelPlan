/**
 * Flattens a TipTap rich-text document (`contentJson`) to the plain text every surface uses as a
 * label or a preview when a plan item has no title.
 *
 * **Why it lives here rather than in `TripDayPlanItemContent.tsx`, where it was written.** That module
 * is `"use client"`, which makes every export from it a *client reference* rather than a function: an
 * import of it from server code compiles, and then throws at call time. Story 9.2's packet route runs
 * on the server and has to derive the same labels the printed sheet shows - so the function had to move
 * somewhere both runtimes can call it. `TripDayPlanItemContent.tsx` re-exports it verbatim, so its six
 * existing importers are unaffected and there is still exactly one definition.
 *
 * Moved unchanged, deliberately. The `catch` returning `""` is load-bearing: `contentJson` is a plain
 * `String` column with no shape guarantee, and every caller treats an empty string as "no text" and
 * falls back to a positional label. A throw here would take out the whole day view.
 */
export const parsePlanText = (value: string) => {
  try {
    const doc = JSON.parse(value);
    const parts: string[] = [];

    const walk = (node: { text?: string; content?: unknown[] }) => {
      if (!node) return;
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        node.content.forEach((child) => walk(child as { text?: string; content?: unknown[] }));
      }
    };

    walk(doc as { text?: string; content?: unknown[] });
    return parts.join(" ").trim();
  } catch {
    return "";
  }
};
