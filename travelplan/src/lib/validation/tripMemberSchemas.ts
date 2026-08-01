import { z } from "zod";
import { normalizedEmailSchema, passwordSchema } from "@/lib/validation/authSchemas";

export const tripMemberRoleSchema = z.enum(["viewer", "contributor"], {
  message: "Select a valid collaborator role",
});

export const createTripMemberSchema = z.object({
  email: normalizedEmailSchema,
  role: tripMemberRoleSchema,
  temporaryPassword: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      return normalized.length === 0 ? undefined : normalized;
    },
    passwordSchema.optional(),
  ),
});

export type CreateTripMemberInput = z.infer<typeof createTripMemberSchema>;

export const deleteTripMemberSchema = z.object({
  // Bounded like its siblings: member ids are fixed-length cuids, so an unbounded string only ever
  // reaches Prisma as an oversized query parameter.
  memberId: z.string().trim().min(1).max(64),
});

export type DeleteTripMemberInput = z.infer<typeof deleteTripMemberSchema>;
