ALTER TABLE `Detail`
  ADD COLUMN `agentId` VARCHAR(191) NULL;

CREATE INDEX `Detail_agentId_idx` ON `Detail`(`agentId`);

CREATE TABLE `PaymentAgent` (
  `id` VARCHAR(191) NOT NULL,
  `companyName` VARCHAR(191) NOT NULL,
  `companyAddress` TEXT NULL,
  `contactName` VARCHAR(191) NULL,
  `contactPhone` VARCHAR(191) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PaymentAgentFile` (
  `id` VARCHAR(191) NOT NULL,
  `agentId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `path` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `size` INTEGER NOT NULL,
  `uploadedBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Detail`
  ADD CONSTRAINT `Detail_agentId_fkey`
  FOREIGN KEY (`agentId`) REFERENCES `PaymentAgent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PaymentAgent`
  ADD CONSTRAINT `PaymentAgent_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PaymentAgentFile`
  ADD CONSTRAINT `PaymentAgentFile_agentId_fkey`
  FOREIGN KEY (`agentId`) REFERENCES `PaymentAgent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PaymentAgentFile`
  ADD CONSTRAINT `PaymentAgentFile_uploadedBy_fkey`
  FOREIGN KEY (`uploadedBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX `PaymentAgent_createdBy_idx` ON `PaymentAgent`(`createdBy`);
CREATE INDEX `PaymentAgent_companyName_idx` ON `PaymentAgent`(`companyName`);
CREATE INDEX `PaymentAgentFile_agentId_idx` ON `PaymentAgentFile`(`agentId`);
