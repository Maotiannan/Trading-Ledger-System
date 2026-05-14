CREATE TABLE `OrderTracker` (
  `id` VARCHAR(191) NOT NULL,
  `orderNo` VARCHAR(191) NOT NULL,
  `normalizedOrderNo` VARCHAR(191) NOT NULL,
  `tokens` TEXT NOT NULL DEFAULT '[]',
  `amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  `orderBalance` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  `createdBy` VARCHAR(191) NOT NULL,
  `updatedBy` VARCHAR(191) NULL,
  `customerId` VARCHAR(191) NULL,
  `customerMark` VARCHAR(191) NULL,
  `customerName` VARCHAR(191) NULL,
  `customerPhone` VARCHAR(191) NULL,
  `customerCity` VARCHAR(191) NULL,
  `needsCustomerFix` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(191) NOT NULL DEFAULT 'In progress',
  `piStatus` BOOLEAN NOT NULL DEFAULT false,
  `remark` TEXT NULL,
  `systemNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `OrderTracker_normalizedOrderNo_key` ON `OrderTracker`(`normalizedOrderNo`);
CREATE INDEX `OrderTracker_createdBy_idx` ON `OrderTracker`(`createdBy`);
CREATE INDEX `OrderTracker_updatedBy_idx` ON `OrderTracker`(`updatedBy`);
CREATE INDEX `OrderTracker_customerId_idx` ON `OrderTracker`(`customerId`);
CREATE INDEX `OrderTracker_status_idx` ON `OrderTracker`(`status`);
CREATE INDEX `OrderTracker_orderNo_idx` ON `OrderTracker`(`orderNo`);
CREATE INDEX `OrderTracker_normalizedOrderNo_idx` ON `OrderTracker`(`normalizedOrderNo`);

ALTER TABLE `OrderTracker`
  ADD CONSTRAINT `OrderTracker_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OrderTracker`
  ADD CONSTRAINT `OrderTracker_updatedBy_fkey`
  FOREIGN KEY (`updatedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `OrderTracker`
  ADD CONSTRAINT `OrderTracker_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
