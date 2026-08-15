-- Third-party API keys are stored as they are, not encrypted.
--
-- `secret-box.ts` encrypted them with AES-256-GCM under a key derived from an
-- `INTEGRATION_SECRET` environment variable. The threat it named was specific
-- and correct: **the database gets dumped to files that travel** — downloaded,
-- moved between machines, kept in cloud storage — and a plaintext key would ride
-- along in every one of them.
--
-- That threat is now closed at the source rather than by a cipher. Backups strip
-- `ConnectedService` and vacuum the freed pages, and the JSON export skips the
-- table outright. No artifact that leaves the machine carries a credential, so
-- there is nothing for the encryption to protect that is not already protected.
--
-- What it never defended against, and could not: someone reading the database
-- file itself. The key lived in the same process's environment, so anyone able
-- to read one could read the other. That was documented as an accepted limit.
-- Removing the cipher therefore costs nothing real, and removes the reason a
-- packaged desktop app — which has no `.env` for a service manager to load —
-- would otherwise refuse to store a key at all.
--
-- **The existing ciphertext cannot be carried across.** Decrypting needs the
-- AES key, and a migration is SQL. So the row is kept and its secret is cleared:
-- provider, timestamps and the row's identity survive, and the app reports the
-- service as not configured until the key is entered again. Nothing is deleted
-- and nothing misleads — a stale `hint` describing a key that can no longer be
-- used would be worse than an empty one. Production holds exactly one such row
-- (finnhub), and re-entering it takes seconds.

CREATE TABLE "ConnectedService_new" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    -- NULL means "the row exists but there is no usable key", which is exactly
    -- the state every pre-existing row lands in.
    "secret" TEXT,
    "hint" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

INSERT INTO "ConnectedService_new" ("id","provider","secret","hint","createdAt","updatedAt")
SELECT "id", "provider", NULL, '', "createdAt", "updatedAt" FROM "ConnectedService";

DROP TABLE "ConnectedService";
ALTER TABLE "ConnectedService_new" RENAME TO "ConnectedService";

-- One row per provider, as before. The upsert in `connected_services.rs`
-- depends on this constraint.
CREATE UNIQUE INDEX "ConnectedService_provider_key" ON "ConnectedService" ("provider");
