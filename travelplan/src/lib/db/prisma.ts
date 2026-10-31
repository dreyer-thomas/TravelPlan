import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaTag?: string;
};

/**
 * Bumped by Story 5.10 for `UserRole.ADMIN`.
 *
 * This is the one kind of schema change `cachedClientMatchesCurrentSchema` below cannot see: it probes
 * for *fields*, and a new enum member adds none. A dev server holding a client generated before the
 * member exists rejects `role: "ADMIN"` in its own validation layer, before any SQL is sent - so the
 * tag is what forces the rebuild here, not the field probe.
 *
 * Bumped again by Story 15.1 for the connector tables (new models; the field probe covers them too),
 * and by Story 15.9 for `TripDay.aiChangedAt`.
 */
const PRISMA_SCHEMA_TAG = "2026-10-31-trip-day-ai-marker";

const getDatabaseUrl = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  return url;
};

const createPrismaClient = () => {
  const adapter = new PrismaBetterSqlite3({ url: getDatabaseUrl() });
  const client = new PrismaClient({
    adapter,
    log: ["error"],
  });

  return client;
};

const cachedClientMatchesCurrentSchema = (client: PrismaClient | undefined) => {
  if (!client) return false;

  const runtimeModel = (
    client as PrismaClient & {
      _runtimeDataModel?: {
        models?: Record<string, { fields?: Array<{ name?: string }> }>;
      };
    }
  )._runtimeDataModel;

  const costPaymentFields = runtimeModel?.models?.CostPayment?.fields ?? [];
  const userFields = runtimeModel?.models?.User?.fields ?? [];
  const tripMemberFields = runtimeModel?.models?.TripMember?.fields ?? [];
  // Story 15.1: a client generated before the connector tables has no `OAuthToken` model at all.
  const oauthTokenFields = runtimeModel?.models?.OAuthToken?.fields ?? [];
  // Story 15.9: the day's own KI/AI marker.
  const tripDayFields = runtimeModel?.models?.TripDay?.fields ?? [];

  return (
    costPaymentFields.some((field) => field.name === "sortOrder") &&
    userFields.some((field) => field.name === "mustChangePassword") &&
    tripMemberFields.some((field) => field.name === "role") &&
    oauthTokenFields.some((field) => field.name === "familyId") &&
    tripDayFields.some((field) => field.name === "aiChangedAt")
  );
};

const shouldReuseCachedClient =
  globalForPrisma.prismaSchemaTag === PRISMA_SCHEMA_TAG && cachedClientMatchesCurrentSchema(globalForPrisma.prisma);

if (!shouldReuseCachedClient && globalForPrisma.prisma) {
  void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaTag = PRISMA_SCHEMA_TAG;
}
