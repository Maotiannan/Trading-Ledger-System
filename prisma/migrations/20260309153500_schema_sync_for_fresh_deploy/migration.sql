-- Align fresh deployments with the current Prisma schema.
ALTER TABLE `AuditLog` MODIFY `metadata` JSON NULL;

ALTER TABLE `BalanceTransfer` MODIFY `amount` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `Customer` MODIFY `credit` DECIMAL(18, 2) NULL;

ALTER TABLE `Detail` MODIFY `totalAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE `DetailItem` MODIFY `amount` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `Order`
  ADD COLUMN `createdBy` VARCHAR(191) NULL,
  MODIFY `amount` DECIMAL(18, 2) NOT NULL,
  MODIFY `orderBalance` DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE `Receipt` MODIFY `usd` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `ReceiptHistory` MODIFY `usd` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `Swift` MODIFY `amount` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `User`
  ADD COLUMN `level` INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN `parentId` VARCHAR(191) NULL;

CREATE INDEX `Order_createdBy_idx` ON `Order`(`createdBy`);
CREATE INDEX `User_parentId_idx` ON `User`(`parentId`);
CREATE INDEX `User_level_idx` ON `User`(`level`);

ALTER TABLE `User`
  ADD CONSTRAINT `User_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Order`
  ADD CONSTRAINT `Order_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
