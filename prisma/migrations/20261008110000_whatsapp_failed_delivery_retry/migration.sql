ALTER TABLE `WhatsAppDelivery`
  ADD COLUMN `retryOf` VARCHAR(191) NULL;

CREATE INDEX `WhatsAppDelivery_retryOf_idx` ON `WhatsAppDelivery` (`retryOf`);

ALTER TABLE `WhatsAppDelivery`
  ADD CONSTRAINT `WhatsAppDelivery_retryOf_fkey`
  FOREIGN KEY (`retryOf`) REFERENCES `WhatsAppDelivery`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
