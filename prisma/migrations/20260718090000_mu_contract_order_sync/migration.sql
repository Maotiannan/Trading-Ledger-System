ALTER TABLE `OrderTracker`
  ADD COLUMN `archivedAt` DATETIME(3) NULL,
  ADD COLUMN `archiveReason` TEXT NULL;

CREATE INDEX `OrderTracker_archivedAt_idx` ON `OrderTracker`(`archivedAt`);

CREATE TABLE `ExternalOrderSourceLink` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `externalId` VARCHAR(191) NOT NULL,
  `orderTrackerId` VARCHAR(191) NULL,
  `sourceVersion` INTEGER NOT NULL,
  `sourceOrderNo` VARCHAR(191) NOT NULL,
  `normalizedSourceOrderNo` VARCHAR(191) NOT NULL,
  `piCreatedAt` DATETIME(3) NOT NULL,
  `officialAmount` DECIMAL(18, 2) NULL,
  `currency` VARCHAR(191) NULL,
  `officialGeneratedAt` DATETIME(3) NULL,
  `officialGenerationRunId` VARCHAR(191) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `sourceDeletedAt` DATETIME(3) NULL,
  `linkMode` ENUM('MANUAL_ATTACHED', 'SYNC_CREATED') NOT NULL,
  `humanEditedAt` DATETIME(3) NULL,
  `humanEditedBy` VARCHAR(191) NULL,
  `customerMatchStatus` ENUM('MATCHED', 'UNMATCHED', 'CONFLICT') NOT NULL,
  `lastEventCursor` VARCHAR(191) NULL,
  `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSourceUpdatedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `ExternalOrderSourceLink_provider_externalId_key`
  ON `ExternalOrderSourceLink`(`provider`, `externalId`);
CREATE UNIQUE INDEX `ExternalOrderSourceLink_provider_orderTrackerId_key`
  ON `ExternalOrderSourceLink`(`provider`, `orderTrackerId`);
CREATE INDEX `ExternalOrderSourceLink_provider_active_idx`
  ON `ExternalOrderSourceLink`(`provider`, `active`);
CREATE INDEX `ExternalOrderSourceLink_customerMatchStatus_idx`
  ON `ExternalOrderSourceLink`(`customerMatchStatus`);
CREATE INDEX `ExternalOrderSourceLink_normalizedSourceOrderNo_idx`
  ON `ExternalOrderSourceLink`(`normalizedSourceOrderNo`);
CREATE INDEX `ExternalOrderSourceLink_humanEditedBy_idx`
  ON `ExternalOrderSourceLink`(`humanEditedBy`);

CREATE TABLE `IntegrationSyncState` (
  `provider` VARCHAR(191) NOT NULL,
  `committedCursor` VARCHAR(191) NULL,
  `lastAttemptAt` DATETIME(3) NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  `lastErrorCode` VARCHAR(191) NULL,
  `lastErrorMessage` TEXT NULL,
  `nextEligiblePollAt` DATETIME(3) NULL,
  `leaseOwner` VARCHAR(191) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `reconcileStatus` ENUM('IDLE', 'RUNNING', 'FAILED', 'COMPLETED') NOT NULL DEFAULT 'IDLE',
  `reconcileCursor` VARCHAR(191) NULL,
  `reconcileHighWatermark` VARCHAR(191) NULL,
  `initialReconcileCompletedAt` DATETIME(3) NULL,
  `serviceActorId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `IntegrationSyncState_leaseExpiresAt_idx` ON `IntegrationSyncState`(`leaseExpiresAt`);
CREATE INDEX `IntegrationSyncState_lastSuccessAt_idx` ON `IntegrationSyncState`(`lastSuccessAt`);
CREATE INDEX `IntegrationSyncState_serviceActorId_idx` ON `IntegrationSyncState`(`serviceActorId`);

CREATE TABLE `IntegrationEventReceipt` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `cursor` VARCHAR(191) NOT NULL,
  `sourcePiId` VARCHAR(191) NOT NULL,
  `sourceVersion` INTEGER NOT NULL,
  `payloadHash` VARCHAR(191) NOT NULL,
  `result` ENUM('APPLIED', 'IGNORED_STALE', 'BUSINESS_CONFLICT') NOT NULL,
  `orderTrackerId` VARCHAR(191) NULL,
  `processedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `IntegrationEventReceipt_provider_eventId_key`
  ON `IntegrationEventReceipt`(`provider`, `eventId`);
CREATE INDEX `IntegrationEventReceipt_provider_cursor_idx`
  ON `IntegrationEventReceipt`(`provider`, `cursor`);
CREATE INDEX `IntegrationEventReceipt_provider_sourcePi_version_idx`
  ON `IntegrationEventReceipt`(`provider`, `sourcePiId`, `sourceVersion`);
CREATE INDEX `IntegrationEventReceipt_orderTrackerId_idx`
  ON `IntegrationEventReceipt`(`orderTrackerId`);

CREATE TABLE `IntegrationSyncConflict` (
  `id` VARCHAR(191) NOT NULL,
  `dedupeKey` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `sourcePiId` VARCHAR(191) NOT NULL,
  `sourceVersion` INTEGER NOT NULL,
  `eventId` VARCHAR(191) NULL,
  `cursor` VARCHAR(191) NULL,
  `type` ENUM('INVALID_SOURCE_DATA', 'ORDER_NO_COLLISION', 'SOURCE_LINK_COLLISION', 'HUMAN_EDITED_RENAME_COLLISION', 'CUSTOMER_MATCH_CONFLICT', 'UNSUPPORTED_CURRENCY') NOT NULL,
  `sourceOrderNo` VARCHAR(191) NULL,
  `targetOrderTrackerIds` JSON NOT NULL,
  `summary` TEXT NOT NULL,
  `evidence` JSON NOT NULL,
  `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
  `resolutionNote` TEXT NULL,
  `resolvedAt` DATETIME(3) NULL,
  `resolvedBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `IntegrationSyncConflict_dedupeKey_key`
  ON `IntegrationSyncConflict`(`dedupeKey`);
CREATE INDEX `IntegrationSyncConflict_provider_status_idx`
  ON `IntegrationSyncConflict`(`provider`, `status`);
CREATE INDEX `IntegrationSyncConflict_provider_sourcePiId_idx`
  ON `IntegrationSyncConflict`(`provider`, `sourcePiId`);
CREATE INDEX `IntegrationSyncConflict_resolvedBy_idx`
  ON `IntegrationSyncConflict`(`resolvedBy`);

CREATE TABLE `IntegrationReconcilePreview` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `sourceHighWatermark` VARCHAR(191) NOT NULL,
  `snapshotSummary` JSON NOT NULL,
  `summaryHash` VARCHAR(191) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `IntegrationReconcilePreview_provider_expiresAt_idx`
  ON `IntegrationReconcilePreview`(`provider`, `expiresAt`);
CREATE INDEX `IntegrationReconcilePreview_createdBy_idx`
  ON `IntegrationReconcilePreview`(`createdBy`);

ALTER TABLE `ExternalOrderSourceLink`
  ADD CONSTRAINT `ExternalOrderSourceLink_orderTrackerId_fkey`
  FOREIGN KEY (`orderTrackerId`) REFERENCES `OrderTracker`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ExternalOrderSourceLink_humanEditedBy_fkey`
  FOREIGN KEY (`humanEditedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IntegrationSyncState`
  ADD CONSTRAINT `IntegrationSyncState_serviceActorId_fkey`
  FOREIGN KEY (`serviceActorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `IntegrationEventReceipt`
  ADD CONSTRAINT `IntegrationEventReceipt_orderTrackerId_fkey`
  FOREIGN KEY (`orderTrackerId`) REFERENCES `OrderTracker`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IntegrationSyncConflict`
  ADD CONSTRAINT `IntegrationSyncConflict_resolvedBy_fkey`
  FOREIGN KEY (`resolvedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `IntegrationReconcilePreview`
  ADD CONSTRAINT `IntegrationReconcilePreview_createdBy_fkey`
  FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
