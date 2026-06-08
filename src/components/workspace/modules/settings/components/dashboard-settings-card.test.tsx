import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_DASHBOARD_LAYOUT } from '@/lib/dashboard-layout-preference';
import { DashboardSettingsCard } from './dashboard-settings-card';

const tx = (_zh: string, en: string) => en;

describe('DashboardSettingsCard', () => {
  it('renders sections, cards, and visibility switches', () => {
    render(
      <DashboardSettingsCard
        loading={false}
        saving={false}
        layout={DEFAULT_DASHBOARD_LAYOUT}
        tx={tx}
        onLayoutChange={jest.fn()}
        onSavePreferences={jest.fn()}
      />,
    );
    expect(screen.getByText('Summary Cards')).toBeInTheDocument();
    expect(screen.getByText('Invoice Balance')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Invoice Balance' })).toBeChecked();
  });

  it('moves a card down and saves the changed layout', async () => {
    const user = userEvent.setup();
    const onLayoutChange = jest.fn();
    render(
      <DashboardSettingsCard
        loading={false}
        saving={false}
        layout={DEFAULT_DASHBOARD_LAYOUT}
        tx={tx}
        onLayoutChange={onLayoutChange}
        onSavePreferences={jest.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Move Invoice Balance down' }));
    expect(onLayoutChange).toHaveBeenCalledWith(expect.objectContaining({ sections: expect.any(Array) }));
  });

  it('toggles card visibility without removing it from settings', async () => {
    const user = userEvent.setup();
    const onLayoutChange = jest.fn();
    render(
      <DashboardSettingsCard
        loading={false}
        saving={false}
        layout={DEFAULT_DASHBOARD_LAYOUT}
        tx={tx}
        onLayoutChange={onLayoutChange}
        onSavePreferences={jest.fn()}
      />,
    );
    await user.click(screen.getByRole('switch', { name: 'Invoice Balance' }));
    const nextLayout = onLayoutChange.mock.calls.at(-1)?.[0];
    expect(nextLayout.sections[0].cards.find((card: { id: string }) => card.id === 'invoice-balance').visible).toBe(false);
  });
});
