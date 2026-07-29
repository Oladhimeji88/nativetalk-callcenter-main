-- AlterTable
ALTER TABLE "OutboundCampaign" ADD COLUMN     "excludeDispositionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
