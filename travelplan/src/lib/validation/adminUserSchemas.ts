import { z } from "zod";
import { normalizedEmailSchema, passwordSchema } from "@/lib/validation/authSchemas";

/**
 * Story 5.10's request bodies.
 *
 * `normalizedEmailSchema` and `passwordSchema` are the same ones registration and the trip-share invite
 * use, so an admin-created account is held to the identical email shape and 8-72 character password as a
 * self-registered or invited one. AC4's "reusing the mechanism Story 5.1 built" applies to the validation
 * as much as to the insert.
 */
export const createAdminUserSchema = z.object({
  email: normalizedEmailSchema,
  // Required here, unlike on the trip-share invite where it is optional because that path may find an
  // existing account instead of creating one. This action only ever creates.
  temporaryPassword: passwordSchema,
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

/**
 * `isAdmin` as a boolean rather than a `role` string: `ADMIN` is the only `UserRole` this surface may
 * assign, and accepting `role: "VIEWER" | "OWNER" | "ADMIN"` would invite it to set the account-level
 * role to a value nothing in the app reads, in a place that looks like it should mean something.
 */
export const updateAdminUserRoleSchema = z.object({
  isAdmin: z.boolean(),
});

export type UpdateAdminUserRoleInput = z.infer<typeof updateAdminUserRoleSchema>;

/**
 * Membership roles are the `TripMemberRole` enum's own values, upper-case, because this surface shows and
 * sets them directly. The trip-share dialog's `tripMemberRoleSchema` uses lower-case `viewer` /
 * `contributor` and converts - a client-facing vocabulary from Story 5.1 that is not worth propagating
 * into a second surface, and not worth churning in the first.
 */
export const adminMembershipRoleSchema = z.enum(["VIEWER", "CONTRIBUTOR"], {
  message: "Select a valid membership role",
});

// Bounded like every other id in this app's schemas: these are fixed-length cuids, so an unbounded string
// only ever reaches Prisma as an oversized query parameter.
const idSchema = z.string().trim().min(1).max(64);

export const setAdminMembershipSchema = z.object({
  tripId: idSchema,
  role: adminMembershipRoleSchema,
});

export type SetAdminMembershipInput = z.infer<typeof setAdminMembershipSchema>;

export const removeAdminMembershipSchema = z.object({
  tripId: idSchema,
});

export type RemoveAdminMembershipInput = z.infer<typeof removeAdminMembershipSchema>;
