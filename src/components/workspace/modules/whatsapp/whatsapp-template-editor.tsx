'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { defaultTemplateVersions, draftSchema, templateExampleValues, templateVariables, type TemplateDraft, type TemplateVersion } from '@/lib/whatsapp/whatsapp-template-definition';
import { whatsappLabel, whatsappVariable } from './whatsapp-labels';
const initial = defaultTemplateVersions()[0];
export function WhatsAppTemplateEditor() {
  const tx = useUiText();
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const initialized = useRef(false);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => {
    const result = await apiCall('whatsapp-templates');
    setVersions(result.data.templates);
    if (!initialized.current) {
      initialized.current = true;
      setDraft(current => result.data.templates.find((item: TemplateVersion) => item.kind === current.kind && item.language === current.language && item.active) || current);
    }
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
    if (kind.startsWith('outstanding')) language = 'fr';
    const selected = versions.find(item => item.kind === kind && item.language === language && item.active)
      || defaultTemplateVersions().find(item => item.kind === kind && item.language === language)!;
    setDraft({ ...selected, ...(kind.startsWith('outstanding') && !selected.sampleImageUrl && window.location.protocol === 'https:'
      ? { sampleImageUrl: window.location.origin + '/detail-export/outstanding-reminder-sample.png' } : {}) });
  }
  const reminder = draft.kind.startsWith('outstanding');
  const valid = draftSchema.safeParse(draft).success;
  const missing = templateVariables[draft.kind].map((variable, index) => ({ variable, token: '{{' + (index + 1) + '}}' })).filter(item => !draft.body.includes(item.token));
  const visibleVersions = versions.filter(version => version.kind === draft.kind && version.language === draft.language);
  function insertVariable(index: number) {
    const input = bodyInput.current;
    const start = input?.selectionStart ?? draft.body.length;
    const end = input?.selectionEnd ?? start;
    const token = '{{' + (index + 1) + '}}';
    setDraft({ ...draft, body: draft.body.slice(0, start) + token + draft.body.slice(end) });
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + token.length, start + token.length); });
  }
  return <Card><CardHeader><CardTitle>{tx('WhatsApp 模板自定义与审核', 'WhatsApp Template Editor & Review')}</CardTitle></CardHeader><CardContent className="space-y-4 min-w-0 px-3 sm:px-6">
    <p className="text-sm text-muted-foreground">{tx('保存会创建独立草稿版本；提交审核不发送消息。平台批准后手动启用新版本，历史消息不变。', 'Save creates a separate draft version. Submission sends no messages. Activate after approval; historical messages remain unchanged.')}</p>
    <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label={tx('模板发布流程', 'Template workflow')}>
      {[tx('1. 编辑并保存草稿', '1. Edit and save draft'), tx('2. 提交平台审核', '2. Submit for provider review'), tx('3. 审核通过后启用', '3. Activate after approval')].map(step => <li key={step} className="rounded-md border bg-muted/40 p-3">{step}</li>)}
    </ol>
    {message && <p role="status" className="break-words">{message}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label>{tx('通知类型', 'Notification type')}<select className="block w-full border rounded-md p-2" value={draft.kind} onChange={event => selectSlot(event.target.value as TemplateDraft['kind'], draft.language)}>
        <option value="payment">{tx('收款', 'Payment received')}</option><option value="shipment">{tx('出运', 'Shipment')}</option><option value="release">{tx('放单', 'Release')}</option>
        {[30, 60, 120, 180].map(day => <option key={day} value={'outstanding' + day}>{tx('欠款提醒', 'Outstanding reminder')} {day}{tx('天', ' days')}</option>)}
        <option value="correction">{tx('付款记录更正', 'Payment correction')}</option>
      </select></label>
      <label>{tx('语言', 'Language')}<select aria-label={tx('语言', 'Language')} className="block w-full border rounded-md p-2" disabled={draft.kind.startsWith('outstanding')} value={draft.language} onChange={event => selectSlot(draft.kind, event.target.value as TemplateDraft['language'])}><option value="en">{tx("英语", "English")}</option><option value="fr">{tx("法语", "Français")}</option></select></label>
    </div>
    <div className="grid grid-cols-1 min-w-0 gap-5 lg:grid-cols-2"><div className="min-w-0 space-y-4">
    {reminder && <p className="text-sm text-muted-foreground">{tx('欠款提醒固定使用法语，发送时重新生成客户完整对账图片。下方图片地址只用于平台审核。', 'Reminders use French. A fresh customer statement is generated when sending. The image URL below is for provider review only.')}</p>}
    {reminder && <label className="block">{tx('审核用样例图片 HTTPS 地址（仅使用虚构客户数据）', 'Review sample image HTTPS URL (fictional data only)')}<Input value={draft.sampleImageUrl || ''} onChange={event => setDraft({ ...draft, sampleImageUrl: event.target.value || undefined })} /></label>}
    <label className="block">{reminder ? tx('内部标题（图片模板不发送此标题）', 'Internal title (not sent for image templates)') : tx('标题', 'Title')}<Input maxLength={60} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label className="block">{tx('正文', 'Body')}<Textarea ref={bodyInput} rows={10} maxLength={1024} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">{tx('动态字段：点击插入到正文光标处', 'Dynamic fields: insert at the cursor')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">{templateVariables[draft.kind].map((variable, index) => <button type="button" className="rounded-md border p-2 text-left text-sm hover:bg-muted min-w-0" key={variable} onClick={() => insertVariable(index)}>
        <span className="block font-medium">{whatsappVariable(variable, tx)} <code className="text-muted-foreground">{'{{' + (index + 1) + '}}'}</code></span>
        <span className="block break-words text-xs text-muted-foreground">{tx('示例：', 'Example: ')}{templateExampleValues(draft.kind)[index]}</span>
      </button>)}</div>
    </fieldset>
    <p className="text-sm text-muted-foreground">{tx('可移动变量，但必须保留所有编号；编号含义固定，不能用客户真实数据替换。', 'Variables may move but all numbered variables must remain. Their meanings are fixed; do not insert real customer data into templates.')}</p>
    <label className="block">{tx('页脚', 'Footer')}<Input maxLength={60} value={draft.footer} onChange={event => setDraft({ ...draft, footer: event.target.value })} /></label>
    {!valid && <p role="alert" className="text-sm text-destructive">{missing.length
      ? tx('请保留以下动态字段：', 'Keep these required fields: ') + missing.map(item => whatsappVariable(item.variable, tx) + ' ' + item.token).join(' / ')
      : tx('请检查标题、正文、页脚长度和变量编号；标题和页脚不能包含换行或变量，图片地址必须为 HTTPS。', 'Check text lengths and variable numbers. Title and footer cannot contain line breaks or variables; image URLs must use HTTPS.')}</p>}
    <Button disabled={busy || !valid} onClick={() => void run({ action: 'save', draft })}>{tx('保存为新草稿', 'Save as new draft')}</Button>
    </div><section className="min-w-0 rounded-lg border bg-muted/40 p-4 space-y-3 self-start" aria-label={tx('消息效果预览', 'Message preview')}>
      <h3 className="font-semibold">{tx('客户看到的效果', 'Customer message preview')}</h3>
      <p className="text-sm text-muted-foreground">{tx('以下为虚构数据样例，不会发送。界面语言不改变客户收到的英法文。', 'Preview uses fictional sample data. Nothing is sent. Interface language does not change the customer message language.')}</p>
      <div className="rounded-lg border bg-background p-4 shadow-sm space-y-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {reminder ? <div className="rounded-md border p-3 text-sm bg-muted"><strong>{tx('客户欠款对账图片', 'Customer outstanding statement image')}</strong><p>{tx('此处为图片位置示意；实际发送时使用最新余额生成完整法语对账单。', 'Image placeholder. The full French statement is generated using the latest balance at sending time.')}</p></div> : <strong>{draft.title}</strong>}
        <p>{preview}</p><p className="text-muted-foreground text-sm">{draft.footer}</p>
      </div>
    </section></div>
    <h3 className="font-semibold">{tx('当前类型与语言的模板版本', 'Versions for selected type and language')} ({visibleVersions.length})</h3>
    <p className="text-sm text-muted-foreground">{tx('复制编辑不会修改原版本。保存草稿不等于启用；只有平台审核通过的业务通知模板可以启用。', 'Copying does not change the original. Saving does not activate a template; only approved Utility templates can be activated.')}</p>
    <div className="space-y-3">{visibleVersions.map(version => <article className="border rounded-md p-3 min-w-0 space-y-2" key={version.name + version.language}>
      <p className="font-medium break-words">{version.title}</p><p className="break-all text-xs text-muted-foreground">{version.name} · {version.language}</p>
      <p>{version.status === 'PENDING' ? tx('平台审核中', 'Provider review pending') : whatsappLabel(version.status, tx)} · {whatsappLabel(version.category, tx)}{version.active ? ' · ' + tx('当前使用', 'Active') : ''}</p>
      <details><summary className="cursor-pointer">{tx('查看内容', 'View content')}</summary><p className="whitespace-pre-wrap break-words">{version.body}</p></details>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => setDraft(version)}>{tx('复制编辑', 'Copy to editor')}</Button>
        {version.status === 'DRAFT' ? <Button disabled={busy || !version.createdAt} onClick={() => {
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
