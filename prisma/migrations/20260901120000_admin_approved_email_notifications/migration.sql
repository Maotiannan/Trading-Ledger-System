-- Customer notification language is additive and existing customers default to English.
ALTER TABLE `Customer`
  ADD COLUMN `notificationLanguage` ENUM('ENGLISH', 'FRENCH') NOT NULL DEFAULT 'ENGLISH';

CREATE TABLE `CustomerNotificationEmail` (
  `id` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `normalizedEmail` VARCHAR(320) NOT NULL,
  `isPrimary` BOOLEAN NOT NULL DEFAULT false,
  `createdBy` VARCHAR(191) NOT NULL,
  `updatedBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CustomerNotificationEmail_customerId_normalizedEmail_key` (`customerId`, `normalizedEmail`),
  INDEX `CustomerNotificationEmail_customerId_isPrimary_idx` (`customerId`, `isPrimary`),
  INDEX `CustomerNotificationEmail_createdBy_idx` (`createdBy`),
  INDEX `CustomerNotificationEmail_updatedBy_idx` (`updatedBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmailTemplate` (
  `id` VARCHAR(191) NOT NULL,
  `type` ENUM('PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE') NOT NULL,
  `language` ENUM('ENGLISH', 'FRENCH') NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `subjectTemplate` TEXT NOT NULL,
  `bodyTemplate` LONGTEXT NOT NULL,
  `requiredVariables` JSON NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `EmailTemplate_type_language_version_key` (`type`, `language`, `version`),
  INDEX `EmailTemplate_type_language_isActive_idx` (`type`, `language`, `isActive`),
  INDEX `EmailTemplate_createdBy_idx` (`createdBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmailNotification` (
  `id` VARCHAR(191) NOT NULL,
  `eventKey` VARCHAR(191) NOT NULL,
  `type` ENUM('PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE') NOT NULL,
  `status` ENUM('MISSING_RECIPIENT', 'PENDING', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'DELIVERY_DELAYED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'PARTIALLY_SENT', 'FAILED', 'DELIVERY_UNCERTAIN', 'CANCELLED', 'NEEDS_CORRECTION') NOT NULL DEFAULT 'PENDING',
  `customerId` VARCHAR(191) NULL,
  `receiptId` VARCHAR(191) NULL,
  `invoiceId` VARCHAR(191) NULL,
  `parentNotificationId` VARCHAR(191) NULL,
  `sourceActorId` VARCHAR(191) NULL,
  `currentSnapshot` JSON NOT NULL,
  `correctionReason` TEXT NULL,
  `approvedBy` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `cancelledBy` VARCHAR(191) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `EmailNotification_eventKey_key` (`eventKey`),
  INDEX `EmailNotification_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `EmailNotification_customerId_type_idx` (`customerId`, `type`),
  INDEX `EmailNotification_receiptId_idx` (`receiptId`),
  INDEX `EmailNotification_invoiceId_idx` (`invoiceId`),
  INDEX `EmailNotification_parentNotificationId_idx` (`parentNotificationId`),
  INDEX `EmailNotification_sourceActorId_idx` (`sourceActorId`),
  INDEX `EmailNotification_approvedBy_idx` (`approvedBy`),
  INDEX `EmailNotification_cancelledBy_idx` (`cancelledBy`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmailDelivery` (
  `id` VARCHAR(191) NOT NULL,
  `notificationId` VARCHAR(191) NOT NULL,
  `templateId` VARCHAR(191) NULL,
  `status` ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'DELIVERY_DELAYED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'FAILED', 'DELIVERY_UNCERTAIN', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
  `recipientMode` ENUM('PRIMARY_CC', 'SEPARATE') NOT NULL,
  `language` ENUM('ENGLISH', 'FRENCH') NOT NULL,
  `templateVersion` INTEGER NOT NULL,
  `senderName` VARCHAR(191) NOT NULL,
  `senderAddress` VARCHAR(320) NOT NULL,
  `replyToAddress` VARCHAR(320) NULL,
  `intendedTo` JSON NOT NULL,
  `intendedCc` JSON NOT NULL,
  `actualTo` JSON NOT NULL,
  `actualCc` JSON NOT NULL,
  `subject` TEXT NOT NULL,
  `htmlBody` LONGTEXT NOT NULL,
  `textBody` LONGTEXT NOT NULL,
  `businessSnapshot` JSON NOT NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `claimToken` VARCHAR(191) NULL,
  `claimExpiresAt` DATETIME(3) NULL,
  `nextAttemptAt` DATETIME(3) NULL,
  `acceptedAt` DATETIME(3) NULL,
  `deliveredAt` DATETIME(3) NULL,
  `lastErrorCode` VARCHAR(191) NULL,
  `lastErrorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `EmailDelivery_providerMessageId_key` (`providerMessageId`),
  UNIQUE INDEX `EmailDelivery_idempotencyKey_key` (`idempotencyKey`),
  INDEX `EmailDelivery_status_nextAttemptAt_idx` (`status`, `nextAttemptAt`),
  INDEX `EmailDelivery_claimExpiresAt_idx` (`claimExpiresAt`),
  INDEX `EmailDelivery_notificationId_idx` (`notificationId`),
  INDEX `EmailDelivery_templateId_idx` (`templateId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmailDeliveryAttempt` (
  `id` VARCHAR(191) NOT NULL,
  `deliveryId` VARCHAR(191) NOT NULL,
  `attemptNo` INTEGER NOT NULL,
  `status` ENUM('STARTED', 'ACCEPTED', 'REJECTED', 'UNCERTAIN') NOT NULL DEFAULT 'STARTED',
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `failureCode` VARCHAR(191) NULL,
  `failureMessage` TEXT NULL,
  `responseMetadata` JSON NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  UNIQUE INDEX `EmailDeliveryAttempt_deliveryId_attemptNo_key` (`deliveryId`, `attemptNo`),
  INDEX `EmailDeliveryAttempt_status_startedAt_idx` (`status`, `startedAt`),
  INDEX `EmailDeliveryAttempt_providerMessageId_idx` (`providerMessageId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmailWebhookEvent` (
  `id` VARCHAR(191) NOT NULL,
  `providerEventId` VARCHAR(191) NOT NULL,
  `deliveryId` VARCHAR(191) NULL,
  `providerMessageId` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `appliedAt` DATETIME(3) NULL,
  UNIQUE INDEX `EmailWebhookEvent_providerEventId_key` (`providerEventId`),
  INDEX `EmailWebhookEvent_providerMessageId_occurredAt_idx` (`providerMessageId`, `occurredAt`),
  INDEX `EmailWebhookEvent_deliveryId_idx` (`deliveryId`),
  INDEX `EmailWebhookEvent_eventType_occurredAt_idx` (`eventType`, `occurredAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerNotificationEmail`
  ADD CONSTRAINT `CustomerNotificationEmail_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `CustomerNotificationEmail_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CustomerNotificationEmail_updatedBy_fkey`
    FOREIGN KEY (`updatedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EmailTemplate`
  ADD CONSTRAINT `EmailTemplate_createdBy_fkey`
    FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EmailNotification`
  ADD CONSTRAINT `EmailNotification_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `EmailNotification_receiptId_fkey`
    FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `EmailNotification_invoiceId_fkey`
    FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `EmailNotification_parentNotificationId_fkey`
    FOREIGN KEY (`parentNotificationId`) REFERENCES `EmailNotification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `EmailNotification_sourceActorId_fkey`
    FOREIGN KEY (`sourceActorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `EmailNotification_approvedBy_fkey`
    FOREIGN KEY (`approvedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `EmailNotification_cancelledBy_fkey`
    FOREIGN KEY (`cancelledBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EmailDelivery`
  ADD CONSTRAINT `EmailDelivery_notificationId_fkey`
    FOREIGN KEY (`notificationId`) REFERENCES `EmailNotification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `EmailDelivery_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `EmailTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EmailDeliveryAttempt`
  ADD CONSTRAINT `EmailDeliveryAttempt_deliveryId_fkey`
    FOREIGN KEY (`deliveryId`) REFERENCES `EmailDelivery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `EmailWebhookEvent`
  ADD CONSTRAINT `EmailWebhookEvent_deliveryId_fkey`
    FOREIGN KEY (`deliveryId`) REFERENCES `EmailDelivery`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual application rollback procedure (documentation only; never run automatically):
-- 1. Disable outbound approval and stop the email delivery trigger.
-- 2. Export all six email feature tables so immutable sent history is preserved.
-- 3. Roll back the application while leaving these additive tables and
--    Customer.notificationLanguage intact unless an explicit data-removal change is approved.
-- Dropping feature tables or the Customer column is intentionally absent from this migration.
