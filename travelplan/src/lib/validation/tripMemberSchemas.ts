import { z } from "zod";
import { normalizedEmailSchema, passwordSchema } from "@/lib/validation/authSchemas";

export const tripMemberRoleSchema = z.enum(["viewer", "contributor"], {
  message: "Select a valid collaborator role",
});

export const createTripMemberSchema = z.object({
  email: normalizedEmailSchema,
  role: tripMemberRoleSchema,
  temporaryPassword: passwordSchema,
});

export type CreateTripMemberInput = z.infer<typeof createTripMemberSchema>;
