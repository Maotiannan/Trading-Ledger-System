CREATE TABLE `ExcelApiToken` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL DEFAULT 'Excel ML',
  `token_prefix` VARCHAR(191) NOT NULL,
  `token_hash` VARCHAR(191) NOT NULL,
  `last_used_at` DATETIME(3) NULL,
  `last_used_ip` VARCHAR(191) NULL,
  `revoked_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `ExcelApiToken_token_prefix_key` ON `ExcelApiToken`(`token_prefix`);
CREATE INDEX `ExcelApiToken_userId_revoked_at_idx` ON `ExcelApiToken`(`userId`, `revoked_at`);
CREATE INDEX `ExcelApiToken_last_used_at_idx` ON `ExcelApiToken`(`last_used_at`);

ALTER TABLE `ExcelApiToken`
  ADD CONSTRAINT `ExcelApiToken_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
