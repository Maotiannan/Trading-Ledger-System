ALTER TABLE `BalanceTransfer`
  ADD COLUMN `generatedReceiptId` VARCHAR(191) NULL;

CREATE TEMPORARY TABLE `_BalanceTransferReceiptCandidates` AS
SELECT bt.`id` AS `transferId`, receipt.`id` AS `receiptId`
FROM `BalanceTransfer` bt
JOIN `Order` source_order ON source_order.`id` = bt.`fromOrderId`
JOIN `Receipt` receipt
  ON receipt.`orderId` = bt.`toOrderId`
 AND receipt.`usd` = bt.`amount`
 AND receipt.`createdBy` = bt.`createdBy`
 AND receipt.`receiptNo` LIKE 'TRANSFER-%'
 AND receipt.`payer` = CONCAT('余额转移自 ', source_order.`orderNo`)
 AND receipt.`note` = CONCAT('从订单 ', source_order.`orderNo`, ' 转移的余额')
 AND ABS(TIMESTAMPDIFF(SECOND, receipt.`createdAt`, bt.`createdAt`)) <= 5
WHERE bt.`generatedReceiptId` IS NULL;

CREATE TEMPORARY TABLE `_BalanceTransferCandidateCounts` AS
SELECT `transferId`, COUNT(*) AS `candidateCount`
FROM `_BalanceTransferReceiptCandidates`
GROUP BY `transferId`;

CREATE TEMPORARY TABLE `_ReceiptTransferCandidateCounts` AS
SELECT `receiptId`, COUNT(*) AS `candidateCount`
FROM `_BalanceTransferReceiptCandidates`
GROUP BY `receiptId`;

UPDATE `BalanceTransfer` bt
JOIN `_BalanceTransferReceiptCandidates` candidate
  ON candidate.`transferId` = bt.`id`
JOIN `_BalanceTransferCandidateCounts` transfer_count
  ON transfer_count.`transferId` = candidate.`transferId`
 AND transfer_count.`candidateCount` = 1
JOIN `_ReceiptTransferCandidateCounts` receipt_count
  ON receipt_count.`receiptId` = candidate.`receiptId`
 AND receipt_count.`candidateCount` = 1
SET bt.`generatedReceiptId` = candidate.`receiptId`
WHERE bt.`generatedReceiptId` IS NULL;

DROP TEMPORARY TABLE `_ReceiptTransferCandidateCounts`;
DROP TEMPORARY TABLE `_BalanceTransferCandidateCounts`;
DROP TEMPORARY TABLE `_BalanceTransferReceiptCandidates`;

CREATE UNIQUE INDEX `BalanceTransfer_generatedReceiptId_key`
  ON `BalanceTransfer`(`generatedReceiptId`);

ALTER TABLE `BalanceTransfer`
  ADD CONSTRAINT `BalanceTransfer_generatedReceiptId_fkey`
  FOREIGN KEY (`generatedReceiptId`) REFERENCES `Receipt`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
