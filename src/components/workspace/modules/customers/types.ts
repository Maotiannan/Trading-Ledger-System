export type CustomerOwnerOption = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  level: number;
};

export type CustomerFormState = {
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string;
  credit: string;
  companyAddress: string;
  ownerId: string;
};
