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
  imageUrl: z.union([imageUrlSchema, z.null()]),
  note: z.union([dayNoteSchema, z.null()]).optional(),
});

export type DayImageUpdateInput = z.infer<typeof dayImageUpdateSchema>;
