ALTER TABLE "CrmInteraction"
ADD COLUMN "sourceConnectionId" INTEGER;

CREATE INDEX "CrmInteraction_sourceConnectionId_idx"
ON "CrmInteraction"("sourceConnectionId");

ALTER TABLE "CrmInteraction"
ADD CONSTRAINT "CrmInteraction_sourceConnectionId_fkey"
FOREIGN KEY ("sourceConnectionId")
REFERENCES "CrmIntegrationConnection"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
