'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import {
  DEFAULT_EMAIL_SETTINGS,
  type CustomerEmailLanguageValue,
  type EmailNotificationTypeValue,
  type EmailSettings,
  type EmailTemplateSummary,
  type EmailTemplateVariable,
  type RenderedEmailTemplate,
} from '@/lib/email/email-types';
import { Eye, Loader2, Save } from 'lucide-react';

type EmailSettingsResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  settings?: EmailSettings;
  templates?: EmailTemplateSummary[];
  variableCatalog?: Partial<Record<EmailNotificationTypeValue, EmailTemplateVariable[]>>;
  apiKeyConfigured?: boolean;
  webhookSecretConfigured?: boolean;
  template?: EmailTemplateSummary;
  preview?: RenderedEmailTemplate;
};

const EVENT_OPTIONS: Array<{ type: EmailNotificationTypeValue; zh: string; en: string }> = [
  { type: 'PAYMENT_RECEIVED', zh: '收款', en: 'Payment Received' },
  { type: 'SHIPMENT', zh: '出运', en: 'Shipment' },
  { type: 'RELEASE', zh: '放单', en: 'Release' },
];

const LANGUAGE_OPTIONS: Array<{ language: CustomerEmailLanguageValue; label: string }> = [
  { language: 'ENGLISH', label: 'English' },
  { language: 'FRENCH', label: 'Francais' },
];

function normalizeTemplates(value: unknown): EmailTemplateSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const type = String(row.type || '') as EmailNotificationTypeValue;
    const language = String(row.language || '') as CustomerEmailLanguageValue;
    if (!EVENT_OPTIONS.some((option) => option.type === type) || !LANGUAGE_OPTIONS.some((option) => option.language === language)) return [];
    return [{
      id: String(row.id || ''),
      type,
      language,
      version: Math.max(1, Number(row.version) || 1),
      subjectTemplate: String(row.subjectTemplate || ''),
      bodyTemplate: String(row.bodyTemplate || ''),
      requiredVariables: Array.isArray(row.requiredVariables)
        ? row.requiredVariables.map(String) as EmailTemplateVariable[]
        : [],
      isActive: row.isActive !== false,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
    }];
  });
}

function settingsValue(value: unknown): EmailSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_EMAIL_SETTINGS };
  const row = value as Partial<EmailSettings>;
  return {
    outboundEnabled: Boolean(row.outboundEnabled),
    recipientMode: row.recipientMode === 'SEPARATE' ? 'SEPARATE' : 'PRIMARY_CC',
    senderName: String(row.senderName ?? DEFAULT_EMAIL_SETTINGS.senderName),
    senderAddress: String(row.senderAddress ?? ''),
    replyToAddress: String(row.replyToAddress ?? ''),
    retryLimit: Number.isInteger(Number(row.retryLimit)) ? Number(row.retryLimit) : DEFAULT_EMAIL_SETTINGS.retryLimit,
    retryIntervalsSeconds: Array.isArray(row.retryIntervalsSeconds)
      ? row.retryIntervalsSeconds.map(Number)
      : [...DEFAULT_EMAIL_SETTINGS.retryIntervalsSeconds],
    testModeEnabled: row.testModeEnabled !== false,
    testDestination: String(row.testDestination ?? ''),
    logoUrl: String(row.logoUrl ?? DEFAULT_EMAIL_SETTINGS.logoUrl),
  };
}

export type EmailNotificationSettingsCardProps = {
  tx: (zh: string, en: string) => string;
};

export function EmailNotificationSettingsCard({ tx }: EmailNotificationSettingsCardProps) {
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState<EmailSettings>({ ...DEFAULT_EMAIL_SETTINGS });
  const [retryIntervalsInput, setRetryIntervalsInput] = useState(DEFAULT_EMAIL_SETTINGS.retryIntervalsSeconds.join(', '));
  const [templates, setTemplates] = useState<EmailTemplateSummary[]>([]);
  const [variableCatalog, setVariableCatalog] = useState<Partial<Record<EmailNotificationTypeValue, EmailTemplateVariable[]>>>({});
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState(false);
  const [selectedType, setSelectedType] = useState<EmailNotificationTypeValue>('PAYMENT_RECEIVED');
  const [selectedLanguage, setSelectedLanguage] = useState<CustomerEmailLanguageValue>('ENGLISH');
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(1);
  const [preview, setPreview] = useState<RenderedEmailTemplate | null>(null);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');

  const applyTemplateDraft = useCallback((rows: EmailTemplateSummary[], type: EmailNotificationTypeValue, language: CustomerEmailLanguageValue) => {
    const template = rows.find((item) => item.type === type && item.language === language);
    setSubjectTemplate(template?.subjectTemplate || '');
    setBodyTemplate(template?.bodyTemplate || '');
    setSelectedVersion(template?.version || 1);
    setPreview(null);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiCall('email-settings') as EmailSettingsResponse;
      if (!result.success) {
        setError(String(result.error || result.message || tx('邮件通知设置加载失败', 'Failed to load email notification settings.')));
        return;
      }
      const nextSettings = settingsValue(result.settings);
      const nextTemplates = normalizeTemplates(result.templates);
      setSettings(nextSettings);
      setRetryIntervalsInput(nextSettings.retryIntervalsSeconds.join(', '));
      setTemplates(nextTemplates);
      setVariableCatalog(result.variableCatalog || {});
      setApiKeyConfigured(Boolean(result.apiKeyConfigured));
      setWebhookSecretConfigured(Boolean(result.webhookSecretConfigured));
      applyTemplateDraft(nextTemplates, 'PAYMENT_RECEIVED', 'ENGLISH');
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, tx('邮件通知设置加载失败', 'Failed to load email notification settings.')));
    } finally {
      setLoading(false);
    }
  }, [applyTemplateDraft, tx]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const selectTemplate = (type: EmailNotificationTypeValue, language: CustomerEmailLanguageValue) => {
    setSelectedType(type);
    setSelectedLanguage(language);
    setError('');
    setMessage('');
    applyTemplateDraft(templates, type, language);
  };

  const updateSetting = <K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  };

  const saveSettings = async () => {
    const tokens = retryIntervalsInput.split(',').map((item) => item.trim()).filter(Boolean);
    const intervals = tokens.map(Number);
    if (tokens.length === 0 || intervals.some((item) => !Number.isInteger(item) || item <= 0)) {
      setError(tx('重试间隔必须使用逗号分隔的正整数秒数。', 'Retry intervals must be comma-separated positive whole seconds.'));
      return;
    }
    setSavingSettings(true);
    setError('');
    setMessage('');
    try {
      const result = await apiCall('email-settings', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save-settings',
          settings: { ...settings, retryIntervalsSeconds: intervals },
        }),
      }) as EmailSettingsResponse;
      if (!result.success) {
        setError(String(result.error || result.message || tx('邮件设置保存失败', 'Failed to save email settings.')));
        return;
      }
      const nextSettings = settingsValue(result.settings || { ...settings, retryIntervalsSeconds: intervals });
      setSettings(nextSettings);
      setRetryIntervalsInput(nextSettings.retryIntervalsSeconds.join(', '));
      setMessage(String(result.message || tx('邮件设置已保存', 'Email settings saved.')));
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, tx('邮件设置保存失败', 'Failed to save email settings.')));
    } finally {
      setSavingSettings(false);
    }
  };

  const templatePayload = useMemo(() => ({
    type: selectedType,
    language: selectedLanguage,
    version: selectedVersion,
    subjectTemplate,
    bodyTemplate,
  }), [bodyTemplate, selectedLanguage, selectedType, selectedVersion, subjectTemplate]);

  const saveTemplate = async () => {
    setSavingTemplate(true);
    setError('');
    setMessage('');
    try {
      const result = await apiCall('email-settings', {
        method: 'POST',
        body: JSON.stringify({ action: 'save-template', template: templatePayload }),
      }) as EmailSettingsResponse;
      if (!result.success || !result.template) {
        setError(String(result.error || result.message || tx('邮件模板保存失败', 'Failed to save email template.')));
        return;
      }
      const saved = normalizeTemplates([result.template])[0];
      if (!saved) throw new Error(tx('服务器返回的邮件模板无效', 'The server returned an invalid email template.'));
      setTemplates((previous) => [...previous.filter((item) => !(item.type === saved.type && item.language === saved.language)), saved]);
      setSelectedVersion(saved.version);
      setSubjectTemplate(saved.subjectTemplate);
      setBodyTemplate(saved.bodyTemplate);
      setPreview(null);
      setMessage(String(result.message || tx('邮件模板已保存', 'Email template saved.')));
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, tx('邮件模板保存失败', 'Failed to save email template.')));
    } finally {
      setSavingTemplate(false);
    }
  };

  const previewTemplate = async () => {
    setPreviewing(true);
    setError('');
    setMessage('');
    try {
      const result = await apiCall('email-settings', {
        method: 'POST',
        body: JSON.stringify({ action: 'preview-template', template: templatePayload }),
      }) as EmailSettingsResponse;
      if (!result.success || !result.preview) {
        setError(String(result.error || result.message || tx('邮件模板预览失败', 'Failed to preview email template.')));
        return;
      }
      setPreview(result.preview);
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, tx('邮件模板预览失败', 'Failed to preview email template.')));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Card data-testid="email-notification-settings-card">
      <CardHeader>
        <CardTitle>{tx('客户邮件通知', 'Customer Email Notifications')}</CardTitle>
        <CardDescription>
          {tx(
            '业务事件只生成待审核邮件。每封客户邮件仍须由管理员明确批准后才能发送。',
            'Business events create review tasks only. Every customer email still requires explicit ADMIN approval.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {message ? <Alert><AlertDescription>{message}</AlertDescription></Alert> : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {tx('加载中...', 'Loading...')}
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <div>
                <h3 className="font-semibold">{tx('发送与收件设置', 'Delivery and Recipient Settings')}</h3>
                <p className="text-sm text-muted-foreground">
                  {tx('上线后默认关闭发送并开启测试投递。', 'Outbound delivery is disabled and test delivery is enabled by default.')}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <input
                    type="checkbox"
                    aria-label={tx('启用外发邮件', 'Outbound email enabled')}
                    checked={settings.outboundEnabled}
                    onChange={(event) => updateSetting('outboundEnabled', event.target.checked)}
                  />
                  {tx('启用外发邮件', 'Outbound email enabled')}
                </label>
                <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <input
                    type="checkbox"
                    aria-label={tx('测试投递模式', 'Test-delivery mode')}
                    checked={settings.testModeEnabled}
                    onChange={(event) => updateSetting('testModeEnabled', event.target.checked)}
                  />
                  {tx('测试投递模式', 'Test-delivery mode')}
                </label>

                <div className="space-y-1.5">
                  <Label htmlFor="email-recipient-mode">{tx('收件人模式', 'Recipient mode')}</Label>
                  <select
                    id="email-recipient-mode"
                    aria-label={tx('收件人模式', 'Recipient mode')}
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    value={settings.recipientMode}
                    onChange={(event) => updateSetting('recipientMode', event.target.value === 'SEPARATE' ? 'SEPARATE' : 'PRIMARY_CC')}
                  >
                    <option value="PRIMARY_CC">Primary + CC</option>
                    <option value="SEPARATE">Separate delivery</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-sender-name">{tx('发件人名称', 'Sender name')}</Label>
                  <Input id="email-sender-name" value={settings.senderName} onChange={(event) => updateSetting('senderName', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-sender-address">{tx('发件邮箱', 'Sender address')}</Label>
                  <Input id="email-sender-address" type="email" value={settings.senderAddress} onChange={(event) => updateSetting('senderAddress', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-reply-to">Reply-to</Label>
                  <Input id="email-reply-to" type="email" value={settings.replyToAddress} onChange={(event) => updateSetting('replyToAddress', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-retry-limit">{tx('最大重试次数', 'Retry limit')}</Label>
                  <Input id="email-retry-limit" type="number" min={1} max={10} value={settings.retryLimit} onChange={(event) => updateSetting('retryLimit', Number(event.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-retry-intervals">{tx('重试间隔（秒）', 'Retry intervals (seconds)')}</Label>
                  <Input id="email-retry-intervals" value={retryIntervalsInput} onChange={(event) => setRetryIntervalsInput(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-test-destination">{tx('测试收件邮箱', 'Test destination')}</Label>
                  <Input id="email-test-destination" type="email" value={settings.testDestination} onChange={(event) => updateSetting('testDestination', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-logo-url">Logo URL</Label>
                  <Input id="email-logo-url" type="url" value={settings.logoUrl} onChange={(event) => updateSetting('logoUrl', event.target.value)} />
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm sm:flex-row sm:justify-between">
                <span>Resend API key: {apiKeyConfigured ? 'Configured' : 'Missing'}</span>
                <span>Webhook secret: {webhookSecretConfigured ? 'Configured' : 'Missing'}</span>
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => { void saveSettings(); }} disabled={savingSettings}>
                  {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {tx('保存邮件设置', 'Save Email Settings')}
                </Button>
              </div>
            </section>

            <section className="space-y-5 border-t pt-6">
              <div>
                <h3 className="font-semibold">{tx('邮件模板', 'Email Templates')}</h3>
                <p className="text-sm text-muted-foreground">
                  {tx('模板保存会创建新版本，历史已发送内容不会被改写。', 'Saving creates a new version and never rewrites sent history.')}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {EVENT_OPTIONS.map((option) => (
                  <Button
                    key={option.type}
                    type="button"
                    size="sm"
                    variant={selectedType === option.type ? 'default' : 'outline'}
                    onClick={() => selectTemplate(option.type, selectedLanguage)}
                  >
                    {tx(option.zh, option.en)}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {LANGUAGE_OPTIONS.map((option) => (
                  <Button
                    key={option.language}
                    type="button"
                    size="sm"
                    variant={selectedLanguage === option.language ? 'default' : 'outline'}
                    onClick={() => selectTemplate(selectedType, option.language)}
                  >
                    {option.label}
                  </Button>
                ))}
                <span className="self-center text-xs text-muted-foreground">Version {selectedVersion}</span>
              </div>

              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {tx('可用且必填的变量', 'Available required variables')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(variableCatalog[selectedType] || []).map((variable) => (
                    <code key={variable} className="rounded bg-background px-2 py-1 text-xs">{`{{${variable}}}`}</code>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email-subject-template">{tx('邮件主题模板', 'Email subject template')}</Label>
                <Input id="email-subject-template" value={subjectTemplate} onChange={(event) => setSubjectTemplate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-body-template">{tx('邮件正文模板', 'Email body template')}</Label>
                <textarea
                  id="email-body-template"
                  className="min-h-56 w-full rounded-md border bg-transparent p-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={bodyTemplate}
                  onChange={(event) => setBodyTemplate(event.target.value)}
                />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => { void previewTemplate(); }} disabled={previewing || savingTemplate}>
                  {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                  {tx('预览模板', 'Preview Template')}
                </Button>
                <Button type="button" onClick={() => { void saveTemplate(); }} disabled={savingTemplate || previewing}>
                  {savingTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {tx('保存模板', 'Save Template')}
                </Button>
              </div>

              {preview ? (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-sm font-medium">{preview.subject}</div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant={previewViewport === 'desktop' ? 'default' : 'outline'} onClick={() => setPreviewViewport('desktop')}>
                        {tx('电脑预览', 'Desktop preview')}
                      </Button>
                      <Button type="button" size="sm" variant={previewViewport === 'mobile' ? 'default' : 'outline'} onClick={() => setPreviewViewport('mobile')}>
                        {tx('手机预览', 'Mobile preview')}
                      </Button>
                    </div>
                  </div>
                  <div
                    data-testid="email-preview-frame-wrap"
                    className={`mx-auto w-full overflow-hidden rounded-md border bg-white transition-[max-width] ${previewViewport === 'mobile' ? 'max-w-[390px]' : 'max-w-full'}`}
                  >
                    <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[620px] w-full border-0" />
                  </div>
                </div>
              ) : null}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
