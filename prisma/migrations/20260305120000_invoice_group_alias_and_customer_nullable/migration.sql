-- AlterTable
ALTER TABLE `Invoice`
  ADD COLUMN `shipDate` DATETIME(3) NULL,
  ADD COLUMN `releaseDate` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Customer`
  MODIFY `consignee` TEXT NULL;

-- CreateTable
CREATE TABLE `OrderAlias` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `aliasNo` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `OrderAlias_aliasNo_key`(`aliasNo`),
  INDEX `OrderAlias_orderId_idx`(`orderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrderAlias`
  ADD CONSTRAINT `OrderAlias_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
