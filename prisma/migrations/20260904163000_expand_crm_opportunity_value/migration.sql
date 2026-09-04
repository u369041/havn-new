-- Expand CRM opportunity monetary capacity beyond PostgreSQL INTEGER cents limit.
ALTER TABLE "CrmOpportunity"
  ALTER COLUMN "valueCents" TYPE BIGINT
  USING "valueCents"::BIGINT;
