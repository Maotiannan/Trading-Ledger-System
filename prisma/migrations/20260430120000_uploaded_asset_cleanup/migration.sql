CREATE TABLE `UploadedAsset` (
  `id` VARCHAR(191) NOT NULL,
  `path` LONGTEXT NOT NULL,
  `name` TEXT NOT NULL,
  `category` ENUM('RECEIPT_DIRECT','RECEIPT_OCR','DETAIL_OCR','SWIFT_OCR','RECEIPT_GENERATOR_FINAL','RECEIPT_GENERATOR_SIGNATURE') NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `status` ENUM('STAGED','ATTACHED','DELETED') NOT NULL DEFAULT 'STAGED',
  `attachedType` ENUM('RECEIPT','DETAIL','SWIFT','RECEIPT_GENERATOR_SESSION') NULL,
  `attachedId` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UploadedAsset_path_key`(`path`(255)),
  INDEX `UploadedAsset_status_expiresAt_idx`(`status`, `expiresAt`),
  INDEX `UploadedAsset_attachedType_attachedId_idx`(`attachedType`, `attachedId`),
  INDEX `UploadedAsset_category_createdAt_idx`(`category`, `createdAt`),
  INDEX `UploadedAsset_createdBy_createdAt_idx`(`createdBy`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UploadedAsset`
  ADD CONSTRAINT `UploadedAsset_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
