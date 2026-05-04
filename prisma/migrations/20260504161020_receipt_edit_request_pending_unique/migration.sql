-- AlterTable
ALTER TABLE `ReceiptEditRequest` ADD COLUMN `pendingReceiptId` VARCHAR(191) NULL,
    MODIFY `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX `ReceiptEditRequest_pendingReceiptId_key` ON `ReceiptEditRequest`(`pendingReceiptId`);
