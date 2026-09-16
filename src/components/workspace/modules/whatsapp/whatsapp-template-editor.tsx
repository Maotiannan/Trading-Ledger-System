'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { defaultTemplateVersions, draftSchema, templateExampleValues, templateVariables, type TemplateDraft, type TemplateVersion } from '@/lib/whatsapp/whatsapp-template-definition';
const initial = defaultTemplateVersions()[0];
export function WhatsAppTemplateEditor() {
  const tx = useUiText();
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const result = await apiCall('whatsapp-templates');
    setVersions(result.data.templates);
  }, []);
  useEffect(() => { void load().catch(() => setMessage(tx('模板加载失败', 'Unable to load templates.'))); }, [load, tx]);
  const run = async (body: unknown) => {
    setBusy(true); setMessage('');
    try {
      const result = await apiCall('whatsapp-templates', { method: 'POST', body: JSON.stringify(body) });
      await load();
      setMessage(result.data?.status === 'SUBMISSION_UNCERTAIN'
        ? tx('提交结果未确认，请刷新审核状态，不要重复提交。', 'Submission was not confirmed. Refresh status; do not resubmit.')
        : tx('操作已完成', 'Action completed.'));
    } catch { setMessage(tx('操作未完成。请检查变量、平台配置或审核状态后重试。', 'Action could not be completed. Check variables, provider configuration and approval status.')); }
    finally { setBusy(false); }
  };
  const preview = draft.body.replace(/{{(\d+)}}/g, (_, n) => templateExampleValues(draft.kind)[Number(n) - 1] || '?');
  function selectSlot(kind: TemplateDraft['kind'], language: TemplateDraft['language']) {
    setDraft(versions.find(item => item.kind === kind && item.language === language && item.active)
      || defaultTemplateVersions().find(item => item.kind === kind && item.language === language)!);
  }
  return <Card><CardHeader><CardTitle>{tx('WhatsApp 模板自定义与审核', 'WhatsApp Template Editor & Review')}</CardTitle></CardHeader><CardContent className="space-y-4 min-w-0">
    <p className="text-sm text-muted-foreground">{tx('保存会创建独立草稿版本；提交审核不发送消息。平台批准后手动启用新版本，历史消息不变。', 'Save creates a separate draft version. Submission sends no messages. Activate after approval; historical messages remain unchanged.')}</p>
    {message && <p role="status" className="break-words">{message}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label>{tx('通知类型', 'Notification type')}<select className="block w-full border rounded-md p-2" value={draft.kind} onChange={event => selectSlot(event.target.value as TemplateDraft['kind'], draft.language)}>
        <option value="payment">{tx('收款', 'Payment received')}</option><option value="shipment">{tx('出运', 'Shipment')}</option><option value="release">{tx('放单', 'Release')}</option>
      </select></label>
      <label>{tx('语言', 'Language')}<select className="block w-full border rounded-md p-2" value={draft.language} onChange={event => selectSlot(draft.kind, event.target.value as TemplateDraft['language'])}><option value="en">English</option><option value="fr">Français</option></select></label>
    </div>
    <label className="block">{tx('标题', 'Title')}<Input maxLength={60} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label className="block">{tx('正文', 'Body')}<Textarea rows={10} maxLength={1024} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
    <div className="flex flex-wrap gap-2">{templateVariables[draft.kind].map((variable, index) => <Button type="button" variant="outline" size="sm" key={variable} onClick={() => setDraft({ ...draft, body: draft.body + ' {{' + (index + 1) + '}}' })}>{'{{' + (index + 1) + '}}'} {variable}</Button>)}</div>
    <p className="text-sm text-muted-foreground">{tx('可移动变量，但必须保留所有编号；编号含义固定，不能用客户真实数据替换。', 'Variables may move but all numbered variables must remain. Their meanings are fixed; do not insert real customer data into templates.')}</p>
    <label className="block">{tx('页脚', 'Footer')}<Input maxLength={60} value={draft.footer} onChange={event => setDraft({ ...draft, footer: event.target.value })} /></label>
    <p className="text-sm text-muted-foreground">{tx('以下为虚构数据样例，不会发送。', 'Preview uses fictional sample data. Nothing is sent.')}</p>
    <section className="rounded-md border p-3 break-words whitespace-pre-wrap"><strong>{draft.title}</strong><p>{preview}</p><p className="text-muted-foreground text-sm">{draft.footer}</p></section>
    <Button disabled={busy || !draftSchema.safeParse(draft).success} onClick={() => void run({ action: 'save', draft })}>{tx('保存为新草稿', 'Save as new draft')}</Button>
    <div className="space-y-3">{versions.map(version => <article className="border rounded-md p-3 min-w-0 space-y-2" key={version.name + version.language}>
      <p className="break-all font-medium">{version.name} · {version.language}</p>
      <p>{version.status} · {version.category}{version.active ? ' · ' + tx('当前使用', 'Active') : ''}</p>
      <details><summary className="cursor-pointer">{tx('查看内容', 'View content')}</summary><p className="whitespace-pre-wrap break-words">{version.body}</p></details>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => setDraft(version)}>{tx('复制编辑', 'Copy to editor')}</Button>
        {version.status === 'DRAFT' ? <Button disabled={busy} onClick={() => {
          if (window.confirm(tx('将此模板文本提交到 YCloud/Meta 审核？提交后不能修改此版本。', 'Submit this template text to YCloud/Meta for review? This version will be locked.'))) void run({ action: 'submit', name: version.name, language: version.language });
        }}>{tx('提交审核', 'Submit for review')}</Button>
          : <Button variant="outline" disabled={busy} onClick={() => void run({ action: 'refresh', name: version.name, language: version.language })}>{tx('刷新审核状态', 'Refresh review status')}</Button>}
        {version.status === 'APPROVED' && version.category === 'UTILITY' && !version.active && <Button disabled={busy} onClick={() => {
          if (window.confirm(tx('为后续新通知启用此版本？', 'Use this version for new notifications?'))) void run({ action: 'activate', name: version.name, language: version.language });
        }}>{tx('启用此版本', 'Activate version')}</Button>}
      </div>
    </article>)}</div>
  </CardContent></Card>;
}
