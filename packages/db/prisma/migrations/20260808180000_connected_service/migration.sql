-- A third-party service connected with the user's own API key.
--
-- One row per provider, so a second integration needs no migration. The key is
-- stored encrypted rather than in plain text because the database is dumped to
-- files that get downloaded over the API, uploaded from other machines, and
-- kept in cloud storage — a plaintext key would travel in all of them.
--
-- Additive: a new table only. Nothing existing is read or rewritten, so this is
-- safe to apply while a client generated before it keeps serving.
CREATE TABLE "ConnectedService" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "secretCipher" TEXT NOT NULL,
  "secretIv" TEXT NOT NULL,
  "secretTag" TEXT NOT NULL,
  "hint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectedService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectedService_provider_key" ON "ConnectedService"("provider");
