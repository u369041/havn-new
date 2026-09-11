-- Link CRM follow-ups to opportunities while preserving existing contact follow-ups.

-- Existing follow-ups may become opportunity-only tasks, so contactId is now optional.
ALTER TABLE "CrmFollowUp"
ALTER COLUMN "contactId" DROP NOT NULL;

-- Optional opportunity relationship.
ALTER TABLE "CrmFollowUp"
ADD COLUMN "opportunityId" INTEGER;

-- Changing contactId from required to optional means deleting a contact should
-- retain an opportunity-linked follow-up rather than cascading the task away.
ALTER TABLE "CrmFollowUp"
DROP CONSTRAINT "CrmFollowUp_contactId_fkey";

ALTER TABLE "CrmFollowUp"
ADD CONSTRAINT "CrmFollowUp_contactId_fkey"
FOREIGN KEY ("contactId")
REFERENCES "ProfessionalContact"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "CrmFollowUp"
ADD CONSTRAINT "CrmFollowUp_opportunityId_fkey"
FOREIGN KEY ("opportunityId")
REFERENCES "CrmOpportunity"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- A follow-up must belong to a contact, an opportunity, or both.
ALTER TABLE "CrmFollowUp"
ADD CONSTRAINT "CrmFollowUp_contact_or_opportunity_required"
CHECK ("contactId" IS NOT NULL OR "opportunityId" IS NOT NULL);

CREATE INDEX "CrmFollowUp_opportunityId_idx"
ON "CrmFollowUp"("opportunityId");

CREATE INDEX "CrmFollowUp_opportunityId_dueAt_idx"
ON "CrmFollowUp"("opportunityId", "dueAt");