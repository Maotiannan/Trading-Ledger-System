import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'ADMIN' | 'SALES' | 'USER';
export type WorkspaceView =
  | 'dashboard'
  | 'invoices'
  | 'receipts'
  | 'details'
  | 'swifts'
  | 'deletions'
  | 'users'
  | 'customers'
  | 'settings';
export type ReceiptStatus = 'SIGNING_PENDING' | 'SR_Received' | 'Waiting_SWIFT' | 'Bank_Transfer' | 'RECEIVED';
export type DetailStatus = 'Waiting_SWIFT' | 'Bank_Transfer' | 'RECEIVED' | 'ERROR';
export type SwiftStatus = 'Bank_Transfer' | 'RECEIVED' | 'ERROR';

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  level?: number;
  parentId?: string | null;
  createdAt?: string;
  createdById?: string | null;
}

export interface Order {
  id: string;
  orderNo: string;
  amount: number;
  orderBalance: number;
  customerMark?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerCity?: string | null;
  needsCustomerFix?: boolean;
}

export interface Invoice {
  id: string;
  invNo: string;
  invAmount: number;
  invBalance: number;
  shipDate?: string | null;
  releaseDate?: string | null;
  orders: Order[];
  createdAt: string;
}

export interface Receipt {
  id: string;
  receiptNo: string | null;
  date: string | null;
  tel: string | null;
  usd: number;
  invNo: string | null;
  orderNo: string | null;
  payer: string | null;
  customerMark?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerCity?: string | null;
  needsCustomerFix?: boolean;
  status: ReceiptStatus;
  imageUrl: string | null;
  imageName?: string | null;
  isDeposit: boolean;
  isMerged: boolean;
  note: string | null;
  createdAt: string;
  creator: { id: string; name: string | null; email: string };
  order?: Order | null;
}

export type ReceiptEditablePatch = {
  receiptNo: string | null;
  date: string | null;
  invNo: string | null;
  customerMark: string | null;
  payer: string | null;
  tel: string | null;
};

export type ReceiptEditRequestRow = {
  id: string;
  receiptId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  beforeSnapshot: ReceiptEditablePatch;
  afterSnapshot: ReceiptEditablePatch;
  reviewComment: string | null;
};

export interface DetailItem {
  id: string;
  mark: string | null;
  orderNo: string | null;
  amount: number;
  receiptId: string | null;
  receipt?: Receipt | null;
}

export interface Detail {
  id: string;
  date: string | null;
  status: DetailStatus;
  imageUrl: string | null;
  imageName?: string | null;
  totalAmount: number;
  createdAt: string;
  creator: { id: string; name: string | null; email: string };
  items: DetailItem[];
  swift?: Swift | null;
}

export interface Swift {
  id: string;
  detailId: string;
  amount: number;
  date: string | null;
  senderName: string | null;
  senderAddress: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
  imageUrl: string | null;
  imageName?: string | null;
  status?: SwiftStatus;
  hasError: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface DeletionRequest {
  id: string;
  targetType: 'RECEIPT' | 'DETAIL' | 'SWIFT';
  targetId: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  approvedBy: string | null;
  createdAt: string;
  requester: { id: string; name: string | null; email: string };
  approver?: { id: string; name: string | null; email: string } | null;
}

interface AppState {
  // 用户状态
  user: User | null;
  setUser: (user: User | null) => void;
  
  // 当前视图
  currentView: WorkspaceView;
  setCurrentView: (view: WorkspaceView) => void;
  navigationPendingView: WorkspaceView | null;
  setNavigationPendingView: (view: WorkspaceView | null) => void;
  
  // 数据
  invoices: Invoice[];
  setInvoices: (invoices: Invoice[]) => void;
  
  receipts: Receipt[];
  setReceipts: (receipts: Receipt[]) => void;
  
  details: Detail[];
  setDetails: (details: Detail[]) => void;
  
  swifts: Swift[];
  setSwifts: (swifts: Swift[]) => void;
  
  deletionRequests: DeletionRequest[];
  setDeletionRequests: (requests: DeletionRequest[]) => void;
  
  users: User[];
  setUsers: (users: User[]) => void;
  
  // 加载状态
  loading: boolean;
  setLoading: (loading: boolean) => void;
  
  // Toast消息
  toastMessage: { type: 'success' | 'error' | 'info'; message: string } | null;
  setToastMessage: (message: { type: 'success' | 'error' | 'info'; message: string } | null) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // 用户状态
      user: null,
      setUser: (user) => set({ user }),
      
      // 当前视图
      currentView: 'dashboard',
      setCurrentView: (currentView) => set({ currentView }),
      navigationPendingView: null,
      setNavigationPendingView: (navigationPendingView) => set({ navigationPendingView }),
      
      // 数据
      invoices: [],
      setInvoices: (invoices) => set({ invoices }),
      
      receipts: [],
      setReceipts: (receipts) => set({ receipts }),
      
      details: [],
      setDetails: (details) => set({ details }),
      
      swifts: [],
      setSwifts: (swifts) => set({ swifts }),
      
      deletionRequests: [],
      setDeletionRequests: (deletionRequests) => set({ deletionRequests }),
      
      users: [],
      setUsers: (users) => set({ users }),
      
      // 加载状态
      loading: false,
      setLoading: (loading) => set({ loading }),
      
      // Toast消息
      toastMessage: null,
      setToastMessage: (toastMessage) => set({ toastMessage }),
    }),
    {
      name: 'receipt-system-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
