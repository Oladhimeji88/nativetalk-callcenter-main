-- AlterTable
ALTER TABLE "CallAttempt" ADD COLUMN     "runId" TEXT;

-- CreateIndex
CREATE INDEX "CallAttempt_runId_idx" ON "CallAttempt"("runId");
