import { describe, expect, it } from "vitest";
import { registerSchema } from "@/lib/validation/authSchemas";

describe("registerSchema", () => {
  it("accepts a valid payload", () => {
    const result = registerSchema.safeParse({
      email: "USER@Example.com",
      password: "strongpassword",
      consent: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      email: "invalid-email",
      password: "strongpassword",
      consent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toBeDefined();
    }
  });

  it("rejects weak password", () => {
    const result = registerSchema.safeParse({
      email: "valid@example.com",
      password: "short",
      consent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.password?.[0]).toBeDefined();
    }
  });

  it("requires consent", () => {
    const result = registerSchema.safeParse({
      email: "valid@example.com",
      password: "strongpassword",
      consent: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.consent?.[0]).toBeDefined();
    }
  });
});
