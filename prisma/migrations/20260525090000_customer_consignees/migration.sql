-- CreateTable
CREATE TABLE `CustomerConsignee` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `consignee` TEXT NOT NULL,
    `normalized_consignee` VARCHAR(191) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerConsignee_customerId_normalized_consignee_key`(`customerId`, `normalized_consignee`),
    INDEX `CustomerConsignee_normalized_consignee_idx`(`normalized_consignee`),
    INDEX `CustomerConsignee_customerId_isPrimary_idx`(`customerId`, `isPrimary`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill existing single-consignee data without changing Customer.consignee.
INSERT INTO `CustomerConsignee` (`id`, `customerId`, `consignee`, `normalized_consignee`, `isPrimary`, `createdAt`, `updatedAt`)
SELECT CONCAT('cc_', REPLACE(UUID(), '-', '')), `id`, TRIM(`consignee`), LEFT(LOWER(TRIM(`consignee`)), 191), true, NOW(3), NOW(3)
FROM `Customer`
WHERE `consignee` IS NOT NULL AND TRIM(`consignee`) <> '';

-- AddForeignKey
ALTER TABLE `CustomerConsignee` ADD CONSTRAINT `CustomerConsignee_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
