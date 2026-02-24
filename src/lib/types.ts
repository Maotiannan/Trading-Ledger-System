// 状态类型定义
export type { ReceiptStatus, DetailStatus, DeletionStatus, UserRole, DeletionTargetType } from '@prisma/client';

// API响应类型
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 分页参数
export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// 账单创建输入
export interface CreateInvoiceInput {
  invNo: string;
  orders: {
    orderNo: string;
    amount: number;
  }[];
}

// 收据AI识别结果
export interface ReceiptOcrResult {
  receiptNo: string | null;
  date: string | null;
  tel: string | null;
  usd: number | null;
  invNo: string | null;
  orderNo: string | null;
  payer: string | null;
  isDeposit: boolean;
}

// 付款明细AI识别结果
export interface DetailOcrResult {
  date: string | null;
  items: {
    mark: string | null;
    orderNo: string | null;
    amount: number;
  }[];
}

// SWIFT AI识别结果
export interface SwiftOcrResult {
  amount: number | null;
  date: string | null;
  senderName: string | null;
  senderAddress: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
}

// 收据确认输入
export interface ConfirmReceiptInput {
  receiptNo: string | null;
  date: string | null;
  tel: string | null;
  usd: number;
  invNo: string | null;
  orderNo: string | null;
  payer: string | null;
  isDeposit: boolean;
}

// 付款明细确认输入
export interface ConfirmDetailInput {
  date: string | null;
  items: {
    mark: string | null;
    orderNo: string | null;
    amount: number;
    receiptId?: string | null;
  }[];
}

// SWIFT确认输入
export interface ConfirmSwiftInput {
  detailId: string;
  amount: number;
  date: string | null;
  senderName: string | null;
  senderAddress: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
}

// 余额转移输入
export interface BalanceTransferInput {
  fromOrderId: string;
  toOrderId: string;
  amount: number;
  note?: string;
}

// 删除申请输入
export interface DeletionRequestInput {
  targetType: 'RECEIPT' | 'DETAIL' | 'SWIFT';
  targetId: string;
  reason?: string;
}
