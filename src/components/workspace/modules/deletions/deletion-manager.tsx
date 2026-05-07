'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiCall, useUiText } from '@/components/workspace/shared';
import type { ReceiptEditRequestRow } from '@/lib/receipt-edit-types';
import type { DetailEditRequestRow } from '@/lib/detail-edit-types';
import type { SwiftEditRequestRow } from '@/lib/swift-edit-types';
import { Check, Loader2, X } from 'lucide-react';

const APPROVAL_PAGE_SIZE = 20;
type ApprovalSectionKey = 'deletions' | 'receiptEdits' | 'detailEdits' | 'swiftEdits';

export function DeletionManager() {
  const tx = useUiText();
  const { deletionRequests, setDeletionRequests, user } = useStore();
  const canApprove = user?.role === 'ADMIN';
  const [loading, setLoading] = useState(false);
  const [receiptEditRequests, setReceiptEditRequests] = useState<ReceiptEditRequestRow[]>([]);
  const [detailEditRequests, setDetailEditRequests] = useState<DetailEditRequestRow[]>([]);
  const [swiftEditRequests, setSwiftEditRequests] = useState<SwiftEditRequestRow[]>([]);
  const [approvalPages, setApprovalPages] = useState<Record<ApprovalSectionKey, number>>({
    deletions: 1,
    receiptEdits: 1,
    detailEdits: 1,
    swiftEdits: 1,
  });

  const loadApprovalData = useCallback(async () => {
    setLoading(true);
    const [deletionResult, receiptResult, detailResult, swiftResult] = await Promise.all([
      apiCall('deletion'),
      apiCall('receipt', { method: 'POST', body: JSON.stringify({ action: 'list-edit-requests' }) }),
      apiCall('detail', { method: 'POST', body: JSON.stringify({ action: 'list-edit-requests' }) }),
      apiCall('swift', { method: 'POST', body: JSON.stringify({ action: 'list-edit-requests' }) }),
    ]);

    if (deletionResult.success && Array.isArray(deletionResult.data)) {
      setDeletionRequests(deletionResult.data);
    } else {
      setDeletionRequests([]);
    }

    setReceiptEditRequests(receiptResult.success && Array.isArray(receiptResult.data) ? receiptResult.data as ReceiptEditRequestRow[] : []);
    setDetailEditRequests(detailResult.success && Array.isArray(detailResult.data) ? detailResult.data as DetailEditRequestRow[] : []);
    setSwiftEditRequests(swiftResult.success && Array.isArray(swiftResult.data) ? swiftResult.data as SwiftEditRequestRow[] : []);
    setLoading(false);
  }, [setDeletionRequests]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadApprovalData();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadApprovalData]);

  const handleDeletionDecision = useCallback(async (requestId: string, decision: 'approve' | 'reject') => {
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ action: decision, requestId }),
    });
    if (result.success) {
      await loadApprovalData();
    }
  }, [loadApprovalData]);

  const handleReceiptDecision = useCallback(async (requestId: string, decision: 'approve' | 'reject') => {
    const result = await apiCall('receipt', {
      method: 'POST',
      body: JSON.stringify({ action: 'review-edit', requestId, decision }),
    });
    if (result.success) await loadApprovalData();
  }, [loadApprovalData]);

  const handleDetailDecision = useCallback(async (requestId: string, decision: 'approve' | 'reject') => {
    const result = await apiCall('detail', {
      method: 'POST',
      body: JSON.stringify({ action: 'review-edit', requestId, decision }),
    });
    if (result.success) await loadApprovalData();
  }, [loadApprovalData]);

  const handleSwiftDecision = useCallback(async (requestId: string, decision: 'approve' | 'reject') => {
    const result = await apiCall('swift', {
      method: 'POST',
      body: JSON.stringify({ action: 'review-edit', requestId, decision }),
    });
    if (result.success) await loadApprovalData();
  }, [loadApprovalData]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      PENDING: 'outline',
      APPROVED: 'default',
      REJECTED: 'destructive',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  const getApprovalPageInfo = (section: ApprovalSectionKey, total: number) => {
    const totalPages = Math.max(1, Math.ceil(total / APPROVAL_PAGE_SIZE));
    const currentPage = Math.min(Math.max(approvalPages[section], 1), totalPages);
    return { currentPage, totalPages };
  };

  const paginateRows = <T,>(rows: T[], section: ApprovalSectionKey) => {
    const { currentPage } = getApprovalPageInfo(section, rows.length);
    return rows.slice((currentPage - 1) * APPROVAL_PAGE_SIZE, currentPage * APPROVAL_PAGE_SIZE);
  };

  const renderSectionPagination = (section: ApprovalSectionKey, total: number, label: string) => {
    const { currentPage, totalPages } = getApprovalPageInfo(section, total);
    if (total <= APPROVAL_PAGE_SIZE) return null;

    const setPage = (nextPage: number) => {
      setApprovalPages((prev) => ({
        ...prev,
        [section]: Math.min(totalPages, Math.max(1, nextPage)),
      }));
    };

    return (
      <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row">
        <span>{tx(`第 ${currentPage} / ${totalPages} 页（共 ${total} 条）`, `Page ${currentPage} / ${totalPages} (${total} total)`)}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={`${tx('上一页', 'Previous page')} ${label}`}
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            {tx('上一页', 'Previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`${tx('下一页', 'Next page')} ${label}`}
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            {tx('下一页', 'Next')}
          </Button>
        </div>
      </div>
    );
  };

  const paginatedDeletionRequests = paginateRows(deletionRequests, 'deletions');
  const paginatedReceiptEditRequests = paginateRows(receiptEditRequests, 'receiptEdits');
  const paginatedDetailEditRequests = paginateRows(detailEditRequests, 'detailEdits');
  const paginatedSwiftEditRequests = paginateRows(swiftEditRequests, 'swiftEdits');

  const renderPendingActions = (requestId: string, onDecision: (requestId: string, decision: 'approve' | 'reject') => Promise<void>) => {
    if (!canApprove) {
      return <span className="text-xs text-muted-foreground">{tx('等待审批', 'Pending review')}</span>;
    }
    return (
      <div className="flex gap-2">
        <Button size="sm" variant="default" onClick={() => void onDecision(requestId, 'approve')} disabled={loading}>
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="destructive" onClick={() => void onDecision(requestId, 'reject')} disabled={loading}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">{tx('审批', 'Approval')}</h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-6 py-4">
            <h3 className="text-lg font-semibold">{tx('删除申请', 'Deletion Requests')}</h3>
          </div>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx('类型', 'Type')}</TableHead>
                <TableHead>{tx('申请人', 'Requester')}</TableHead>
                <TableHead>{tx('原因', 'Reason')}</TableHead>
                <TableHead>{tx('状态', 'Status')}</TableHead>
                <TableHead>{tx('创建时间', 'Created At')}</TableHead>
                <TableHead>{tx('操作', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedDeletionRequests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{request.targetType}</TableCell>
                  <TableCell>{request.requester?.name || request.requester?.email}</TableCell>
                  <TableCell>{request.reason || '-'}</TableCell>
                  <TableCell>{getStatusBadge(request.status)}</TableCell>
                  <TableCell>{new Date(request.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {request.status === 'PENDING'
                      ? renderPendingActions(request.id, handleDeletionDecision)
                      : <span className="text-xs text-muted-foreground">{request.approver?.name || request.approver?.email || '-'}</span>}
                  </TableCell>
                </TableRow>
              ))}
              {deletionRequests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">{tx('暂无删除申请', 'No deletion requests')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
          {renderSectionPagination('deletions', deletionRequests.length, tx('删除申请', 'Deletion Requests'))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-6 py-4">
            <h3 className="text-lg font-semibold">{tx('收据修改申请', 'Receipt Edit Requests')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-3">{tx('收据号', 'Receipt No.')}</th>
                  <th className="px-4 py-3">{tx('申请人', 'Requester')}</th>
                  <th className="px-4 py-3">{tx('修改后', 'Requested Values')}</th>
                  <th className="px-4 py-3">{tx('状态', 'Status')}</th>
                  <th className="px-4 py-3">{tx('申请时间', 'Requested At')}</th>
                  <th className="px-4 py-3">{tx('操作', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedReceiptEditRequests.map((request) => (
                  <tr key={request.id} className="border-b align-top">
                    <td className="px-4 py-3">{request.afterSnapshot.receiptNo || request.beforeSnapshot.receiptNo || '-'}</td>
                    <td className="px-4 py-3">{request.requestedByName || '-'}</td>
                    <td className="px-4 py-3 text-xs leading-5 text-muted-foreground">
                      <div>{`Receipt No: ${request.afterSnapshot.receiptNo ?? '-'}`}</div>
                      <div>{`Payment Date: ${request.afterSnapshot.date ?? '-'}`}</div>
                      <div>{`INV No: ${request.afterSnapshot.invNo ?? '-'}`}</div>
                      <div>{`MARK: ${request.afterSnapshot.customerMark ?? '-'}`}</div>
                      <div>{`Payer: ${request.afterSnapshot.payer ?? '-'}`}</div>
                      <div>{`Phone: ${request.afterSnapshot.tel ?? '-'}`}</div>
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(request.status)}</td>
                    <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {request.status === 'PENDING'
                        ? renderPendingActions(request.id, handleReceiptDecision)
                        : <span className="text-xs text-muted-foreground">{request.approvedByName || '-'}</span>}
                    </td>
                  </tr>
                ))}
                {receiptEditRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{tx('暂无收据修改申请', 'No receipt edit requests')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderSectionPagination('receiptEdits', receiptEditRequests.length, tx('收据修改申请', 'Receipt Edit Requests'))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-6 py-4">
            <h3 className="text-lg font-semibold">{tx('付款明细修改申请', 'Payment Detail Edit Requests')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-3">{tx('付款明细', 'Payment Detail')}</th>
                  <th className="px-4 py-3">{tx('申请人', 'Requester')}</th>
                  <th className="px-4 py-3">{tx('修改后', 'Requested Values')}</th>
                  <th className="px-4 py-3">{tx('状态', 'Status')}</th>
                  <th className="px-4 py-3">{tx('申请时间', 'Requested At')}</th>
                  <th className="px-4 py-3">{tx('操作', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDetailEditRequests.map((request) => (
                  <tr key={request.id} className="border-b align-top">
                    <td className="px-4 py-3">{request.afterSnapshot.date || request.beforeSnapshot.date || '-'}</td>
                    <td className="px-4 py-3">{request.requestedByName || '-'}</td>
                    <td className="px-4 py-3 text-xs leading-5 text-muted-foreground">
                      <div>{`Date: ${request.afterSnapshot.date ?? '-'}`}</div>
                      {request.afterSnapshot.items.map((item, index) => (
                        <div key={`${request.id}-${index}`}>{`${index + 1}. ${item.mark ?? '-'} | ${item.orderNo ?? '-'} | $${item.amount.toFixed(2)} | ${item.receiptId ?? '-'}`}</div>
                      ))}
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(request.status)}</td>
                    <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {request.status === 'PENDING'
                        ? renderPendingActions(request.id, handleDetailDecision)
                        : <span className="text-xs text-muted-foreground">{request.approvedByName || '-'}</span>}
                    </td>
                  </tr>
                ))}
                {detailEditRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{tx('暂无付款明细修改申请', 'No payment detail edit requests')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderSectionPagination('detailEdits', detailEditRequests.length, tx('付款明细修改申请', 'Payment Detail Edit Requests'))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b px-6 py-4">
            <h3 className="text-lg font-semibold">{tx('SWIFT修改申请', 'SWIFT Edit Requests')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-3">{tx('SWIFT', 'SWIFT')}</th>
                  <th className="px-4 py-3">{tx('申请人', 'Requester')}</th>
                  <th className="px-4 py-3">{tx('修改后', 'Requested Values')}</th>
                  <th className="px-4 py-3">{tx('状态', 'Status')}</th>
                  <th className="px-4 py-3">{tx('申请时间', 'Requested At')}</th>
                  <th className="px-4 py-3">{tx('操作', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSwiftEditRequests.map((request) => (
                  <tr key={request.id} className="border-b align-top">
                    <td className="px-4 py-3">{request.afterSnapshot.date || request.beforeSnapshot.date || '-'}</td>
                    <td className="px-4 py-3">{request.requestedByName || '-'}</td>
                    <td className="px-4 py-3 text-xs leading-5 text-muted-foreground">
                      <div>{`Date: ${request.afterSnapshot.date ?? '-'}`}</div>
                      <div>{`Amount: $${request.afterSnapshot.amount.toFixed(2)}`}</div>
                      <div>{`Sender: ${request.afterSnapshot.senderName ?? '-'}`}</div>
                      <div>{`Sender Address: ${request.afterSnapshot.senderAddress ?? '-'}`}</div>
                      <div>{`Receiver: ${request.afterSnapshot.receiverName ?? '-'}`}</div>
                      <div>{`Receiver Account: ${request.afterSnapshot.receiverAccount ?? '-'}`}</div>
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(request.status)}</td>
                    <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {request.status === 'PENDING'
                        ? renderPendingActions(request.id, handleSwiftDecision)
                        : <span className="text-xs text-muted-foreground">{request.approvedByName || '-'}</span>}
                    </td>
                  </tr>
                ))}
                {swiftEditRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{tx('暂无SWIFT修改申请', 'No SWIFT edit requests')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderSectionPagination('swiftEdits', swiftEditRequests.length, tx('SWIFT修改申请', 'SWIFT Edit Requests'))}
        </CardContent>
      </Card>
    </div>
  );
}
