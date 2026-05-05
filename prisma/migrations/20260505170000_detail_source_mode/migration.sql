ALTER TABLE `Detail`
  ADD COLUMN `sourceMode` ENUM('OCR', 'DIRECT') NOT NULL DEFAULT 'OCR';

UPDATE `Detail`
SET `sourceMode` = 'DIRECT'
WHERE `imageUrl` IS NULL;
