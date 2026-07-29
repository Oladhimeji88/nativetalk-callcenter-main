-- AlterTable
ALTER TABLE "Manager" ADD COLUMN     "agentExtension" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'admin';
