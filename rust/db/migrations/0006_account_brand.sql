-- Which card ART an account renders with, chosen rather than inferred.
--
-- The card layouts were selected by matching the account NAME —
-- `name.includes('amazon')` and seven more — which made the list of supported
-- designs a list of the author's own accounts, readable as such by anyone with
-- the source. A stored brand turns it into a catalogue the user picks from.
--
-- NULL renders the generic layout for the account's `type`, which is what every
-- account gets until someone chooses otherwise.
ALTER TABLE "Account" ADD COLUMN "brand" TEXT;

-- Backfill from the names the old dispatch matched, so existing cards keep the
-- art they already had. Without this every branded card silently reverts to
-- generic on upgrade — the change would look like a regression rather than a
-- refactor.
--
-- Ordered most specific first: "Prime Visa" must win before any broader match,
-- and the gift-card brands are scoped by type so a *credit* card named "Amazon"
-- does not take gift-card art.
UPDATE "Account" SET "brand" = 'PRIME_VISA'
  WHERE "brand" IS NULL AND lower("name") LIKE '%prime visa%';

UPDATE "Account" SET "brand" = 'X_MONEY'
  WHERE "brand" IS NULL
    AND (lower("name") = 'x' OR lower("name") LIKE '%x money%' OR lower("name") LIKE '%x card%');

UPDATE "Account" SET "brand" = 'CASH_APP'
  WHERE "brand" IS NULL AND lower("name") LIKE '%cash app%';

UPDATE "Account" SET "brand" = 'COMMUNITY_FIRST'
  WHERE "brand" IS NULL AND lower("name") LIKE '%community first%';

UPDATE "Account" SET "brand" = 'FIDELITY'
  WHERE "brand" IS NULL AND lower("name") LIKE '%fidelity%';

UPDATE "Account" SET "brand" = 'AMAZON_GIFT'
  WHERE "brand" IS NULL AND "type" = 'Gift Card' AND lower("name") LIKE '%amazon%';

UPDATE "Account" SET "brand" = 'APPLE_GIFT'
  WHERE "brand" IS NULL AND "type" = 'Gift Card' AND lower("name") LIKE '%apple%';

UPDATE "Account" SET "brand" = 'COSTCO_GIFT'
  WHERE "brand" IS NULL AND "type" = 'Gift Card' AND lower("name") LIKE '%costco%';
