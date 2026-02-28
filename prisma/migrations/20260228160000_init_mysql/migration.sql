-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `role` ENUM('ADMIN', 'SALES', 'USER') NOT NULL DEFAULT 'USER',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `invNo` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Invoice_invNo_key`(`invNo`),
    INDEX `Invoice_invNo_idx`(`invNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `tokens` VARCHAR(191) NOT NULL DEFAULT '[]',
    `amount` DOUBLE NOT NULL,
    `orderBalance` DOUBLE NOT NULL DEFAULT 0,
    `customerId` VARCHAR(191) NULL,
    `customerMark` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NULL,
    `customerPhone` VARCHAR(191) NULL,
    `customerCity` VARCHAR(191) NULL,
    `needsCustomerFix` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Order_invoiceId_idx`(`invoiceId`),
    INDEX `Order_orderNo_idx`(`orderNo`),
    UNIQUE INDEX `Order_invoiceId_orderNo_key`(`invoiceId`, `orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Receipt` (
    `id` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(191) NULL,
    `date` DATETIME(3) NULL,
    `tel` VARCHAR(191) NULL,
    `usd` DOUBLE NOT NULL,
    `invNo` VARCHAR(191) NULL,
    `orderNo` VARCHAR(191) NULL,
    `payer` VARCHAR(191) NULL,
    `status` ENUM('SR_Received', 'Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED') NOT NULL DEFAULT 'SR_Received',
    `imageUrl` VARCHAR(191) NULL,
    `imageName` VARCHAR(191) NULL,
    `isDeposit` BOOLEAN NOT NULL DEFAULT false,
    `isMerged` BOOLEAN NOT NULL DEFAULT false,
    `mergedToId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `customerMark` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NULL,
    `customerPhone` VARCHAR(191) NULL,
    `customerCity` VARCHAR(191) NULL,
    `needsCustomerFix` BOOLEAN NOT NULL DEFAULT false,
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `orderId` VARCHAR(191) NULL,

    INDEX `Receipt_orderNo_idx`(`orderNo`),
    INDEX `Receipt_invNo_idx`(`invNo`),
    INDEX `Receipt_status_idx`(`status`),
    INDEX `Receipt_createdBy_idx`(`createdBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReceiptHistory` (
    `id` VARCHAR(191) NOT NULL,
    `receiptId` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(191) NULL,
    `date` DATETIME(3) NULL,
    `tel` VARCHAR(191) NULL,
    `usd` DOUBLE NOT NULL,
    `invNo` VARCHAR(191) NULL,
    `orderNo` VARCHAR(191) NULL,
    `payer` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `imageName` VARCHAR(191) NULL,
    `status` ENUM('SR_Received', 'Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED') NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReceiptHistory_receiptId_idx`(`receiptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Detail` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NULL,
    `status` ENUM('Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED', 'ERROR') NOT NULL DEFAULT 'Waiting_SWIFT',
    `imageUrl` VARCHAR(191) NULL,
    `imageName` VARCHAR(191) NULL,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Detail_status_idx`(`status`),
    INDEX `Detail_createdBy_idx`(`createdBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DetailItem` (
    `id` VARCHAR(191) NOT NULL,
    `detailId` VARCHAR(191) NOT NULL,
    `mark` VARCHAR(191) NULL,
    `orderNo` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `receiptId` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DetailItem_detailId_idx`(`detailId`),
    INDEX `DetailItem_orderNo_idx`(`orderNo`),
    INDEX `DetailItem_receiptId_idx`(`receiptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DetailHistory` (
    `id` VARCHAR(191) NOT NULL,
    `detailId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NULL,
    `items` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `imageName` VARCHAR(191) NULL,
    `status` ENUM('Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED', 'ERROR') NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DetailHistory_detailId_idx`(`detailId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Swift` (
    `id` VARCHAR(191) NOT NULL,
    `detailId` VARCHAR(191) NOT NULL,
    `status` ENUM('Bank_Transfer', 'RECEIVED', 'ERROR') NOT NULL DEFAULT 'Bank_Transfer',
    `amount` DOUBLE NOT NULL,
    `date` DATETIME(3) NULL,
    `senderName` VARCHAR(191) NULL,
    `senderAddress` VARCHAR(191) NULL,
    `receiverName` VARCHAR(191) NULL,
    `receiverAccount` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `imageName` VARCHAR(191) NULL,
    `hasError` BOOLEAN NOT NULL DEFAULT false,
    `errorMessage` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Swift_detailId_key`(`detailId`),
    INDEX `Swift_detailId_idx`(`detailId`),
    INDEX `Swift_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `mark` VARCHAR(191) NOT NULL,
    `order_name` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `consignee` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NULL,
    `credit` DOUBLE NULL,
    `companyAddress` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_name_key`(`name`),
    INDEX `Customer_mark_idx`(`mark`),
    INDEX `Customer_order_name_idx`(`order_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeletionRequest` (
    `id` VARCHAR(191) NOT NULL,
    `targetType` ENUM('RECEIPT', 'DETAIL', 'SWIFT') NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `requestedBy` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DeletionRequest_targetType_idx`(`targetType`),
    INDEX `DeletionRequest_targetId_idx`(`targetId`),
    INDEX `DeletionRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BalanceTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `fromOrderId` VARCHAR(191) NOT NULL,
    `toOrderId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BalanceTransfer_fromOrderId_idx`(`fromOrderId`),
    INDEX `BalanceTransfer_toOrderId_idx`(`toOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_action_idx`(`action`),
    INDEX `AuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SystemSetting_key_key`(`key`),
    INDEX `SystemSetting_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_mergedToId_fkey` FOREIGN KEY (`mergedToId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReceiptHistory` ADD CONSTRAINT `ReceiptHistory_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReceiptHistory` ADD CONSTRAINT `ReceiptHistory_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Detail` ADD CONSTRAINT `Detail_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DetailItem` ADD CONSTRAINT `DetailItem_detailId_fkey` FOREIGN KEY (`detailId`) REFERENCES `Detail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DetailItem` ADD CONSTRAINT `DetailItem_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DetailHistory` ADD CONSTRAINT `DetailHistory_detailId_fkey` FOREIGN KEY (`detailId`) REFERENCES `Detail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DetailHistory` ADD CONSTRAINT `DetailHistory_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Swift` ADD CONSTRAINT `Swift_detailId_fkey` FOREIGN KEY (`detailId`) REFERENCES `Detail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Swift` ADD CONSTRAINT `Swift_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeletionRequest` ADD CONSTRAINT `DeletionRequest_requestedBy_fkey` FOREIGN KEY (`requestedBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeletionRequest` ADD CONSTRAINT `DeletionRequest_approvedBy_fkey` FOREIGN KEY (`approvedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BalanceTransfer` ADD CONSTRAINT `BalanceTransfer_fromOrderId_fkey` FOREIGN KEY (`fromOrderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BalanceTransfer` ADD CONSTRAINT `BalanceTransfer_toOrderId_fkey` FOREIGN KEY (`toOrderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SystemSetting` ADD CONSTRAINT `SystemSetting_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

