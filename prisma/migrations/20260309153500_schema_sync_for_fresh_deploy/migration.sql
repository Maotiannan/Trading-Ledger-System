-- Align fresh deployments with the current Prisma schema.
ALTER TABLE `AuditLog` MODIFY `metadata` JSON NULL;

ALTER TABLE `BalanceTransfer` MODIFY `amount` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `Customer` MODIFY `credit` DECIMAL(18, 2) NULL;

ALTER TABLE `Detail` MODIFY `totalAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE `DetailItem` MODIFY `amount` DECIMAL(18, 2) NOT NULL;

SET @order_created_by_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Order'
      AND COLUMN_NAME = 'createdBy'
  ),
  'SELECT 1',
  'ALTER TABLE `Order` ADD COLUMN `createdBy` VARCHAR(191) NULL'
);
PREPARE order_created_by_stmt FROM @order_created_by_sql;
EXECUTE order_created_by_stmt;
DEALLOCATE PREPARE order_created_by_stmt;

ALTER TABLE `Order`
  MODIFY `amount` DECIMAL(18, 2) NOT NULL,
  MODIFY `orderBalance` DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE `Receipt` MODIFY `usd` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `ReceiptHistory` MODIFY `usd` DECIMAL(18, 2) NOT NULL;

ALTER TABLE `Swift` MODIFY `amount` DECIMAL(18, 2) NOT NULL;

SET @user_level_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'User'
      AND COLUMN_NAME = 'level'
  ),
  'SELECT 1',
  'ALTER TABLE `User` ADD COLUMN `level` INTEGER NOT NULL DEFAULT 4'
);
PREPARE user_level_stmt FROM @user_level_sql;
EXECUTE user_level_stmt;
DEALLOCATE PREPARE user_level_stmt;

SET @user_parent_id_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'User'
      AND COLUMN_NAME = 'parentId'
  ),
  'SELECT 1',
  'ALTER TABLE `User` ADD COLUMN `parentId` VARCHAR(191) NULL'
);
PREPARE user_parent_id_stmt FROM @user_parent_id_sql;
EXECUTE user_parent_id_stmt;
DEALLOCATE PREPARE user_parent_id_stmt;

SET @order_created_by_idx_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Order'
      AND INDEX_NAME = 'Order_createdBy_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `Order_createdBy_idx` ON `Order`(`createdBy`)'
);
PREPARE order_created_by_idx_stmt FROM @order_created_by_idx_sql;
EXECUTE order_created_by_idx_stmt;
DEALLOCATE PREPARE order_created_by_idx_stmt;

SET @user_parent_id_idx_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'User'
      AND INDEX_NAME = 'User_parentId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `User_parentId_idx` ON `User`(`parentId`)'
);
PREPARE user_parent_id_idx_stmt FROM @user_parent_id_idx_sql;
EXECUTE user_parent_id_idx_stmt;
DEALLOCATE PREPARE user_parent_id_idx_stmt;

SET @user_level_idx_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'User'
      AND INDEX_NAME = 'User_level_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `User_level_idx` ON `User`(`level`)'
);
PREPARE user_level_idx_stmt FROM @user_level_idx_sql;
EXECUTE user_level_idx_stmt;
DEALLOCATE PREPARE user_level_idx_stmt;

SET @user_parent_id_fk_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'User'
      AND CONSTRAINT_NAME = 'User_parentId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `User` ADD CONSTRAINT `User_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE user_parent_id_fk_stmt FROM @user_parent_id_fk_sql;
EXECUTE user_parent_id_fk_stmt;
DEALLOCATE PREPARE user_parent_id_fk_stmt;

SET @order_created_by_fk_sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Order'
      AND CONSTRAINT_NAME = 'Order_createdBy_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `Order` ADD CONSTRAINT `Order_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE order_created_by_fk_stmt FROM @order_created_by_fk_sql;
EXECUTE order_created_by_fk_stmt;
DEALLOCATE PREPARE order_created_by_fk_stmt;
