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
  orderNames: string[];
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string;
  credit: string;
  companyAddress: string;
  ownerId: string;
};

export type CustomerCompanyFileSummary = {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type CustomerCompanyFileOverwriteField = {
  key: 'companyName' | 'companyAddress' | 'city';
  label: string;
  currentValue: string;
  nextValue: string;
  selected: boolean;
};

export type CustomerCompanyFileOverwriteProposal = {
  fields: CustomerCompanyFileOverwriteField[];
};
