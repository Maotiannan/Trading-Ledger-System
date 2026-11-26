-- AlterTable
ALTER TABLE `User` ADD COLUMN `disabledAt` DATETIME(3) NULL,
    ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `UploadedAsset` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Invoice` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `OrderTracker` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Receipt` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Detail` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Swift` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PaymentAgent` ADD COLUMN `managedById` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `MutationIntent` (
    `id` VARCHAR(64) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MutationIntent_actorId_kind_createdAt_idx`(`actorId`, `kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecoveryEntry` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RECOVERABLE',
    `snapshot` JSON NOT NULL,
    `files` JSON NOT NULL,
    `deletedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recoverableUntil` DATETIME(3) NOT NULL,
    `restoredAt` DATETIME(3) NULL,
    `purgedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,

    INDEX `RecoveryEntry_status_recoverableUntil_idx`(`status`, `recoverableUntil`),
    INDEX `RecoveryEntry_ownerId_status_idx`(`ownerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `UploadedAsset_managedById_idx` ON `UploadedAsset`(`managedById`);

-- CreateIndex
CREATE INDEX `Invoice_managedById_idx` ON `Invoice`(`managedById`);

-- CreateIndex
CREATE INDEX `Order_managedById_idx` ON `Order`(`managedById`);

-- CreateIndex
CREATE INDEX `OrderTracker_managedById_idx` ON `OrderTracker`(`managedById`);

-- CreateIndex
CREATE INDEX `Receipt_managedById_idx` ON `Receipt`(`managedById`);

-- CreateIndex
CREATE INDEX `Detail_managedById_idx` ON `Detail`(`managedById`);

-- CreateIndex
CREATE INDEX `Swift_managedById_idx` ON `Swift`(`managedById`);

-- CreateIndex
CREATE INDEX `PaymentAgent_managedById_idx` ON `PaymentAgent`(`managedById`);

