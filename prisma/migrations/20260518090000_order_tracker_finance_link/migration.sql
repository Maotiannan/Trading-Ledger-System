ALTER TABLE `OrderTracker`
  ADD COLUMN `financeOrderId` VARCHAR(191) NULL;

CREATE INDEX `OrderTracker_financeOrderId_idx` ON `OrderTracker`(`financeOrderId`);

ALTER TABLE `OrderTracker`
  ADD CONSTRAINT `OrderTracker_financeOrderId_fkey`
  FOREIGN KEY (`financeOrderId`) REFERENCES `Order`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
