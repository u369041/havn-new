ALTER TABLE "CrmIntegrationConnection"
ADD COLUMN "connectionKey" TEXT;

UPDATE "CrmIntegrationConnection"
SET "connectionKey" = CASE
  WHEN "provider" = 'IMAP_CALDAV' THEN
    CASE
      WHEN COALESCE("configuration"->>'type', '') = 'ICLOUD' THEN 'icloud'
      WHEN "accountEmail" IS NOT NULL AND BTRIM("accountEmail") <> '' THEN 'custom:' || LOWER(BTRIM("accountEmail"))
      ELSE 'custom:' || "id"::text
    END
  ELSE 'primary'
END
WHERE "connectionKey" IS NULL;

ALTER TABLE "CrmIntegrationConnection"
ALTER COLUMN "connectionKey" SET NOT NULL;

ALTER TABLE "CrmIntegrationConnection"
DROP CONSTRAINT IF EXISTS "CrmIntegrationConnection_agencyId_memberId_provider_key";

CREATE UNIQUE INDEX "CrmIntegrationConnection_agencyId_memberId_provider_connectionKey_key"
ON "CrmIntegrationConnection"("agencyId", "memberId", "provider", "connectionKey");

CREATE INDEX "CrmIntegrationConnection_connectionKey_idx"
ON "CrmIntegrationConnection"("connectionKey");
