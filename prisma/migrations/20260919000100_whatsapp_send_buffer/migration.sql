ALTER TABLE `WhatsAppDelivery`
  MODIFY `status` ENUM('PENDING','PAUSED','QUEUED','SENDING','ACCEPTED','SENT','DELIVERED','READ','FAILED','UNCERTAIN','CANCELLED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `nextSendAt` DATETIME(3) NULL,
  ADD COLUMN `requiresApproval` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `correctionOf` JSON NULL;

UPDATE `WhatsAppDelivery`
SET `nextSendAt` = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE),
    `requiresApproval` = `testMode`
WHERE `status` IN ('PENDING', 'QUEUED');

CREATE INDEX `WhatsAppDelivery_status_nextSendAt_idx` ON `WhatsAppDelivery` (`status`, `nextSendAt`);
