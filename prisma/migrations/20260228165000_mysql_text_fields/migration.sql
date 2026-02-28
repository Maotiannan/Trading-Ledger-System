-- AlterTable
ALTER TABLE `BalanceTransfer` MODIFY `note` TEXT NULL;

-- AlterTable
ALTER TABLE `DeletionRequest` MODIFY `reason` TEXT NULL;

-- AlterTable
ALTER TABLE `Detail` MODIFY `imageUrl` TEXT NULL,
    MODIFY `imageName` TEXT NULL;

-- AlterTable
ALTER TABLE `DetailHistory` MODIFY `items` LONGTEXT NOT NULL,
    MODIFY `imageUrl` TEXT NULL,
    MODIFY `imageName` TEXT NULL,
    MODIFY `note` TEXT NULL;

-- AlterTable
ALTER TABLE `DetailItem` MODIFY `note` TEXT NULL;

-- AlterTable
ALTER TABLE `Order` MODIFY `tokens` TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE `Receipt` MODIFY `payer` TEXT NULL,
    MODIFY `imageUrl` TEXT NULL,
    MODIFY `imageName` TEXT NULL,
    MODIFY `note` TEXT NULL;

-- AlterTable
ALTER TABLE `ReceiptHistory` MODIFY `payer` TEXT NULL,
    MODIFY `imageUrl` TEXT NULL,
    MODIFY `imageName` TEXT NULL,
    MODIFY `note` TEXT NULL;

-- AlterTable
ALTER TABLE `Swift` MODIFY `senderAddress` TEXT NULL,
    MODIFY `imageUrl` TEXT NULL,
    MODIFY `imageName` TEXT NULL,
    MODIFY `errorMessage` TEXT NULL;

-- AlterTable
ALTER TABLE `SystemSetting` MODIFY `value` TEXT NOT NULL;

