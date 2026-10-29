-- Story 15.1. OAuth state for the MCP connector: authorization codes and opaque access/refresh tokens,
-- stored only as SHA-256 hashes. `family_id` ties every token of one connection (one consent) together so
-- revocation and refresh-reuse detection act on the whole connection. Clients are identified by their
-- metadata-document URL (`client_id`), so there is no client table. Both tables cascade from `users`.
--
-- Additive only. Written as Prisma generates it from `schema.prisma`; the unrelated table redefinitions
-- `prisma migrate diff` also prints for `cost_payments` and `trip_members` predate this story and are not
-- part of it.

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "family_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "family_expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME,
    "rotated_at" DATETIME,
    "revoked_at" DATETIME,
    CONSTRAINT "oauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_key" ON "oauth_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "idx_oauth_authorization_codes_expires_at" ON "oauth_authorization_codes"("expires_at");

-- CreateIndex
CREATE INDEX "idx_oauth_authorization_codes_user_id" ON "oauth_authorization_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_oauth_tokens_family_id" ON "oauth_tokens"("family_id");

-- CreateIndex
CREATE INDEX "idx_oauth_tokens_user_id" ON "oauth_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_oauth_tokens_expires_at" ON "oauth_tokens"("expires_at");
