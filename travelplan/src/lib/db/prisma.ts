import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaTag?: string;
};

const PRISMA_SCHEMA_TAG = "2026-03-09-trip-feedback";

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
  const feedbackTargetFields = runtimeModel?.models?.TripFeedbackTarget?.fields ?? [];
  const feedbackVoteFields = runtimeModel?.models?.TripFeedbackVote?.fields ?? [];

  return (
    costPaymentFields.some((field) => field.name === "sortOrder") &&
    userFields.some((field) => field.name === "mustChangePassword") &&
    tripMemberFields.some((field) => field.name === "role") &&
    feedbackTargetFields.some((field) => field.name === "targetKey") &&
    feedbackVoteFields.some((field) => field.name === "value")
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
