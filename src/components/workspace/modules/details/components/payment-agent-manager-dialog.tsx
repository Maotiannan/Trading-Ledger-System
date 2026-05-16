'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiCall, apiUploadCall, getApiErrorMessage } from '@/components/workspace/shared';
import type { PaymentAgentSummary } from '../types';

type PaymentAgentManagerDialogProps = {
  open: boolean;
  agents: PaymentAgentSummary[];
  loading: boolean;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onAgentsReload: () => Promise<void>;
};

type AgentDraft = {
  companyName: string;
  companyAddress: string;
  contactName: string;
  contactPhone: string;
};

const EMPTY_DRAFT: AgentDraft = {
  companyName: '',
  companyAddress: '',
  contactName: '',
  contactPhone: '',
};

function toDraft(agent: PaymentAgentSummary | null): AgentDraft {
  if (!agent) return { ...EMPTY_DRAFT };
  return {
    companyName: agent.companyName,
    companyAddress: agent.companyAddress || '',
    contactName: agent.contactName || '',
    contactPhone: agent.contactPhone || '',
  };
}

export function PaymentAgentManagerDialog({
  open,
  agents,
  loading,
  tx,
  onOpenChange,
  onAgentsReload,
}: PaymentAgentManagerDialogProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => (isCreatingDraft ? null : agents.find((agent) => agent.id === selectedAgentId) || null),
    [agents, isCreatingDraft, selectedAgentId]
  );

  useEffect(() => {
    if (!open) return;
    if (isCreatingDraft) return;
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) {
      setDraft(toDraft(agents.find((agent) => agent.id === selectedAgentId) || null));
      return;
    }
    const first = agents[0] || null;
    setSelectedAgentId(first?.id ?? null);
    setDraft(toDraft(first));
    setError(null);
  }, [agents, isCreatingDraft, open, selectedAgentId]);

  useEffect(() => {
    if (open) return;
    setIsCreatingDraft(false);
    setSelectedAgentId(null);
    setDraft({ ...EMPTY_DRAFT });
    setError(null);
  }, [open]);

  const isCreating = isCreatingDraft || !selectedAgent;

  const handleNew = () => {
    setIsCreatingDraft(true);
    setSelectedAgentId(null);
    setDraft({ ...EMPTY_DRAFT });
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall('agent', {
        method: 'POST',
        body: JSON.stringify({
          action: selectedAgent ? 'update' : 'create',
          agentId: selectedAgent?.id || '',
          companyName: draft.companyName,
          companyAddress: draft.companyAddress,
          contactName: draft.contactName,
          contactPhone: draft.contactPhone,
        }),
      });
      if (!result.success) {
        setError(getApiErrorMessage(result, tx('保存付款代理失败', 'Failed to save payment agent.')));
        return;
      }
      await onAgentsReload();
      const nextId = result.data?.id || selectedAgent?.id || null;
      setIsCreatingDraft(false);
      setSelectedAgentId(nextId);
    } catch (agentError) {
      setError(getApiErrorMessage(agentError, tx('保存付款代理失败', 'Failed to save payment agent.')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedAgent) return;
    if (!confirm(tx('确定要删除该付款代理吗？', 'Delete this payment agent?'))) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall('agent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete',
          agentId: selectedAgent.id,
        }),
      });
      if (!result.success) {
        setError(getApiErrorMessage(result, tx('删除付款代理失败', 'Failed to delete payment agent.')));
        return;
      }
      await onAgentsReload();
      setIsCreatingDraft(false);
      setSelectedAgentId(null);
      setDraft({ ...EMPTY_DRAFT });
    } catch (agentError) {
      setError(getApiErrorMessage(agentError, tx('删除付款代理失败', 'Failed to delete payment agent.')));
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedAgent) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('action', 'upload');
      formData.append('category', 'agent-file');
      formData.append('file', file);
      const uploaded = await apiUploadCall('upload-image', formData);
      if (!uploaded.success || !uploaded.data) {
        throw uploaded;
      }
      const attachResult = await apiCall('agent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'attach-file',
          agentId: selectedAgent.id,
          path: uploaded.data.path,
          name: uploaded.data.name,
          mimeType: uploaded.data.mimeType,
          size: uploaded.data.sizeBytes,
        }),
      });
      if (!attachResult.success) {
        throw attachResult;
      }
      await onAgentsReload();
    } catch (uploadError) {
      setError(getApiErrorMessage(uploadError, tx('上传付款代理文件失败', 'Failed to upload payment agent file.')));
    } finally {
      event.target.value = '';
      setUploading(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    setUploading(true);
    setError(null);
    try {
      const result = await apiCall('agent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete-file',
          fileId,
        }),
      });
      if (!result.success) {
        throw result;
      }
      await onAgentsReload();
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, tx('删除付款代理文件失败', 'Failed to delete payment agent file.')));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="payment-agent-dialog-content"
        className="h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none overflow-hidden p-0 sm:h-[min(760px,calc(100vh-2rem))] sm:max-h-[90vh] sm:w-[calc(100vw-2rem)] lg:max-w-[1180px] xl:max-w-[1280px]"
      >
        <div className="flex h-full max-h-[calc(100dvh-1rem)] min-w-0 flex-col sm:max-h-[90vh]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 sm:px-6">
            <DialogTitle>{tx('付款代理管理', 'Payment Agent Management')}</DialogTitle>
            <DialogDescription>{tx('维护付款代理基础信息和附件', 'Maintain payment agent master data and attachments.')}</DialogDescription>
          </DialogHeader>
          <div
            data-testid="payment-agent-dialog-body"
            className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]"
          >
            <div className="flex min-h-0 min-w-0 flex-col border-b md:border-b-0 md:border-r">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="text-sm font-medium">{tx('代理列表', 'Agents')}</div>
                <Button size="sm" variant="outline" onClick={handleNew}>{tx('新增', 'New')}</Button>
              </div>
              <ScrollArea className="h-40 min-h-0 md:h-auto md:flex-1">
                <div className="space-y-1 px-2 pb-4">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`w-full rounded-md px-3 py-2 text-left text-sm ${selectedAgentId === agent.id ? 'bg-muted font-medium' : 'hover:bg-muted/60'}`}
                      onClick={() => {
                        setIsCreatingDraft(false);
                        setSelectedAgentId(agent.id);
                        setDraft(toDraft(agent));
                        setError(null);
                      }}
                    >
                      <div className="truncate" title={agent.companyName}>{agent.companyName}</div>
                      <div className="text-xs text-muted-foreground">{agent.contactName || tx('未填写联系人', 'No contact name')}</div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="flex min-h-0 min-w-0 flex-col">
              <div
                data-testid="payment-agent-detail-panel"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
              >
                <div className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>{tx('公司名称', 'Company Name')}</Label>
                      <Input value={draft.companyName} onChange={(event) => setDraft((prev) => ({ ...prev, companyName: event.target.value }))} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>{tx('公司地址', 'Company Address')}</Label>
                      <Input value={draft.companyAddress} onChange={(event) => setDraft((prev) => ({ ...prev, companyAddress: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>{tx('负责人姓名', 'Contact Name')}</Label>
                      <Input value={draft.contactName} onChange={(event) => setDraft((prev) => ({ ...prev, contactName: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>{tx('负责人电话', 'Contact Phone')}</Label>
                      <Input value={draft.contactPhone} onChange={(event) => setDraft((prev) => ({ ...prev, contactPhone: event.target.value }))} />
                    </div>
                  </div>

                  {!isCreating && (
                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm font-medium">{tx('公司文件', 'Company Files')}</div>
                        <Input className="w-full sm:max-w-xs" type="file" onChange={handleFileUpload} disabled={uploading} />
                      </div>
                      <div className="space-y-2">
                        {selectedAgent?.files.length ? selectedAgent.files.map((file) => (
                          <div key={file.id} className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                            <a
                              className="min-w-0 truncate text-primary underline-offset-2 hover:underline"
                              href={`/api/upload-image?path=${encodeURIComponent(file.path)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {file.name}
                            </a>
                            <Button size="sm" variant="ghost" onClick={() => void handleDeleteFile(file.id)} disabled={uploading}>
                              {tx('删除', 'Delete')}
                            </Button>
                          </div>
                        )) : (
                          <div className="text-sm text-muted-foreground">{tx('暂无附件', 'No files')}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
                {selectedAgent && (
                  <Button className="w-full sm:w-auto" variant="destructive" onClick={() => void handleDelete()} disabled={saving || uploading}>
                    {tx('删除代理', 'Delete Agent')}
                  </Button>
                )}
                <Button className="w-full sm:w-auto" variant="outline" onClick={() => onOpenChange(false)} disabled={saving || uploading}>
                  {tx('关闭', 'Close')}
                </Button>
                <Button className="w-full sm:w-auto" onClick={() => void handleSave()} disabled={saving || uploading || !draft.companyName.trim()}>
                  {saving ? tx('保存中...', 'Saving...') : tx('保存', 'Save')}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
