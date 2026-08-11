import { z } from "zod";

const imageUrlSchema = z
  .string()
  .trim()
  .max(2000, "Image URL must be at most 2000 characters")
  .refine(
    (value) => {
      if (value.startsWith("/uploads/")) return true;
      return z.string().url().safeParse(value).success;
    },
    { message: "Image URL must be a valid URL" },
  );

const dayNoteSchema = z.string().trim().max(280, "Day note must be at most 280 characters");

export const dayImageUpdateSchema = z.object({
  /**
   * Optional since Story 8.4: absent means "leave the image alone", which is what a note-only save
   * sends.
   *
   * It used to be required, so the day-meta dialog resent `imageUrl: day.imageUrl ?? null` out of local
   * state on every save. That was harmless while the route's cleanup only fired for `null` or an
   * out-of-directory value; once the cleanup unlinks the previous file on any change of URL, a stale
   * local value set the row back *and* deleted the file the day was displaying. The repository already
   * skips the column when this is `undefined`, so omitting it is a real no-op rather than a write of the
   * same value.
   */
  imageUrl: z.union([imageUrlSchema, z.null()]).optional(),
  note: z.union([dayNoteSchema, z.null()]).optional(),
})
  .refine((body) => body.imageUrl !== undefined || body.note !== undefined, {
    // Both fields became optional in Story 8.4, which made `{}` parse. The repository builds its `SET`
    // clauses from whichever fields are present and skips the `UPDATE` entirely when there are none, so
    // an empty body would answer `200` for a save that wrote nothing - a success the client would render
    // as "saved". A request that asks for no change is a malformed request, not a no-op.
    message: "Provide an image url or a note to update",
  });

export type DayImageUpdateInput = z.infer<typeof dayImageUpdateSchema>;
