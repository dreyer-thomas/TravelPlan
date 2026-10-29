import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import {
  ACCESS_TOKEN_TTL_MS,
  CODE_TTL_MS,
  EXPIRED_ROW_RETENTION_MS,
  LAST_USED_WRITE_INTERVAL_MS,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
} from "@/lib/oauth/config";
import { verifyS256 } from "@/lib/oauth/pkce";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/oauth/secrets";

/**
 * Story 15.1. Every database access of the connector's OAuth server. Tokens and codes are opaque random
 * strings; only their SHA-256 hashes are stored (AC 13, AC 16).
 *
 * A **family** is one connection, created by one consent. Every token issued from it carries its
 * `familyId`; revocation marks the whole family (`revokedAt`), it does not delete it, so a rotated refresh
 * token presented later is still recognised as reuse. A family never lives longer than 30 days from consent
 * (`familyExpiresAt`): rotation does not extend it.
 */

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

export type TokenGrantResult = { ok: true; tokens: IssuedTokens } | { ok: false; error: "invalid_grant"; description: string };

type FamilyFields = {
  familyId: string;
  userId: string;
  clientId: string;
  clientName: string;
  scope: string;
  resource: string;
  /** Story 15.3. Copied from the code at consent and carried by rotation; null only on pre-15.3 families. */
  redirectUri: string | null;
  familyExpiresAt: Date;
};

export const createAuthorizationCode = async (input: {
  userId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  const code = generateOpaqueToken();
  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: hashOpaqueToken(code),
      userId: input.userId,
      clientId: input.clientId,
      clientName: input.clientName,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      scope: input.scope,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
  });
  return code;
};

const issueTokenPair = async (tx: TransactionClient, family: FamilyFields, now: Date): Promise<IssuedTokens> => {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  // Neither token outlives the connection: both are capped at the family's 30-day end.
  const familyEnd = family.familyExpiresAt.getTime();
  const accessExpiresAt = new Date(Math.min(now.getTime() + ACCESS_TOKEN_TTL_MS, familyEnd));
  const refreshExpiresAt = new Date(Math.min(now.getTime() + REFRESH_TOKEN_TTL_MS, familyEnd));
  await tx.oAuthToken.createMany({
    data: [
      { ...family, tokenHash: hashOpaqueToken(accessToken), kind: "ACCESS", expiresAt: accessExpiresAt, createdAt: now },
      { ...family, tokenHash: hashOpaqueToken(refreshToken), kind: "REFRESH", expiresAt: refreshExpiresAt, createdAt: now },
    ],
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: Math.max(0, Math.floor((accessExpiresAt.getTime() - now.getTime()) / 1000)),
    scope: family.scope,
  };
};

const revokeFamily = (tx: TransactionClient, familyId: string, now: Date) =>
  tx.oAuthToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });

const invalidGrant = (description: string): TokenGrantResult => ({ ok: false, error: "invalid_grant", description });

/**
 * AC 13-14. One transaction: check the code and every binding, mark it used, create the family. A code
 * presented again revokes the family it issued (RFC 6749 §4.1.2); that revocation commits even though the
 * grant fails, because the callback returns rather than throws.
 */
export const exchangeAuthorizationCode = async (input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
  now?: Date;
}): Promise<TokenGrantResult> => {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashOpaqueToken(input.code) } });
    if (!row) return invalidGrant("Unknown authorization code");
    if (row.usedAt) {
      if (row.familyId) await revokeFamily(tx, row.familyId, now);
      return invalidGrant("Authorization code already used");
    }
    if (row.expiresAt.getTime() <= now.getTime()) return invalidGrant("Authorization code expired");
    if (row.clientId !== input.clientId) return invalidGrant("client_id does not match the code");
    if (row.redirectUri !== input.redirectUri) return invalidGrant("redirect_uri does not match the code");
    if (row.resource !== input.resource) return invalidGrant("resource does not match the code");
    if (!verifyS256(input.codeVerifier, row.codeChallenge)) return invalidGrant("PKCE verification failed");

    const familyId = crypto.randomUUID();
    // Marked used only when the exchange succeeds: a failed attempt with a wrong verifier must not let an
    // attacker burn the legitimate client's code, and the 60 s lifetime bounds guessing.
    const marked = await tx.oAuthAuthorizationCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now, familyId },
    });
    if (marked.count !== 1) return invalidGrant("Authorization code already used");

    const tokens = await issueTokenPair(
      tx,
      {
        familyId,
        userId: row.userId,
        clientId: row.clientId,
        clientName: row.clientName,
        scope: row.scope,
        resource: row.resource,
        redirectUri: row.redirectUri,
        familyExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      },
      now,
    );
    return { ok: true, tokens };
  });
};

/**
 * AC 15. Rotation with reuse detection and a grace window: Claude refreshes proactively and can send the
 * same refresh token twice in parallel, which must not cut the connection. A rotated token seen again within
 * 30 s of its rotation gets a fresh sibling pair in the same family (review D2, Tommy 2026-10-29) - an
 * `invalid_grant` there would make a client that processes that answer last drop the connection. Seen later,
 * it is treated as stolen and the whole family is revoked.
 */
export const rotateRefreshToken = async (input: {
  refreshToken: string;
  clientId: string;
  resource: string | null;
  now?: Date;
}): Promise<TokenGrantResult> => {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.oAuthToken.findUnique({ where: { tokenHash: hashOpaqueToken(input.refreshToken) } });
    if (!row || row.kind !== "REFRESH") return invalidGrant("Unknown refresh token");
    if (row.revokedAt) return invalidGrant("Refresh token revoked");
    if (row.rotatedAt && now.getTime() - row.rotatedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
      await revokeFamily(tx, row.familyId, now);
      return invalidGrant("Refresh token already used");
    }
    if (row.expiresAt.getTime() <= now.getTime()) return invalidGrant("Refresh token expired");
    if (row.clientId !== input.clientId) return invalidGrant("client_id does not match the token");
    if (input.resource !== null && input.resource !== row.resource) return invalidGrant("resource does not match the token");

    if (!row.rotatedAt) {
      const marked = await tx.oAuthToken.updateMany({
        where: { id: row.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now, lastUsedAt: now },
      });
      if (marked.count !== 1) return invalidGrant("Refresh token already used");
    }
    // A revoke that landed between the read above and here must win: no fresh pair for a dead family.
    const revoked = await tx.oAuthToken.count({ where: { familyId: row.familyId, revokedAt: { not: null } } });
    if (revoked > 0) return invalidGrant("Refresh token revoked");

    const tokens = await issueTokenPair(
      tx,
      {
        familyId: row.familyId,
        userId: row.userId,
        clientId: row.clientId,
        clientName: row.clientName,
        scope: row.scope,
        resource: row.resource,
        redirectUri: row.redirectUri,
        familyExpiresAt: row.familyExpiresAt,
      },
      now,
    );
    return { ok: true, tokens };
  });
};

export type ActiveAccessToken = {
  id: string;
  userId: string;
  clientId: string;
  scope: string;
  resource: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
};

/** The bearer check on `/api/mcp`: an unrevoked, unexpired access token. Refresh tokens never pass. */
export const findActiveAccessToken = async (token: string, now: Date = new Date()): Promise<ActiveAccessToken | null> => {
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: {
      id: true,
      kind: true,
      userId: true,
      clientId: true,
      scope: true,
      resource: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });
  if (!row || row.kind !== "ACCESS" || row.revokedAt) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return {
    id: row.id,
    userId: row.userId,
    clientId: row.clientId,
    scope: row.scope,
    resource: row.resource,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
  };
};

/** At most one write per token per five minutes; Story 15.3 shows "last used" per connection. */
export const touchTokenLastUsed = async (token: ActiveAccessToken, now: Date = new Date()) => {
  if (token.lastUsedAt && now.getTime() - token.lastUsedAt.getTime() < LAST_USED_WRITE_INTERVAL_MS) return;
  await prisma.oAuthToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
};

/**
 * RFC 7009: revoking either token of a connection ends the whole connection. Unknown tokens are ignored,
 * and so is a token that belongs to another client than the one named (§2.1); both still answer 200.
 * Inside a transaction so it takes the adapter's transaction lock and cannot interleave with a rotation
 * that is about to create the family's next pair.
 */
export const revokeFamilyByToken = async (token: string, clientId: string | null, now: Date = new Date()) =>
  prisma.$transaction(async (tx) => {
    const row = await tx.oAuthToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      select: { familyId: true, clientId: true },
    });
    if (!row || (clientId !== null && clientId !== row.clientId)) return;
    await revokeFamily(tx, row.familyId, now);
  });

export type ConnectionSummary = {
  /** The family id: one connection, one consent. */
  id: string;
  clientName: string;
  /** Host of the consent's redirect URI; null for families issued before Story 15.3 stored it. */
  redirectHost: string | null;
  connectedAt: Date;
  lastUsedAt: Date | null;
};

const hostOf = (redirectUri: string | null) => {
  if (!redirectUri) return null;
  try {
    return new URL(redirectUri).host || null;
  } catch {
    return null;
  }
};

/**
 * Story 15.3. The user's active connections for *Connected apps*, newest first, one entry per family.
 *
 * A family is active while one of its rows is unrevoked and the family itself has not reached its 30-day
 * end. Revocation always marks every row of a family at once, so "one unrevoked row" is the same as "the
 * family is not revoked"; the per-row `expiresAt` is deliberately not consulted, because an access token
 * that ran out after an hour does not end a connection whose refresh token is still good.
 *
 * *Connected since* is derived from `familyExpiresAt` rather than the oldest `createdAt`: housekeeping
 * deletes expired rows a day after expiry, so a family's first pair is gone within about a day of
 * rotating, while `familyExpiresAt` is fixed at consent and rotation never moves it. *Last used* is the
 * newest `lastUsedAt` over all of the family's rows - every access token of it writes its own.
 */
export const listConnectionsForUser = async (userId: string, now: Date = new Date()): Promise<ConnectionSummary[]> => {
  const rows = await prisma.oAuthToken.findMany({
    where: { userId, revokedAt: null, familyExpiresAt: { gt: now } },
    select: {
      familyId: true,
      clientName: true,
      redirectUri: true,
      familyExpiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const families = new Map<string, ConnectionSummary>();
  for (const row of rows) {
    const existing = families.get(row.familyId);
    if (!existing) {
      // Rows arrive newest first, so the first row seen carries the family's latest client name and host.
      families.set(row.familyId, {
        id: row.familyId,
        clientName: row.clientName,
        redirectHost: hostOf(row.redirectUri),
        connectedAt: new Date(row.familyExpiresAt.getTime() - REFRESH_TOKEN_TTL_MS),
        lastUsedAt: row.lastUsedAt,
      });
      continue;
    }
    if (row.lastUsedAt && (!existing.lastUsedAt || row.lastUsedAt > existing.lastUsedAt)) {
      existing.lastUsedAt = row.lastUsedAt;
    }
    if (!existing.redirectHost) existing.redirectHost = hostOf(row.redirectUri);
  }

  return [...families.values()].sort(
    (a, b) => b.connectedAt.getTime() - a.connectedAt.getTime() || a.id.localeCompare(b.id),
  );
};

/**
 * Story 15.3. *Disconnect*: marks every unrevoked row of the family revoked, scoped to the owner, in one
 * transaction like `revokeFamilyByToken` so it cannot interleave with a rotation creating the next pair.
 * Rows are marked, never deleted, so a refresh token presented afterwards is still recognised.
 *
 * Returns `false` for a family that is unknown, already revoked or another user's - the route answers all
 * of them with the same 404, so whether someone else's connection exists never leaks. The owner is part of
 * the `where`, not a check before it, so there is no read-then-write window for a foreign id to slip through.
 */
export const revokeConnectionForUser = async (userId: string, familyId: string, now: Date = new Date()) =>
  prisma.$transaction(async (tx) => {
    const revoked = await tx.oAuthToken.updateMany({
      where: { familyId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return revoked.count > 0;
  });

type OAuthTokenWriter = Pick<TransactionClient, "oAuthToken">;

/**
 * Story 15.3 (NFR14). Every connector token of the user revoked, for the two password writes. Takes the
 * caller's transaction client so the revocation commits or rolls back with the password itself: a failed
 * password write must not leave the user disconnected, and a successful one must not leave a connection
 * alive that was authorised under the old password. Also accepts the root client, which is what the
 * array-form `$transaction` in the reset route passes - the returned `PrismaPromise` is then one entry of
 * that batch rather than a write of its own.
 */
export const revokeAllTokensForUser = (client: OAuthTokenWriter, userId: string, now: Date = new Date()) =>
  client.oAuthToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });

type OAuthCodeWriter = Pick<TransactionClient, "oAuthAuthorizationCode">;

/**
 * Story 15.3 review. The other half of the password-write revocation: an authorization code consented to
 * under the old password but not yet exchanged (it lives 60 s) would otherwise mint a fresh family right
 * after the tokens above were revoked. Marking it used makes the exchange answer `invalid_grant`; no family
 * exists for it yet, so nothing else is revoked. Same client contract as `revokeAllTokensForUser`.
 */
export const invalidateUnusedCodesForUser = (client: OAuthCodeWriter, userId: string, now: Date = new Date()) =>
  client.oAuthAuthorizationCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });

let lastHousekeepingAt = 0;
const HOUSEKEEPING_INTERVAL_MS = 10 * 60 * 1000;

export const resetOAuthHousekeepingForTests = () => {
  lastHousekeepingAt = 0;
};

/**
 * AC 21. No scheduler: called after a successful token issue, at most once per ten minutes per process so
 * every refresh does not take SQLite's write lock twice more. Bounded by the expiry index.
 */
export const deleteExpiredOAuthRows = async (now: Date = new Date()) => {
  if (now.getTime() - lastHousekeepingAt < HOUSEKEEPING_INTERVAL_MS) return;
  lastHousekeepingAt = now.getTime();
  const cutoff = new Date(now.getTime() - EXPIRED_ROW_RETENTION_MS);
  await prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  await prisma.oAuthToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
};
