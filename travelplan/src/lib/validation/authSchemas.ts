import { z } from "zod";

export const normalizedEmailSchema = z.string().trim().toLowerCase().email("Enter a valid email");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

export const registerSchema = z.object({
  email: normalizedEmailSchema,
  password: passwordSchema,
  consent: z.literal(true, { message: "Consent is required" }),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z.object({
  email: normalizedEmailSchema,
});

export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(1, "Reset token is required"),
  password: passwordSchema,
});

export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;

export const firstLoginPasswordSchema = z.object({
  password: passwordSchema,
});

export type FirstLoginPasswordInput = z.infer<typeof firstLoginPasswordSchema>;
