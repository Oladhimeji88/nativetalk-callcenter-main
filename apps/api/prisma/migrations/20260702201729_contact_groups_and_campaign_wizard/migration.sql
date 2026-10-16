-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "OutboundCampaign" ADD COLUMN     "callWindowEnd" TEXT,
ADD COLUMN     "callWindowStart" TEXT,
ADD COLUMN     "contactGroupId" TEXT,
ADD COLUMN     "directionType" TEXT,
ADD COLUMN     "dispositionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scheduleEnd" TIMESTAMP(3),
ADD COLUMN     "scheduleStart" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "ContactGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactGroup_tenantId_idx" ON "ContactGroup"("tenantId");

-- AddForeignKey
ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
