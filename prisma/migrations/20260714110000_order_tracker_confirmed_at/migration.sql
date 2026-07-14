ALTER TABLE `OrderTracker`
  ADD COLUMN `confirmedAt` DATETIME(3) NULL;

UPDATE `OrderTracker`
SET `confirmedAt` = `updatedAt`
WHERE `status` = 'Confirmed'
  AND `confirmedAt` IS NULL;
