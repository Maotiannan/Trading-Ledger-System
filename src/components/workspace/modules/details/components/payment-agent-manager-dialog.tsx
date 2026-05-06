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
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    if (!open) return;
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) {
      setDraft(toDraft(agents.find((agent) => agent.id === selectedAgentId) || null));
      return;
    }
    const first = agents[0] || null;
    setSelectedAgentId(first?.id ?? null);
    setDraft(toDraft(first));
    setError(null);
  }, [agents, open, selectedAgentId]);

  const isCreating = !selectedAgent;

  const handleNew = () => {
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
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{tx('付款代理管理', 'Payment Agent Management')}</DialogTitle>
            <DialogDescription>{tx('维护付款代理基础信息和附件', 'Maintain payment agent master data and attachments.')}</DialogDescription>
          </DialogHeader>
          <div className="grid flex-1 min-h-0 grid-cols-1 gap-0 md:grid-cols-[260px_1fr]">
            <div className="border-b md:border-b-0 md:border-r">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="text-sm font-medium">{tx('代理列表', 'Agents')}</div>
                <Button size="sm" variant="outline" onClick={handleNew}>{tx('新增', 'New')}</Button>
              </div>
              <ScrollArea className="h-[240px] md:h-full">
                <div className="space-y-1 px-2 pb-4">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`w-full rounded-md px-3 py-2 text-left text-sm ${selectedAgentId === agent.id ? 'bg-muted font-medium' : 'hover:bg-muted/60'}`}
                      onClick={() => {
                        setSelectedAgentId(agent.id);
                        setDraft(toDraft(agent));
                        setError(null);
                      }}
                    >
                      <div>{agent.companyName}</div>
                      <div className="text-xs text-muted-foreground">{agent.contactName || tx('未填写联系人', 'No contact name')}</div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="flex-1 overflow-y-auto px-6 py-4">
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
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">{tx('公司文件', 'Company Files')}</div>
                        <Input className="max-w-xs" type="file" onChange={handleFileUpload} disabled={uploading} />
                      </div>
                      <div className="space-y-2">
                        {selectedAgent?.files.length ? selectedAgent.files.map((file) => (
                          <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                            <a
                              className="truncate text-primary underline-offset-2 hover:underline"
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
              <DialogFooter className="border-t px-6 py-4">
                {selectedAgent && (
                  <Button variant="destructive" onClick={() => void handleDelete()} disabled={saving || uploading}>
                    {tx('删除代理', 'Delete Agent')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || uploading}>
                  {tx('关闭', 'Close')}
                </Button>
                <Button onClick={() => void handleSave()} disabled={saving || uploading || !draft.companyName.trim()}>
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
