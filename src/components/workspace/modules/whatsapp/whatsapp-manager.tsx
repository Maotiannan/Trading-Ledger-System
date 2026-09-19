'use client';
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListPagination } from '@/components/workspace/modules/shared/list-pagination';
import { WhatsAppTemplateEditor } from './whatsapp-template-editor';
import { formatAppDateTime } from '@/lib/app-time';
type Settings = { outboundEnabled: boolean; testMode: boolean; testDestination: string; activatedAt: string | null; enabledTypes?: string[] };
type Row = { nextSendAt?: string | null; updatedAt?: string; requiresApproval?: boolean; correctionOf?: unknown; id: string; status: string; type: string; actualTo: string; testMode: boolean; createdAt: string; businessSnapshot: unknown; parameters: string[]; templateName: string; languageCode: string; failureCode: string | null };
type Contact = { id: string; phone: string; optedInAt: string | null; optedOutAt: string | null };
type Customer = { id: string; name: string; mark: string; orderName: string; phone: string; whatsappContacts: Contact[] };
type Template = { name: string; language: string; components: { type: string; text?: string }[] };
export function WhatsAppManager() {
  const tx = useUiText();
  const user = useStore(state => state.user);
  const [rows, setRows] = useState<Row[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [deploymentEnabled, setDeploymentEnabled] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [phone, setPhone] = useState('');
  const [consentSource, setConsentSource] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null);
  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const subscribed = Boolean(selectedCustomer?.whatsappContacts.some(contact => contact.optedInAt && !contact.optedOutAt));
  const load = useCallback(async () => {
    if (user?.role !== 'ADMIN') return;
    setBusy(true);
    try {
      const [list, config] = await Promise.all([apiCall('whatsapp-notifications?page=' + page + '&pageSize=' + pageSize), apiCall('whatsapp-settings')]);
      setRows(list.data.items); setTotal(list.data.total);
      setSettings(config.data.settings); setTemplates(config.data.templates);
      setDeploymentEnabled(config.data.deploymentEnabled === true); setError('');
    } catch { setError(tx('加载失败，请重试', 'Unable to load. Please retry.')); }
    finally { setBusy(false); }
  }, [page, pageSize, tx, user?.role]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || busy) return;
      try {
        const list = await apiCall('whatsapp-notifications?page=' + page + '&pageSize=' + pageSize);
        if (active) { setRows(list.data.items); setTotal(list.data.total); }
      } catch { /* Keep the existing list; explicit refresh reports errors. */ }
    }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [page, pageSize, busy, user?.role]);
  async function action(endpoint: string, body: unknown) {
    setBusy(true); setError('');
    try { await apiCall(endpoint, { method: 'POST', body: JSON.stringify(body) }); await load(); }
    catch { setError(endpoint === 'whatsapp-notifications'
      ? tx('任务可能已更新、取消或提交发送，请刷新后重新查看。', 'The task may have changed, been cancelled or submitted. Refresh and review it again.')
      : tx('操作失败，请检查输入后重试', 'Action failed. Check the input and retry.')); }
    finally { setBusy(false); }
  }
  async function findCustomers() {
    setBusy(true);
    try { const result = await apiCall('whatsapp-contacts?search=' + encodeURIComponent(search)); setCustomers(result.data); setCustomerId(''); }
    catch { setError(tx('搜索失败', 'Search failed.')); }
    finally { setBusy(false); }
  }
  async function saveConsent(nextOptIn: boolean) {
    if (!nextOptIn && !window.confirm(tx('确认取消该客户的 WhatsApp 订阅？待审核及排队中的通知将取消，已提交发送的消息无法撤回。', 'Unsubscribe this customer from WhatsApp? Pending and queued notifications will be cancelled. Messages already submitted cannot be recalled.'))) return;
    setBusy(true); setError('');
    try {
      const result = await apiCall('whatsapp-contacts', { method: 'POST', body: JSON.stringify({
        customerId, optIn: nextOptIn,
        consentSource: consentSource.trim() || tx('管理员在通知管理中取消客户订阅', 'Administrator unsubscribed customer in notification management'),
      }) });
      setCustomers(current => current.map(customer => customer.id === customerId ? { ...customer, whatsappContacts: [result.data] } : customer));
      setOptIn(nextOptIn); setConsentSource('');
      await load();
    } catch { setError(tx('订阅状态保存失败，请重试', 'Unable to save subscription status. Please retry.')); }
    finally { setBusy(false); }
  }
  if (user?.role !== 'ADMIN') return null;
  return <div className="space-y-4 min-w-0">
    <h1 className="text-2xl font-bold">{tx('WhatsApp 通知', 'WhatsApp Notifications')}</h1>
    {!deploymentEnabled && <p role="status" className="rounded-md border p-3 text-sm">{tx('服务端外发尚未启用。可以维护客户授权和查看模板，当前不会发送消息。', 'Server-side sending is not enabled. You can maintain consent and review templates; no messages will be sent yet.')}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Card><CardHeader><CardTitle>{tx('发送设置', 'Sending Settings')}</CardTitle></CardHeader><CardContent className="space-y-3">
      {settings && <>
        <label className="flex gap-2"><input type="checkbox" checked={settings.outboundEnabled} onChange={event => setSettings({ ...settings, outboundEnabled: event.target.checked })} />{tx('启用发送', 'Enable sending')}</label>
        <label className="flex gap-2"><input type="checkbox" checked={settings.testMode} onChange={event => setSettings({ ...settings, testMode: event.target.checked })} />{tx('测试模式：管理员审核后发送', 'Test mode: ADMIN approval required')}</label>
        <label className="block">{tx('测试号码（含国家代码）', 'Test number (international format)')}<Input value={settings.testDestination} onChange={event => setSettings({ ...settings, testDestination: event.target.value })} /></label>
        <p className="text-sm text-muted-foreground">{tx('正式模式下，新通知将自动发送给已同意接收的客户；历史任务不会转为正式发送。', 'In production mode, new notifications are sent automatically to opted-in customers. Test tasks never become production deliveries.')}</p>
        <fieldset className="flex flex-wrap gap-3"><legend>{tx('通知类型', 'Notification types')}</legend>{(['PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE'] as const).map((type, index) => <label key={type} className="flex gap-2"><input type="checkbox" checked={(settings.enabledTypes || ['PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE']).includes(type)} onChange={event => { const current = settings.enabledTypes || ['PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE']; setSettings({ ...settings, enabledTypes: event.target.checked ? [...current, type] : current.filter(value => value !== type) }); }} />{[tx('收款', 'Payment'), tx('出运', 'Shipment'), tx('放单', 'Release')][index]}</label>)}</fieldset>
        <Button disabled={busy} onClick={() => { if (window.confirm(tx('确认保存发送设置？正式模式会自动通知客户。', 'Save sending settings? Production mode automatically notifies customers.'))) void action('whatsapp-settings', settings); }}>{tx('保存设置', 'Save settings')}</Button>
      </>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tx('客户号码与接收同意', 'Customer Numbers & Consent')}</CardTitle></CardHeader><CardContent className="space-y-3">
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void findCustomers(); }}>
        <Input aria-label={tx('搜索客户', 'Search customers')} placeholder="MARK / ORDER_NAME / NAME" value={search} onChange={event => setSearch(event.target.value)} /><Button disabled={busy}>{tx('搜索', 'Search')}</Button>
      </form>
      <select disabled={busy} className="w-full min-w-0 border rounded-md p-2" value={customerId} onChange={event => { const customer = customers.find(customer => customer.id === event.target.value); setCustomerId(event.target.value); setPhone(customer?.phone || ''); setOptIn(Boolean(customer?.whatsappContacts.some(contact => contact.optedInAt && !contact.optedOutAt))); setConsentSource(''); }} aria-label={tx('选择客户', 'Select customer')}>
        <option value="">{tx('选择客户', 'Select customer')}</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.mark} / {customer.orderName} / {customer.name}</option>)}
      </select>
      {selectedCustomer && <p role="status">{subscribed ? tx('已订阅', 'Subscribed') : tx('未订阅', 'Not subscribed')}</p>}
      <p className="text-sm text-muted-foreground">{tx('号码自动读取客户 PHONE；修改 PHONE 后，待发与后续通知使用新号码，已发记录不变。', 'Number comes from Customer PHONE. Pending and future messages use the updated number; sent history stays unchanged.')}</p>
      <Input type="tel" aria-label={tx('WhatsApp 号码', 'WhatsApp number')} placeholder="Customer PHONE" value={phone} readOnly />
      <Input aria-label={tx('同意或退订依据', 'Consent or opt-out evidence')} placeholder={tx('客户何时、通过什么方式同意或退订', 'When and how the customer consented or opted out')} value={consentSource} onChange={event => setConsentSource(event.target.value)} />
      <label className="flex gap-2"><input type="checkbox" checked={optIn} onChange={event => setOptIn(event.target.checked)} />{tx('客户已明确同意接收 WhatsApp 通知', 'Customer explicitly agreed to WhatsApp notifications')}</label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !customerId || !consentSource.trim()} onClick={() => void saveConsent(optIn)}>{tx('保存订阅授权', 'Save subscription consent')}</Button>
        {subscribed && <Button variant="destructive" disabled={busy} onClick={() => void saveConsent(false)}>{tx('取消订阅', 'Unsubscribe')}</Button>}
      </div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tx('通知记录', 'Notifications')}</CardTitle><p className="text-sm text-muted-foreground">{tx('自动通知延时五分钟；内容修改后重新计时。删除申请期间暂停，获批后取消。', 'Automatic notifications wait five minutes; content changes restart the timer. Deletion requests pause sending until reviewed.')}</p><Button variant="outline" disabled={busy} onClick={() => void load()}>{tx('刷新', 'Refresh')}</Button></CardHeader><CardContent>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{[tx('时间', 'Date'), tx('类型', 'Type'), tx('收件人', 'To'), tx('状态', 'Status'), tx('预计发送', 'Scheduled'), ''].map((label, index) => <th className="p-2 text-left" key={index}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t">
        <td className="p-2 whitespace-nowrap">{formatAppDateTime(row.createdAt)}</td><td className="p-2">{row.type}{row.testMode && <span className="block text-muted-foreground">TEST</span>}</td><td className="p-2 whitespace-nowrap">{row.actualTo}</td><td className="p-2">{row.status === 'PAUSED' ? tx('暂停', 'Paused') : row.status}{row.correctionOf ? <span className="block">{tx('更正通知，需审核', 'Correction: approval required')}</span> : null}{row.failureCode && <span className="block">{row.failureCode}</span>}</td>
        <td className="p-2 whitespace-nowrap">{row.status === 'QUEUED' && row.nextSendAt ? formatAppDateTime(row.nextSendAt) : '-'}</td>
        <td className="p-2"><Button variant="outline" onClick={() => setPreview(row)}>{tx('预览', 'Preview')}</Button>{(row.testMode || row.requiresApproval) && row.status === 'PENDING' && <Button disabled={busy} onClick={() => { setPreview(row); }}>{tx('审核', 'Review')}</Button>}{['PENDING', 'QUEUED', 'PAUSED'].includes(row.status) && <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(tx('确认取消此通知？取消后不会自动恢复。已提交的消息不能撤回。', 'Cancel this notification permanently? Messages already submitted cannot be recalled.'))) void action('whatsapp-notifications', { action: 'cancel', ids: [row.id] }); }}>{tx('取消', 'Cancel')}</Button>}</td>
      </tr>)}</tbody></table></div>
      {rows.length === 0 && <p className="py-4 text-muted-foreground">{tx('暂无通知', 'No notifications yet.')}</p>}
      <ListPagination idPrefix="whatsapp" tx={tx} compact currentPage={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalCount={total} pageSize={pageSize} pageSizeOptions={[5, 10, 20, 50]} disabled={busy} onPreviousPage={() => setPage(page - 1)} onNextPage={() => setPage(page + 1)} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
      {preview && <section className="mt-4 border rounded-md p-4 space-y-3">
        <h2 className="font-bold">{tx('发送内容预览', 'Message Preview')} · {preview.actualTo}</h2>
        <pre className="whitespace-pre-wrap break-words font-sans">{templates.find(template => template.name === preview.templateName && template.language === preview.languageCode)?.components.find(component => component.type === 'BODY')?.text?.replace(/{{(\d+)}}/g, (_, index) => preview.parameters[Number(index) - 1] || '-') || tx('模板不可用，请勿审核', 'Template unavailable; do not approve')}</pre>
        {(preview.testMode || preview.requiresApproval) && preview.status === 'PENDING' && <Button disabled={busy} onClick={() => { void action('whatsapp-notifications', { action: 'approve', ids: [preview.id], expectedUpdatedAt: preview.updatedAt }); setPreview(null); }}>{tx('确认审核，允许发送', 'Approve delivery')}</Button>}
        <Button variant="outline" onClick={() => setPreview(null)}>{tx('关闭', 'Close')}</Button>
      </section>}
    </CardContent></Card>
    <WhatsAppTemplateEditor />
  </div>;
}
