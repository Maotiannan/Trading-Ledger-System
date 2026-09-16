import { NotificationManager } from '@/components/workspace/modules/notifications/notification-manager';
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const params = await searchParams;
  return <NotificationManager initialChannel={params.channel === 'whatsapp' ? 'whatsapp' : 'email'} />;
}
