import { SignJWT, jwtVerify } from "jose";

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
};

export const createSessionJwt = async (payload: { sub: string; role: string }) => {
  const secret = getJwtSecret();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
};

export const verifySessionJwt = async (token: string) => {
  const secret = getJwtSecret();
  const { payload } = await jwtVerify(token, secret);
  return payload as { sub: string; role: string };
};
