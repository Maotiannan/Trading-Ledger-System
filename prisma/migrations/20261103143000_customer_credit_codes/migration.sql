-- Manual integration codes: never infer/backfill identifiers for existing customers.
ALTER TABLE `Customer`
  ADD COLUMN `customerCode` VARCHAR(191) NULL,
  ADD COLUMN `creditCode` VARCHAR(191) NULL;
