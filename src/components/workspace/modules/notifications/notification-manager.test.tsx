import { render, screen } from '@testing-library/react';
import { NotificationManager } from './notification-manager';
let role = 'ADMIN';
jest.mock('@/lib/store', () => ({ useStore: (selector: (state: unknown) => unknown) => selector({ user: { role } }) }));
jest.mock('@/components/workspace/shared', () => ({ useUiText: () => (_: string, en: string) => en }));
jest.mock('@/components/workspace/modules/emails', () => ({ EmailManager: () => <div>Email history</div> }));
jest.mock('@/components/workspace/modules/whatsapp/whatsapp-manager', () => ({ WhatsAppManager: () => <div>WhatsApp history</div> }));
jest.mock('@/components/workspace/modules/settings/components/email-notification-settings-card', () => ({ EmailNotificationSettingsCard: () => <div>Email config</div> }));
beforeEach(() => { role = 'ADMIN'; });
it('contains both channels and email settings behind one entry', () => {
  render(<NotificationManager />);
  expect(screen.getByText('Notification Management')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Email' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'WhatsApp' })).toBeInTheDocument();
  expect(screen.getByText('Email history')).toBeInTheDocument();
});
it('opens the legacy WhatsApp link in the correct channel', () => {
  render(<NotificationManager initialChannel="whatsapp" />);
  expect(screen.getByText('WhatsApp history')).toBeInTheDocument();
  expect(screen.queryByText('Email history')).not.toBeInTheDocument();
});
it('does not render notification data for SALES', () => {
  role = 'SALES';
  const { container } = render(<NotificationManager />);
  expect(container).toBeEmptyDOMElement();
});
