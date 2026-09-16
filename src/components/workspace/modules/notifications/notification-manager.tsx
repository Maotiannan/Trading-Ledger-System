'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useUiText } from '@/components/workspace/shared';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmailManager } from '@/components/workspace/modules/emails';
import { EmailNotificationSettingsCard } from '@/components/workspace/modules/settings/components/email-notification-settings-card';
import { WhatsAppManager } from '@/components/workspace/modules/whatsapp/whatsapp-manager';
export function NotificationManager({ initialChannel = 'email' }: { initialChannel?: string }) {
  const tx = useUiText();
  const user = useStore(state => state.user);
  const [channel, setChannel] = useState(initialChannel);
  if (user?.role !== 'ADMIN') return null;
  return <div className="min-w-0 space-y-4">
    <h1 className="text-2xl font-bold">{tx('通知管理', 'Notification Management')}</h1>
    <Tabs value={channel} onValueChange={setChannel} className="min-w-0">
      <TabsList><TabsTrigger value="email">{tx('邮件', 'Email')}</TabsTrigger><TabsTrigger value="whatsapp">WhatsApp</TabsTrigger></TabsList>
      <TabsContent value="email" className="min-w-0 space-y-4">
        <details className="rounded-md border p-3"><summary className="cursor-pointer">{tx('邮件设置与模板', 'Email Settings & Templates')}</summary>
          {channel === 'email' && <EmailNotificationSettingsCard tx={tx} />}
        </details>
        <EmailManager />
      </TabsContent>
      <TabsContent value="whatsapp" className="min-w-0"><WhatsAppManager /></TabsContent>
    </Tabs>
  </div>;
}
