-- AlterTable
ALTER TABLE `Order` ADD COLUMN `paymentAllocationMode` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `ReceiptFunding` (
    `id` VARCHAR(191) NOT NULL,
    `receiptId` VARCHAR(191) NULL,
    `originalReceiptId` VARCHAR(191) NOT NULL,
    `originalOrderId` VARCHAR(191) NOT NULL,
    `originalCustomerId` VARCHAR(191) NOT NULL,
    `receivedAmount` DECIMAL(18, 2) NOT NULL,
    `receiptSnapshot` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReceiptFunding_receiptId_key`(`receiptId`),
    UNIQUE INDEX `ReceiptFunding_originalReceiptId_key`(`originalReceiptId`),
    INDEX `ReceiptFunding_originalOrderId_idx`(`originalOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrepaymentCredit` (
    `id` VARCHAR(191) NOT NULL,
    `fundingId` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderTrackerId` VARCHAR(191) NULL,
    `invoiceBatchId` VARCHAR(128) NULL,
    `billingGroupId` VARCHAR(128) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PrepaymentCredit_customerId_orderTrackerId_idx`(`customerId`, `orderTrackerId`),
    INDEX `PrepaymentCredit_sourceId_idx`(`sourceId`),
    INDEX `PrepaymentCredit_invoiceBatchId_billingGroupId_idx`(`invoiceBatchId`, `billingGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrepaymentPlan` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceBatchId` VARCHAR(128) NOT NULL,
    `version` INTEGER NOT NULL,
    `requestId` VARCHAR(128) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `financialHash` CHAR(64) NOT NULL,
    `planHash` CHAR(64) NOT NULL,
    `snapshot` JSON NOT NULL,
    `groups` JSON NOT NULL,
    `previousPlanId` VARCHAR(191) NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'RESERVED',
    `ledgerInvoiceId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `appliedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PrepaymentPlan_requestId_key`(`requestId`),
    INDEX `PrepaymentPlan_invoiceBatchId_state_idx`(`invoiceBatchId`, `state`),
    UNIQUE INDEX `PrepaymentPlan_invoiceBatchId_version_key`(`invoiceBatchId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrepaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NULL,
    `fundingId` VARCHAR(191) NOT NULL,
    `creditId` VARCHAR(191) NOT NULL,
    `invoiceBatchId` VARCHAR(128) NULL,
    `billingGroupId` VARCHAR(128) NULL,
    `orderId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `appliedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,

    INDEX `PrepaymentAllocation_orderId_state_idx`(`orderId`, `state`),
    INDEX `PrepaymentAllocation_creditId_state_idx`(`creditId`, `state`),
    INDEX `PrepaymentAllocation_invoiceBatchId_state_idx`(`invoiceBatchId`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrepaymentTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(128) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `fromCreditId` VARCHAR(191) NOT NULL,
    `toCreditId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversedAt` DATETIME(3) NULL,
    `reversedBy` VARCHAR(191) NULL,
    `reverseReason` TEXT NULL,

    UNIQUE INDEX `PrepaymentTransfer_requestId_key`(`requestId`),
    UNIQUE INDEX `PrepaymentTransfer_toCreditId_key`(`toCreditId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrepaymentMutex` (
    `id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrepaymentSource` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `originalOrderNo` VARCHAR(191) NOT NULL,
    `normalizedOrderNo` VARCHAR(191) NOT NULL,
    `sourcePiId` VARCHAR(128) NULL,
    `orderTrackerId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PrepaymentSource_sourcePiId_key`(`sourcePiId`),
    UNIQUE INDEX `PrepaymentSource_orderTrackerId_key`(`orderTrackerId`),
    UNIQUE INDEX `PrepaymentSource_orderId_key`(`orderId`),
    UNIQUE INDEX `PrepaymentSource_customerId_normalizedOrderNo_key`(`customerId`, `normalizedOrderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReceiptFunding` ADD CONSTRAINT `ReceiptFunding_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrepaymentCredit` ADD CONSTRAINT `PrepaymentCredit_fundingId_fkey` FOREIGN KEY (`fundingId`) REFERENCES `ReceiptFunding`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrepaymentAllocation` ADD CONSTRAINT `PrepaymentAllocation_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `PrepaymentPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrepaymentAllocation` ADD CONSTRAINT `PrepaymentAllocation_fundingId_fkey` FOREIGN KEY (`fundingId`) REFERENCES `ReceiptFunding`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrepaymentAllocation` ADD CONSTRAINT `PrepaymentAllocation_creditId_fkey` FOREIGN KEY (`creditId`) REFERENCES `PrepaymentCredit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrepaymentAllocation` ADD CONSTRAINT `PrepaymentAllocation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrepaymentTransfer` ADD CONSTRAINT `PrepaymentTransfer_fromCreditId_fkey` FOREIGN KEY (`fromCreditId`) REFERENCES `PrepaymentCredit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrepaymentTransfer` ADD CONSTRAINT `PrepaymentTransfer_toCreditId_fkey` FOREIGN KEY (`toCreditId`) REFERENCES `PrepaymentCredit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO PrepaymentMutex (id) VALUES ('ledger');
ALTER TABLE PrepaymentPlan MODIFY requestId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY invoiceBatchId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE PrepaymentTransfer MODIFY requestId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE PrepaymentSource MODIFY sourcePiId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
