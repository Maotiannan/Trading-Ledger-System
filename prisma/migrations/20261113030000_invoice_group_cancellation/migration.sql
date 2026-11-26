-- Preserve canceled financial identities and their receipts. No rows are deleted.
ALTER TABLE `Invoice` ADD COLUMN `canceledAt` DATETIME(3) NULL;
ALTER TABLE `Order` ADD COLUMN `canceledAt` DATETIME(3) NULL;
