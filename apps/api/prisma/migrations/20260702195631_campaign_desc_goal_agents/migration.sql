-- AlterTable
ALTER TABLE "OutboundCampaign" ADD COLUMN     "assignedAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "goal" TEXT;
