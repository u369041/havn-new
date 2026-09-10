-- AlterEnum
ALTER TYPE "CrmIntegrationProvider" ADD VALUE 'IMAP_CALDAV';

-- AlterEnum
ALTER TYPE "CrmInteractionProvider" ADD VALUE 'IMAP_CALDAV';

-- AlterTable
ALTER TABLE "CrmIntegrationConnection" ADD COLUMN     "configuration" JSONB;
