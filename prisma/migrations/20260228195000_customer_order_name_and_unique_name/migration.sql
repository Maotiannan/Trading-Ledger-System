-- Rename legacy customer name to order_name
ALTER TABLE "Customer" RENAME COLUMN "name" TO "order_name";

-- Add new unique NAME field
ALTER TABLE "Customer" ADD COLUMN "name" TEXT;

-- Backfill NAME from ORDER_NAME, dedupe with suffix (_2, _3, ...)
WITH ranked AS (
  SELECT
    id,
    order_name,
    ROW_NUMBER() OVER (PARTITION BY order_name ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Customer"
)
UPDATE "Customer" c
SET "name" = CASE
  WHEN r.rn = 1 THEN r.order_name
  ELSE r.order_name || '_' || r.rn::text
END
FROM ranked r
WHERE c.id = r.id;

ALTER TABLE "Customer" ALTER COLUMN "name" SET NOT NULL;

CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");
DROP INDEX IF EXISTS "Customer_name_idx";
CREATE INDEX "Customer_order_name_idx" ON "Customer"("order_name");
