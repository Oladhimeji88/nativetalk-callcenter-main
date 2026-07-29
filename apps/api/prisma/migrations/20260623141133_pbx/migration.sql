-- CreateTable
CREATE TABLE "Extension" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "displayName" TEXT,
    "context" TEXT NOT NULL DEFAULT 'default',
    "callerIdName" TEXT,
    "callerIdNumber" TEXT,
    "voicemail" BOOLEAN NOT NULL DEFAULT true,
    "tollAllow" TEXT NOT NULL DEFAULT 'domestic,local',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Extension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "proxy" TEXT NOT NULL,
    "realm" TEXT,
    "fromDomain" TEXT,
    "register" BOOLEAN NOT NULL DEFAULT true,
    "callerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'simultaneous',
    "members" JSONB NOT NULL DEFAULT '[]',
    "timeoutSec" INTEGER NOT NULL DEFAULT 25,
    "failoverDest" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundRoute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "destination" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ivr" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "greeting" TEXT NOT NULL DEFAULT 'ivr/ivr-welcome_to_freeswitch.wav',
    "timeoutSec" INTEGER NOT NULL DEFAULT 5,
    "options" JSONB NOT NULL DEFAULT '{}',
    "invalidDest" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ivr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Queue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'ring-all',
    "moh" TEXT NOT NULL DEFAULT '$${hold_music}',
    "members" JSONB NOT NULL DEFAULT '[]',
    "maxWaitSec" INTEGER NOT NULL DEFAULT 300,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeCondition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "ranges" JSONB NOT NULL DEFAULT '[]',
    "matchDest" TEXT,
    "noMatchDest" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Extension_tenantId_idx" ON "Extension"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Extension_tenantId_extension_key" ON "Extension"("tenantId", "extension");

-- CreateIndex
CREATE INDEX "Trunk_tenantId_idx" ON "Trunk"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Trunk_tenantId_name_key" ON "Trunk"("tenantId", "name");

-- CreateIndex
CREATE INDEX "RingGroup_tenantId_idx" ON "RingGroup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RingGroup_tenantId_number_key" ON "RingGroup"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InboundRoute_tenantId_idx" ON "InboundRoute"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundRoute_tenantId_did_key" ON "InboundRoute"("tenantId", "did");

-- CreateIndex
CREATE INDEX "Ivr_tenantId_idx" ON "Ivr"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Ivr_tenantId_number_key" ON "Ivr"("tenantId", "number");

-- CreateIndex
CREATE INDEX "Queue_tenantId_idx" ON "Queue"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Queue_tenantId_number_key" ON "Queue"("tenantId", "number");

-- CreateIndex
CREATE INDEX "TimeCondition_tenantId_idx" ON "TimeCondition"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeCondition_tenantId_number_key" ON "TimeCondition"("tenantId", "number");

-- AddForeignKey
ALTER TABLE "Extension" ADD CONSTRAINT "Extension_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trunk" ADD CONSTRAINT "Trunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingGroup" ADD CONSTRAINT "RingGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundRoute" ADD CONSTRAINT "InboundRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ivr" ADD CONSTRAINT "Ivr_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Queue" ADD CONSTRAINT "Queue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCondition" ADD CONSTRAINT "TimeCondition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
