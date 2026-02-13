import { z } from "zod";

export const updateLanguageSchema = z.object({
  preferredLanguage: z.enum(["en", "de"]),
});

export type UpdateLanguageInput = z.infer<typeof updateLanguageSchema>;
