-- Story 15.3. The redirect URI of the consent that created a token family, copied onto every token of the
-- family so Connected apps can show where the connection returns to. Nullable: families issued before this
-- migration have no value and are shown with the host `—`.
--
-- Additive only. Written as Prisma generates it from `schema.prisma`.

-- AlterTable
ALTER TABLE "oauth_tokens" ADD COLUMN "redirect_uri" TEXT;
