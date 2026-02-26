-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('SR_Received', 'Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED');

-- CreateEnum
CREATE TYPE "DetailStatus" AS ENUM ('Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED', 'ERROR');

-- CreateEnum
CREATE TYPE "DeletionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeletionTargetType" AS ENUM ('RECEIPT', 'DETAIL', 'SWIFT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invNo" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "tokens" TEXT NOT NULL DEFAULT '[]',
    "amount" DOUBLE PRECISION NOT NULL,
    "orderBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "receiptNo" TEXT,
    "date" TIMESTAMP(3),
    "tel" TEXT,
    "usd" DOUBLE PRECISION NOT NULL,
    "invNo" TEXT,
    "orderNo" TEXT,
    "payer" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'SR_Received',
    "imageUrl" TEXT,
    "imageName" TEXT,
    "isDeposit" BOOLEAN NOT NULL DEFAULT false,
    "isMerged" BOOLEAN NOT NULL DEFAULT false,
    "mergedToId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptHistory" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "receiptNo" TEXT,
    "date" TIMESTAMP(3),
    "tel" TEXT,
    "usd" DOUBLE PRECISION NOT NULL,
    "invNo" TEXT,
    "orderNo" TEXT,
    "payer" TEXT,
    "imageUrl" TEXT,
    "imageName" TEXT,
    "status" "ReceiptStatus" NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detail" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "status" "DetailStatus" NOT NULL DEFAULT 'Waiting_SWIFT',
    "imageUrl" TEXT,
    "imageName" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetailItem" (
    "id" TEXT NOT NULL,
    "detailId" TEXT NOT NULL,
    "mark" TEXT,
    "orderNo" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "receiptId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetailItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetailHistory" (
    "id" TEXT NOT NULL,
    "detailId" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "items" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageName" TEXT,
    "status" "DetailStatus" NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetailHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Swift" (
    "id" TEXT NOT NULL,
    "detailId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3),
    "senderName" TEXT,
    "senderAddress" TEXT,
    "receiverName" TEXT,
    "receiverAccount" TEXT,
    "imageUrl" TEXT,
    "imageName" TEXT,
    "hasError" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Swift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL,
    "targetType" "DeletionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "DeletionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceTransfer" (
    "id" TEXT NOT NULL,
    "fromOrderId" TEXT NOT NULL,
    "toOrderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invNo_key" ON "Invoice"("invNo");

-- CreateIndex
CREATE INDEX "Invoice_invNo_idx" ON "Invoice"("invNo");

-- CreateIndex
CREATE INDEX "Order_invoiceId_idx" ON "Order"("invoiceId");

-- CreateIndex
CREATE INDEX "Order_orderNo_idx" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Receipt_orderNo_idx" ON "Receipt"("orderNo");

-- CreateIndex
CREATE INDEX "Receipt_invNo_idx" ON "Receipt"("invNo");

-- CreateIndex
CREATE INDEX "Receipt_status_idx" ON "Receipt"("status");

-- CreateIndex
CREATE INDEX "Receipt_createdBy_idx" ON "Receipt"("createdBy");

-- CreateIndex
CREATE INDEX "ReceiptHistory_receiptId_idx" ON "ReceiptHistory"("receiptId");

-- CreateIndex
CREATE INDEX "Detail_status_idx" ON "Detail"("status");

-- CreateIndex
CREATE INDEX "Detail_createdBy_idx" ON "Detail"("createdBy");

-- CreateIndex
CREATE INDEX "DetailItem_detailId_idx" ON "DetailItem"("detailId");

-- CreateIndex
CREATE INDEX "DetailItem_orderNo_idx" ON "DetailItem"("orderNo");

-- CreateIndex
CREATE INDEX "DetailItem_receiptId_idx" ON "DetailItem"("receiptId");

-- CreateIndex
CREATE INDEX "DetailHistory_detailId_idx" ON "DetailHistory"("detailId");

-- CreateIndex
CREATE UNIQUE INDEX "Swift_detailId_key" ON "Swift"("detailId");

-- CreateIndex
CREATE INDEX "Swift_detailId_idx" ON "Swift"("detailId");

-- CreateIndex
CREATE INDEX "DeletionRequest_targetType_idx" ON "DeletionRequest"("targetType");

-- CreateIndex
CREATE INDEX "DeletionRequest_targetId_idx" ON "DeletionRequest"("targetId");

-- CreateIndex
CREATE INDEX "DeletionRequest_status_idx" ON "DeletionRequest"("status");

-- CreateIndex
CREATE INDEX "BalanceTransfer_fromOrderId_idx" ON "BalanceTransfer"("fromOrderId");

-- CreateIndex
CREATE INDEX "BalanceTransfer_toOrderId_idx" ON "BalanceTransfer"("toOrderId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_mergedToId_fkey" FOREIGN KEY ("mergedToId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptHistory" ADD CONSTRAINT "ReceiptHistory_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptHistory" ADD CONSTRAINT "ReceiptHistory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detail" ADD CONSTRAINT "Detail_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetailItem" ADD CONSTRAINT "DetailItem_detailId_fkey" FOREIGN KEY ("detailId") REFERENCES "Detail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetailItem" ADD CONSTRAINT "DetailItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetailHistory" ADD CONSTRAINT "DetailHistory_detailId_fkey" FOREIGN KEY ("detailId") REFERENCES "Detail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetailHistory" ADD CONSTRAINT "DetailHistory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swift" ADD CONSTRAINT "Swift_detailId_fkey" FOREIGN KEY ("detailId") REFERENCES "Detail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swift" ADD CONSTRAINT "Swift_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceTransfer" ADD CONSTRAINT "BalanceTransfer_fromOrderId_fkey" FOREIGN KEY ("fromOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceTransfer" ADD CONSTRAINT "BalanceTransfer_toOrderId_fkey" FOREIGN KEY ("toOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

