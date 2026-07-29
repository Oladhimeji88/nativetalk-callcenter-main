-- AlterTable
ALTER TABLE "CallLog" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "campaignId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_tenantId_campaignId_status_idx" ON "Lead"("tenantId", "campaignId", "status");
