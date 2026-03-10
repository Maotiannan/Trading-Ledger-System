export type DetailDirectItemForm = {
  mark: string;
  orderNo: string;
  amount: string;
};

export type DetailOcrResult = {
  date: string | null;
  items: Array<{
    mark: string | null;
    orderNo: string | null;
    amount: number;
    matchedReceiptId?: string | null;
  }>;
};

export const EMPTY_DETAIL_DIRECT_ITEM: DetailDirectItemForm = {
  mark: '',
  orderNo: '',
  amount: '',
};
