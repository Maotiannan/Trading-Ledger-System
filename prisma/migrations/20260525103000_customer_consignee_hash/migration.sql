-- Use a fixed-length hash for idempotency so long CONSIGNEE text can be stored safely.
ALTER TABLE `CustomerConsignee`
  ADD COLUMN `normalized_consignee_hash` VARCHAR(64) NULL;

UPDATE `CustomerConsignee`
SET `normalized_consignee_hash` = SHA2(`normalized_consignee`, 256)
WHERE `normalized_consignee_hash` IS NULL;

ALTER TABLE `CustomerConsignee`
  MODIFY `normalized_consignee_hash` VARCHAR(64) NOT NULL;

DROP INDEX `CustomerConsignee_customerId_normalized_consignee_key` ON `CustomerConsignee`;
DROP INDEX `CustomerConsignee_normalized_consignee_idx` ON `CustomerConsignee`;

ALTER TABLE `CustomerConsignee`
  MODIFY `normalized_consignee` TEXT NOT NULL;

CREATE UNIQUE INDEX `CustomerConsignee_customerId_normalized_consignee_hash_key`
  ON `CustomerConsignee`(`customerId`, `normalized_consignee_hash`);

CREATE INDEX `CustomerConsignee_normalized_consignee_hash_idx`
  ON `CustomerConsignee`(`normalized_consignee_hash`);
