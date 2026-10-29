import crypto from "crypto";

/** 32 random bytes, base64url: authorization codes, access and refresh tokens. */
export const generateOpaqueToken = () => crypto.randomBytes(32).toString("base64url");

/** Only this hash is stored, the same scheme as `hashPasswordResetToken`. */
export const hashOpaqueToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
