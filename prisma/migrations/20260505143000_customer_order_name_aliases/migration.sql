ALTER TABLE `Customer`
  ADD COLUMN `normalized_mark` VARCHAR(191) NOT NULL DEFAULT '';

UPDATE `Customer`
SET `normalized_mark` = LOWER(REPLACE(`mark`, ' ', ''));

CREATE INDEX `Customer_normalized_mark_idx` ON `Customer`(`normalized_mark`);

CREATE TABLE `CustomerOrderName` (
  `id` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `order_name` VARCHAR(191) NOT NULL,
  `normalized_order_name` VARCHAR(191) NOT NULL,
  `isPrimary` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerOrderName`
  ADD CONSTRAINT `CustomerOrderName_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX `CustomerOrderName_customerId_normalized_order_name_key`
  ON `CustomerOrderName`(`customerId`, `normalized_order_name`);
CREATE INDEX `CustomerOrderName_normalized_order_name_idx`
  ON `CustomerOrderName`(`normalized_order_name`);
CREATE INDEX `CustomerOrderName_customerId_isPrimary_idx`
  ON `CustomerOrderName`(`customerId`, `isPrimary`);

INSERT INTO `CustomerOrderName` (`id`, `customerId`, `order_name`, `normalized_order_name`, `isPrimary`, `createdAt`, `updatedAt`)
SELECT REPLACE(UUID(), '-', ''), `id`, `order_name`, LOWER(REPLACE(`order_name`, ' ', '')), true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Customer`;
