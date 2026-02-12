import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";

const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_MINUTES = 60;

export const hashPasswordResetToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const createPasswordResetToken = async (userId: string) => {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      used: false,
    },
  });

  return rawToken;
};

export const getPasswordResetToken = async (rawToken: string) => {
  const tokenHash = hashPasswordResetToken(rawToken);
  return prisma.passwordResetToken.findUnique({ where: { tokenHash } });
};
