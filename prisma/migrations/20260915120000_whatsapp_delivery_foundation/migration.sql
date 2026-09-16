-- CreateTable
CREATE TABLE `CustomerWhatsAppContact` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(16) NOT NULL,
    `optedInAt` DATETIME(3) NULL,
    `optedOutAt` DATETIME(3) NULL,
    `consentSource` VARCHAR(255) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerWhatsAppContact_customerId_phone_key`(`customerId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `type` ENUM('PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE') NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `testMode` BOOLEAN NOT NULL,
    `intendedTo` VARCHAR(16) NOT NULL,
    `actualTo` VARCHAR(16) NOT NULL,
    `senderPhone` VARCHAR(16) NOT NULL,
    `templateName` VARCHAR(191) NOT NULL,
    `languageCode` VARCHAR(20) NOT NULL,
    `parameters` JSON NOT NULL,
    `businessSnapshot` JSON NOT NULL,
    `status` ENUM('PENDING', 'QUEUED', 'SENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNCERTAIN', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `claimToken` VARCHAR(191) NULL,
    `claimedAt` DATETIME(3) NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `lastEventAt` DATETIME(3) NULL,
    `failureCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppDelivery_eventKey_key`(`eventKey`),
    UNIQUE INDEX `WhatsAppDelivery_providerMessageId_key`(`providerMessageId`),
    INDEX `WhatsAppDelivery_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `WhatsAppDelivery_contactId_idx`(`contactId`),
    INDEX `WhatsAppDelivery_type_sourceId_idx`(`type`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppWebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `providerEventId` VARCHAR(191) NOT NULL,
    `providerMessageId` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `appliedAt` DATETIME(3) NULL,
    `deliveryId` VARCHAR(191) NULL,

    UNIQUE INDEX `WhatsAppWebhookEvent_providerEventId_key`(`providerEventId`),
    INDEX `WhatsAppWebhookEvent_providerMessageId_idx`(`providerMessageId`),
    INDEX `WhatsAppWebhookEvent_appliedAt_receivedAt_idx`(`appliedAt`, `receivedAt`),
    INDEX `WhatsAppWebhookEvent_deliveryId_idx`(`deliveryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CustomerWhatsAppContact` ADD CONSTRAINT `CustomerWhatsAppContact_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppDelivery` ADD CONSTRAINT `WhatsAppDelivery_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `CustomerWhatsAppContact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppWebhookEvent` ADD CONSTRAINT `WhatsAppWebhookEvent_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `WhatsAppDelivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

