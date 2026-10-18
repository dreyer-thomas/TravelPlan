/**
 * Story 14.1 (FR30). The text a former bucket-list entry carries as a parked activity's `contentJson`.
 *
 * It is the client builder `TripDayView` used until 14.1 (`buildBucketListContentJson`) moved here
 * unchanged, because two places must produce exactly its output: the migration
 * `20261018120000_day_plan_items_without_day` (in SQL) and the backup import of a legacy
 * `bucketListItems` list (here). The migration test runs both and compares them byte for byte.
 *
 * - The description and the position text are trimmed (`String.prototype.trim`).
 * - The position text is kept only when the entry had no coordinates; with coordinates it was the
 *   place's name and is already the activity's place.
 * - With neither, the trimmed title is the text.
 *
 * Pure: no Prisma, no `server-only`.
 */
export type ParkedContentSource = {
  title: string;
  description: string | null;
  positionText: string | null;
  hasCoordinates: boolean;
};

export const buildParkedContentJson = (source: ParkedContentSource): string => {
  const description = source.description?.trim() ?? "";
  const positionText = source.positionText?.trim() ?? "";
  const includePositionText = !source.hasCoordinates && positionText.length > 0;
  const parts = [description, includePositionText ? positionText : ""].filter((value) => value.length > 0);
  const content = parts.length > 0 ? parts : [source.title.trim()];
  return JSON.stringify({
    type: "doc",
    content: content.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  });
};
