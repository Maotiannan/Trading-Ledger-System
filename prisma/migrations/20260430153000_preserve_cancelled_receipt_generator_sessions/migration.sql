ALTER TABLE `ReceiptGeneratorSession`
  DROP FOREIGN KEY `ReceiptGeneratorSession_receiptId_fkey`;

ALTER TABLE `ReceiptGeneratorSession`
  MODIFY `receiptId` VARCHAR(191) NULL;

ALTER TABLE `ReceiptGeneratorSession`
  ADD CONSTRAINT `ReceiptGeneratorSession_receiptId_fkey`
  FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
