'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import type { ReceiptEditRequestRow } from '@/lib/receipt-edit-types';
import type { DetailEditRequestRow } from '@/lib/detail-edit-types';
import type { SwiftEditRequestRow } from '@/lib/swift-edit-types';
import { Check, Loader2, X } from 'lucide-react';

const APPROVAL_PAGE_SIZE = 5;
type ApprovalSectionKey = 'deletions' | 'receiptEdits' | 'detailEdits' | 'swiftEdits';

type ApprovalSectionFilter = {
  draftSearch: string;
  search: string;
  draftShowAll: boolean;
  showAll: boolean;
};

const initialApprovalFilters: Record<ApprovalSectionKey, ApprovalSectionFilter> = {
  deletions: { draftSearch: '', search: '', draftShowAll: false, showAll: false },
  receiptEdits: { draftSearch: '', search: '', draftShowAll: false, showAll: false },
  detailEdits: { draftSearch: '', search: '', draftShowAll: false, showAll: false },
  swiftEdits: { draftSearch: '', search: '', draftShowAll: false, showAll: false },
};

function normalizeDiffValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function isChanged(before: unknown, after: unknown): boolean {
  return normalizeDiffValue(before) !== normalizeDiffValue(after);
}

function textValue(value: unknown, formatter?: (value: unknown) => string): string {
  if (formatter) return formatter(value);
  const normalized = normalizeDiffValue(value);
  return normalized || '-';
}

export function DeletionManager() {
  const tx = useUiText();
  const { deletionRequests, setDeletionRequests, user } = useStore();
  const canApprove = user?.role === 'ADMIN';
  const [loading, setLoading] = useState(false);
  const [receiptEditRequests, setReceiptEditRequests] = useState<ReceiptEditRequestRow[]>([]);
  const [detailEditRequests, setDetailEditRequests] = useState<DetailEditRequestRow[]>([]);
  const [swiftEditRequests, setSwiftEditRequests] = useState<SwiftEditRequestRow[]>([]);
  const [approvalFilters, setApprovalFilters] = useState<Record<ApprovalSectionKey, ApprovalSectionFilter>>(initialApprovalFilters);
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

  const updateApprovalFilter = (section: ApprovalSectionKey, patch: Partial<ApprovalSectionFilter>) => {
    setApprovalFilters((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        ...patch,
      },
    }));
  };

  const applyApprovalFilter = (section: ApprovalSectionKey) => {
    setApprovalFilters((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        search: prev[section].draftSearch.trim(),
        showAll: prev[section].draftShowAll,
      },
    }));
    setApprovalPages((prev) => ({ ...prev, [section]: 1 }));
  };

  const filterApprovalRows = <T extends { status: string }>(rows: T[], section: ApprovalSectionKey): T[] => {
    const filter = approvalFilters[section];
    const search = filter.search.toLowerCase();
    return rows.filter((row) => {
      if (!filter.showAll && row.status !== 'PENDING') return false;
      if (!search) return true;
      return JSON.stringify(row).toLowerCase().includes(search);
    });
  };

  const renderSectionHeader = (section: ApprovalSectionKey, label: string) => {
    const filter = approvalFilters[section];
    return (
      <div className="flex flex-col gap-3 border-b px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="text-lg font-semibold">{label}</h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              aria-label={`ALL ${label}`}
              checked={filter.draftShowAll}
              onChange={(event) => updateApprovalFilter(section, { draftShowAll: event.target.checked })}
            />
            <span>ALL</span>
          </label>
          <Input
            className="sm:w-56"
            aria-label={`${tx('搜索', 'Search')} ${label}`}
            placeholder={tx('搜索申请内容', 'Search requests')}
            value={filter.draftSearch}
            onChange={(event) => updateApprovalFilter(section, { draftSearch: event.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            aria-label={`${tx('查询', 'Search')} ${label}`}
            onClick={() => applyApprovalFilter(section)}
          >
            {tx('查询', 'Search')}
          </Button>
        </div>
      </div>
    );
  };

  const renderChangeLines = (changes: Array<{ label: string; before: string; after: string }>) => {
    if (changes.length === 0) {
      return <span className="text-xs text-muted-foreground">{tx('无字段变更', 'No field changes')}</span>;
    }
    return (
      <div className="space-y-1 text-xs leading-5 text-muted-foreground">
        {changes.map((change) => (
          <div key={change.label}>{`${change.label}: ${change.before} → ${change.after}`}</div>
        ))}
      </div>
    );
  };

  const renderReceiptChanges = (request: ReceiptEditRequestRow) => {
    const fields: Array<{ key: keyof ReceiptEditRequestRow['afterSnapshot']; label: string }> = [
      { key: 'receiptNo', label: 'Receipt No' },
      { key: 'date', label: 'Payment Date' },
      { key: 'orderNo', label: 'ORDER NO' },
      { key: 'invNo', label: 'INV NO' },
      { key: 'customerMark', label: 'MARK' },
      { key: 'payer', label: 'Payer' },
      { key: 'tel', label: 'Phone' },
    ];
    return renderChangeLines(fields
      .filter((field) => isChanged(request.beforeSnapshot[field.key], request.afterSnapshot[field.key]))
      .map((field) => ({
        label: field.label,
        before: textValue(request.beforeSnapshot[field.key], field.key === 'orderNo' ? (value) => formatOrderNameDisplay(String(value || '')) : undefined),
        after: textValue(request.afterSnapshot[field.key], field.key === 'orderNo' ? (value) => formatOrderNameDisplay(String(value || '')) : undefined),
      })));
  };

  const renderDetailChanges = (request: DetailEditRequestRow) => {
    const changes: Array<{ label: string; before: string; after: string }> = [];
    if (isChanged(request.beforeSnapshot.date, request.afterSnapshot.date)) {
      changes.push({
        label: 'Date',
        before: textValue(request.beforeSnapshot.date),
        after: textValue(request.afterSnapshot.date),
      });
    }
    if (isChanged(request.beforeSnapshot.agentId, request.afterSnapshot.agentId)) {
      changes.push({
        label: 'Agent',
        before: textValue(request.beforeSnapshot.agentId),
        after: textValue(request.afterSnapshot.agentId),
      });
    }

    const beforeItems = request.beforeSnapshot.items || [];
    const afterItems = request.afterSnapshot.items || [];
    const itemCount = Math.max(beforeItems.length, afterItems.length);
    for (let index = 0; index < itemCount; index += 1) {
      const beforeItem = beforeItems[index] || {};
      const afterItem = afterItems[index] || {};
      const fields: Array<{ key: 'mark' | 'orderNo' | 'amount' | 'receiptId'; label: string; format?: (value: unknown) => string }> = [
        { key: 'mark', label: 'MARK' },
        { key: 'orderNo', label: 'ORDER NO', format: (value) => formatOrderNameDisplay(String(value || '')) },
        { key: 'amount', label: 'Amount', format: (value) => formatUsdAmount(Number(value || 0)) },
        { key: 'receiptId', label: 'Linked Receipt' },
      ];
      for (const field of fields) {
        if (!isChanged(beforeItem[field.key], afterItem[field.key])) continue;
        changes.push({
          label: `${tx('明细', 'Item')} ${index + 1} ${field.label}`,
          before: textValue(beforeItem[field.key], field.format),
          after: textValue(afterItem[field.key], field.format),
        });
      }
    }
    return renderChangeLines(changes);
  };

  const renderSwiftChanges = (request: SwiftEditRequestRow) => {
    const fields: Array<{ key: keyof SwiftEditRequestRow['afterSnapshot']; label: string; format?: (value: unknown) => string }> = [
      { key: 'date', label: 'Date' },
      { key: 'amount', label: 'Amount', format: (value) => formatUsdAmount(Number(value || 0)) },
      { key: 'senderName', label: 'Sender' },
      { key: 'senderAddress', label: 'Sender Address' },
      { key: 'receiverName', label: 'Receiver' },
      { key: 'receiverAccount', label: 'Receiver Account' },
    ];
    return renderChangeLines(fields
      .filter((field) => isChanged(request.beforeSnapshot[field.key], request.afterSnapshot[field.key]))
      .map((field) => ({
        label: field.label,
        before: textValue(request.beforeSnapshot[field.key], field.format),
        after: textValue(request.afterSnapshot[field.key], field.format),
      })));
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

  const filteredDeletionRequests = filterApprovalRows(deletionRequests, 'deletions');
  const filteredReceiptEditRequests = filterApprovalRows(receiptEditRequests, 'receiptEdits');
  const filteredDetailEditRequests = filterApprovalRows(detailEditRequests, 'detailEdits');
  const filteredSwiftEditRequests = filterApprovalRows(swiftEditRequests, 'swiftEdits');
  const paginatedDeletionRequests = paginateRows(filteredDeletionRequests, 'deletions');
  const paginatedReceiptEditRequests = paginateRows(filteredReceiptEditRequests, 'receiptEdits');
  const paginatedDetailEditRequests = paginateRows(filteredDetailEditRequests, 'detailEdits');
  const paginatedSwiftEditRequests = paginateRows(filteredSwiftEditRequests, 'swiftEdits');

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
          {renderSectionHeader('deletions', tx('删除申请', 'Deletion Requests'))}
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
              {filteredDeletionRequests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">{tx('暂无删除申请', 'No deletion requests')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
          {renderSectionPagination('deletions', filteredDeletionRequests.length, tx('删除申请', 'Deletion Requests'))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {renderSectionHeader('receiptEdits', tx('收据修改申请', 'Receipt Edit Requests'))}
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
                    <td className="px-4 py-3">{renderReceiptChanges(request)}</td>
                    <td className="px-4 py-3">{getStatusBadge(request.status)}</td>
                    <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {request.status === 'PENDING'
                        ? renderPendingActions(request.id, handleReceiptDecision)
                        : <span className="text-xs text-muted-foreground">{request.approvedByName || '-'}</span>}
                    </td>
                  </tr>
                ))}
                {filteredReceiptEditRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{tx('暂无收据修改申请', 'No receipt edit requests')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderSectionPagination('receiptEdits', filteredReceiptEditRequests.length, tx('收据修改申请', 'Receipt Edit Requests'))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {renderSectionHeader('detailEdits', tx('付款明细修改申请', 'Payment Detail Edit Requests'))}
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
                    <td className="px-4 py-3">{renderDetailChanges(request)}</td>
                    <td className="px-4 py-3">{getStatusBadge(request.status)}</td>
                    <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {request.status === 'PENDING'
                        ? renderPendingActions(request.id, handleDetailDecision)
                        : <span className="text-xs text-muted-foreground">{request.approvedByName || '-'}</span>}
                    </td>
                  </tr>
                ))}
                {filteredDetailEditRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{tx('暂无付款明细修改申请', 'No payment detail edit requests')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderSectionPagination('detailEdits', filteredDetailEditRequests.length, tx('付款明细修改申请', 'Payment Detail Edit Requests'))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {renderSectionHeader('swiftEdits', tx('SWIFT修改申请', 'SWIFT Edit Requests'))}
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
                    <td className="px-4 py-3">{renderSwiftChanges(request)}</td>
                    <td className="px-4 py-3">{getStatusBadge(request.status)}</td>
                    <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {request.status === 'PENDING'
                        ? renderPendingActions(request.id, handleSwiftDecision)
                        : <span className="text-xs text-muted-foreground">{request.approvedByName || '-'}</span>}
                    </td>
                  </tr>
                ))}
                {filteredSwiftEditRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{tx('暂无SWIFT修改申请', 'No SWIFT edit requests')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderSectionPagination('swiftEdits', filteredSwiftEditRequests.length, tx('SWIFT修改申请', 'SWIFT Edit Requests'))}
        </CardContent>
      </Card>
    </div>
  );
}
