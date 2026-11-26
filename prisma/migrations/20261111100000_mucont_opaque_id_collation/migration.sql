-- External IDs are opaque and case sensitive. Financial Invoice/Order IDs and
-- business ORDER aliases retain their existing collation.
ALTER TABLE MucontInvoiceGroup DROP FOREIGN KEY MucontInvoiceGroup_invoiceBatchId_fkey;
ALTER TABLE MucontInvoiceGeneration DROP FOREIGN KEY MucontInvoiceGeneration_invoiceBatchId_fkey;
ALTER TABLE MucontInvoiceResync DROP FOREIGN KEY MucontInvoiceResync_invoiceBatchId_fkey;
ALTER TABLE MucontInvoiceSource
  MODIFY invoiceBatchId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY generationId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE MucontInvoiceGroup
  MODIFY invoiceBatchId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY billingGroupId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE MucontInvoiceGeneration
  MODIFY invoiceBatchId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY generationId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE MucontInvoiceResync
  MODIFY invoiceBatchId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY generationId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY requestId VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE MucontInvoiceGroup ADD CONSTRAINT MucontInvoiceGroup_invoiceBatchId_fkey
  FOREIGN KEY (invoiceBatchId) REFERENCES MucontInvoiceSource(invoiceBatchId) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE MucontInvoiceGeneration ADD CONSTRAINT MucontInvoiceGeneration_invoiceBatchId_fkey
  FOREIGN KEY (invoiceBatchId) REFERENCES MucontInvoiceSource(invoiceBatchId) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE MucontInvoiceResync ADD CONSTRAINT MucontInvoiceResync_invoiceBatchId_fkey
  FOREIGN KEY (invoiceBatchId) REFERENCES MucontInvoiceSource(invoiceBatchId) ON DELETE RESTRICT ON UPDATE CASCADE;
