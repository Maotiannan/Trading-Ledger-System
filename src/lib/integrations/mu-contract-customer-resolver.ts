import { db } from '@/lib/db';
import { apiErrorCodes, isApiError } from '@/lib/api-error';
import {
  resolveOrderCustomerForOwnerIds,
  type OrderCustomerLookupExecutor,
  type OrderCustomerLookupSuccess,
} from '@/lib/order-customer-lookup-service';

export type MuContractOrderCustomerResolution =
  | ({ status: 'MATCHED' } & Omit<OrderCustomerLookupSuccess, 'success'>)
  | {
      status: 'UNMATCHED' | 'CONFLICT';
      orderNo: string;
      code: string;
      message: string;
      detail?: unknown;
    };

export type MuContractCustomerResolverExecutor = OrderCustomerLookupExecutor & {
  user: Pick<typeof db.user, 'findMany'>;
};

export async function resolveMuContractOrderCustomer(
  executor: MuContractCustomerResolverExecutor,
  orderNo: string,
): Promise<MuContractOrderCustomerResolution> {
  const users = await executor.user.findMany({ select: { id: true } });
  const ownerIds = users.map((user) => user.id);
  try {
    const result = await resolveOrderCustomerForOwnerIds(executor, ownerIds, orderNo);
    const { success: _success, ...match } = result;
    return { status: 'MATCHED', ...match };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return {
      status: error.code === apiErrorCodes.EXCEL_ORDER_CONFLICT ? 'CONFLICT' : 'UNMATCHED',
      orderNo: String(orderNo || '').trim(),
      code: error.code,
      message: error.message,
      detail: error.detail,
    };
  }
}
