-- AlterTable
ALTER TABLE `Invoice` ADD COLUMN `estimatedArrivalDate` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `MucontInvoiceSource` (
    `invoiceBatchId` VARCHAR(128) NOT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `publicationSequence` INTEGER NOT NULL DEFAULT 0,
    `generationId` VARCHAR(128) NULL,
    `documentVersion` INTEGER NOT NULL DEFAULT 0,
    `appliedAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `metadataVersion` INTEGER NOT NULL DEFAULT 0,
    `metadataReadAt` DATETIME(3) NULL,
    `metadataAvailability` VARCHAR(191) NOT NULL DEFAULT 'unavailable',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MucontInvoiceSource_invoiceId_key`(`invoiceId`),
    PRIMARY KEY (`invoiceBatchId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MucontInvoiceGroup` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceBatchId` VARCHAR(128) NOT NULL,
    `billingGroupId` VARCHAR(128) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderRefs` JSON NOT NULL,

    UNIQUE INDEX `MucontInvoiceGroup_orderId_key`(`orderId`),
    UNIQUE INDEX `MucontInvoiceGroup_invoiceBatchId_billingGroupId_key`(`invoiceBatchId`, `billingGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MucontInvoiceGeneration` (
    `generationId` VARCHAR(128) NOT NULL,
    `invoiceBatchId` VARCHAR(128) NOT NULL,
    `publicationSequence` INTEGER NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `snapshot` JSON NOT NULL,
    `result` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MucontInvoiceGeneration_invoiceBatchId_publicationSequence_key`(`invoiceBatchId`, `publicationSequence`),
    PRIMARY KEY (`generationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MucontInvoiceResync` (
    `requestId` VARCHAR(128) NOT NULL,
    `invoiceBatchId` VARCHAR(128) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `expectedRevision` CHAR(64) NOT NULL,
    `generationId` VARCHAR(128) NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`requestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MucontInvoiceSource` ADD CONSTRAINT `MucontInvoiceSource_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MucontInvoiceGroup` ADD CONSTRAINT `MucontInvoiceGroup_invoiceBatchId_fkey` FOREIGN KEY (`invoiceBatchId`) REFERENCES `MucontInvoiceSource`(`invoiceBatchId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MucontInvoiceGroup` ADD CONSTRAINT `MucontInvoiceGroup_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MucontInvoiceGeneration` ADD CONSTRAINT `MucontInvoiceGeneration_invoiceBatchId_fkey` FOREIGN KEY (`invoiceBatchId`) REFERENCES `MucontInvoiceSource`(`invoiceBatchId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MucontInvoiceResync` ADD CONSTRAINT `MucontInvoiceResync_invoiceBatchId_fkey` FOREIGN KEY (`invoiceBatchId`) REFERENCES `MucontInvoiceSource`(`invoiceBatchId`) ON DELETE RESTRICT ON UPDATE CASCADE;

