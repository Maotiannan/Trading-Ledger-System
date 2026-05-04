CREATE TABLE `UserPreference` (
  `userId` VARCHAR(191) NOT NULL,
  `imageCompressionEnabled` BOOLEAN NOT NULL DEFAULT true,
  `imageCompressionQualityFloor` DECIMAL(3, 2) NOT NULL DEFAULT 0.30,
  `ocrTargetMaxKb` INTEGER NOT NULL DEFAULT 500,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserPreference`
  ADD CONSTRAINT `UserPreference_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
