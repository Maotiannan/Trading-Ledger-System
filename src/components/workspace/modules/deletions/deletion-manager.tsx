'use client';

import React, { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUiText } from '@/components/workspace/shared';
import { Check, X } from 'lucide-react';
import { useDeletionActions } from '@/components/workspace/modules/deletions/hooks';

export function DeletionManager() {
  const tx = useUiText();
  const { deletionRequests, setDeletionRequests, user } = useStore();
  const canApprove = user?.role === 'ADMIN';
  const { loadRequests, handleApprove, handleReject } = useDeletionActions({ setDeletionRequests });

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      'PENDING': 'outline',
      'APPROVED': 'default',
      'REJECTED': 'destructive'
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{tx('删除审批', 'Deletion Approval')}</h2>

      <Card>
        <CardContent className="p-0">
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
              {deletionRequests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{request.targetType}</TableCell>
                  <TableCell>{request.requester?.name || request.requester?.email}</TableCell>
                  <TableCell>{request.reason || '-'}</TableCell>
                  <TableCell>{getStatusBadge(request.status)}</TableCell>
                  <TableCell>{new Date(request.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {request.status === 'PENDING' && canApprove && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="default" onClick={() => handleApprove(request.id)}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleReject(request.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {deletionRequests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                    {tx('暂无删除申请', 'No deletion requests')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
