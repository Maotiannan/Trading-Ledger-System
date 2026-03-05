ALTER TABLE `Customer`
  ADD COLUMN `ownerId` VARCHAR(191) NULL,
  MODIFY `name` TEXT NOT NULL,
  MODIFY `companyName` TEXT NULL,
  MODIFY `companyAddress` TEXT NULL;

UPDATE `Customer`
SET `ownerId` = `createdBy`
WHERE `ownerId` IS NULL;

DROP INDEX `Customer_name_key` ON `Customer`;

ALTER TABLE `Customer`
  MODIFY `ownerId` VARCHAR(191) NOT NULL;

CREATE INDEX `Customer_ownerId_idx` ON `Customer`(`ownerId`);

ALTER TABLE `Customer`
  ADD CONSTRAINT `Customer_ownerId_fkey`
  FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
