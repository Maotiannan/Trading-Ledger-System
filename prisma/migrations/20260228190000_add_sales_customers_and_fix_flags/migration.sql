-- Add SALES role
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SALES';

-- Swift status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SwiftStatus') THEN
    CREATE TYPE "SwiftStatus" AS ENUM ('Bank_Transfer', 'RECEIVED', 'ERROR');
  END IF;
END$$;

-- User creator relationship
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'User_createdById_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "User_createdById_idx" ON "User"("createdById");

-- Customer table
CREATE TABLE IF NOT EXISTS "Customer" (
    "id" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "consignee" TEXT NOT NULL,
    "companyName" TEXT,
    "credit" DOUBLE PRECISION,
    "companyAddress" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Customer_createdBy_fkey'
  ) THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "Customer_mark_idx" ON "Customer"("mark");
CREATE INDEX IF NOT EXISTS "Customer_name_idx" ON "Customer"("name");

-- Order customer fields and fix-flag
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerMark" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerCity" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "needsCustomerFix" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Order_customerId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- Receipt customer fields and fix-flag
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "customerMark" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "customerCity" TEXT;
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "needsCustomerFix" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Receipt_customerId_fkey'
  ) THEN
    ALTER TABLE "Receipt"
      ADD CONSTRAINT "Receipt_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- Swift status persistence
ALTER TABLE "Swift" ADD COLUMN IF NOT EXISTS "status" "SwiftStatus" NOT NULL DEFAULT 'Bank_Transfer';
CREATE INDEX IF NOT EXISTS "Swift_status_idx" ON "Swift"("status");

-- Backfill Swift status from Detail status
UPDATE "Swift" s
SET "status" = CASE
  WHEN d."status"::text = 'RECEIVED' THEN 'RECEIVED'::"SwiftStatus"
  WHEN d."status"::text = 'ERROR' THEN 'ERROR'::"SwiftStatus"
  ELSE 'Bank_Transfer'::"SwiftStatus"
END
FROM "Detail" d
WHERE s."detailId" = d."id";
