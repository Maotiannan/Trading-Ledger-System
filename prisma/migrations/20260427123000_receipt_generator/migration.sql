ALTER TABLE `Receipt`
  MODIFY `status` ENUM('SIGNING_PENDING', 'SR_Received', 'Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED') NOT NULL DEFAULT 'SR_Received';

ALTER TABLE `ReceiptHistory`
  MODIFY `status` ENUM('SIGNING_PENDING', 'SR_Received', 'Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED') NOT NULL;

CREATE TABLE IF NOT EXISTS `SystemCounter` (
  `key` VARCHAR(191) NOT NULL,
  `nextValue` INTEGER NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ReceiptGeneratorSession` (
  `id` VARCHAR(191) NOT NULL,
  `receiptId` VARCHAR(191) NOT NULL,
  `receiptNo` VARCHAR(191) NOT NULL,
  `orderNo` VARCHAR(191) NOT NULL,
  `invNo` VARCHAR(191) NULL,
  `customerId` VARCHAR(191) NULL,
  `customerMark` VARCHAR(191) NULL,
  `customerName` VARCHAR(191) NULL,
  `clientTel` VARCHAR(191) NULL,
  `usd` DECIMAL(18, 2) NOT NULL,
  `balanceBefore` DECIMAL(18, 2) NULL,
  `balanceAfter` DECIMAL(18, 2) NULL,
  `amountInWords` TEXT NULL,
  `motif` TEXT NULL,
  `receiverSignatureUrl` LONGTEXT NULL,
  `receiverSignatureName` TEXT NULL,
  `payerSignatureUrl` LONGTEXT NULL,
  `payerSignatureName` TEXT NULL,
  `finalImageUrl` LONGTEXT NULL,
  `finalImageName` TEXT NULL,
  `layoutSnapshot` JSON NULL,
  `status` ENUM('PENDING', 'FINALIZED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ReceiptGeneratorSession_receiptId_key` (`receiptId`),
  KEY `ReceiptGeneratorSession_createdBy_createdAt_idx` (`createdBy`, `createdAt`),
  KEY `ReceiptGeneratorSession_status_createdAt_idx` (`status`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @receipt_receipt_no_idx_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Receipt'
      AND INDEX_NAME = 'Receipt_receiptNo_key'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `Receipt_receiptNo_key` ON `Receipt`(`receiptNo`)'
);
PREPARE receipt_receipt_no_idx_stmt FROM @receipt_receipt_no_idx_sql;
EXECUTE receipt_receipt_no_idx_stmt;
DEALLOCATE PREPARE receipt_receipt_no_idx_stmt;

SET @receipt_generator_session_receipt_fk_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ReceiptGeneratorSession'
      AND CONSTRAINT_NAME = 'ReceiptGeneratorSession_receiptId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `ReceiptGeneratorSession` ADD CONSTRAINT `ReceiptGeneratorSession_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
);
PREPARE receipt_generator_session_receipt_fk_stmt FROM @receipt_generator_session_receipt_fk_sql;
EXECUTE receipt_generator_session_receipt_fk_stmt;
DEALLOCATE PREPARE receipt_generator_session_receipt_fk_stmt;

SET @receipt_generator_session_created_by_fk_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ReceiptGeneratorSession'
      AND CONSTRAINT_NAME = 'ReceiptGeneratorSession_createdBy_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `ReceiptGeneratorSession` ADD CONSTRAINT `ReceiptGeneratorSession_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
);
PREPARE receipt_generator_session_created_by_fk_stmt FROM @receipt_generator_session_created_by_fk_sql;
EXECUTE receipt_generator_session_created_by_fk_stmt;
DEALLOCATE PREPARE receipt_generator_session_created_by_fk_stmt;
