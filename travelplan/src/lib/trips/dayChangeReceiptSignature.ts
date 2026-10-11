import crypto from "crypto";
import type { DayChangeReceiptWire, SignedDayChangeReceiptWire } from "@/lib/trips/dayChangeReceipt";

/**
 * Story 11.1 review (AC12). A change receipt travels to the client and comes back in the undo request,
 * so without a seal the undo endpoint would write whatever the client claims the day used to hold — a
 * made-up leg between two stops that are not next to each other, an idea no create ever consumed, a
 * media row pointing at another activity's file. The write route signs the receipt it issues; the undo
 * route refuses one whose signature does not match (`400 validation_error`), so undo can only ever
 * restore what a write on this trip, by this user, actually removed.
 *
 * Server-only (Node `crypto`): the day view imports `dayChangeReceipt.ts`, never this module.
 *
 * - **Key:** derived from `JWT_SECRET` with a purpose label, so a receipt MAC can never be mistaken for,
 *   or used to forge, anything else signed with that secret.
 * - **Binding:** the trip and the user are part of the signed message. A receipt cannot be replayed under
 *   another trip's URL, or by another member.
 * - **Canonical form:** keys sorted at every level. The undo route checks the receipt *after* the Zod
 *   parse, and Zod rebuilds objects in schema order, so insertion order cannot be what is signed.
 */

const getReceiptKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return crypto.createHmac("sha256", secret).update("travelplan:day-change-receipt:v1").digest();
};

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const computeSignature = (receipt: DayChangeReceiptWire, binding: { tripId: string; userId: string }) =>
  crypto
    .createHmac("sha256", getReceiptKey())
    .update(canonicalize({ tripId: binding.tripId, userId: binding.userId, receipt }))
    .digest("hex");

export const signDayChangeReceipt = (
  receipt: DayChangeReceiptWire,
  binding: { tripId: string; userId: string },
): SignedDayChangeReceiptWire => ({ ...receipt, signature: computeSignature(receipt, binding) });

/** Constant-time. Takes the signed wire form and splits the signature off itself. */
export const verifyDayChangeReceipt = (
  signed: SignedDayChangeReceiptWire,
  binding: { tripId: string; userId: string },
): DayChangeReceiptWire | null => {
  const { signature, ...receipt } = signed;
  const expected = Buffer.from(computeSignature(receipt, binding), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  return receipt;
};
