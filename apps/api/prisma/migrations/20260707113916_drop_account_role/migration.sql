-- The coarse `role` tier is gone; a role is a permission group (roleId). Drop it.
ALTER TABLE "Account" DROP COLUMN "role";
