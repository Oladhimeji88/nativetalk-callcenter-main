-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "managerId" TEXT;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
