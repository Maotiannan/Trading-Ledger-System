-- No backfill: the customer PHONE is not an insurer contact.
ALTER TABLE `Customer` ADD COLUMN `companyContact` TEXT NULL;
