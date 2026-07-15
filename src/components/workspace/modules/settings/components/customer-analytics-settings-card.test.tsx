'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import { CustomerAnalyticsSettingsCard } from './customer-analytics-settings-card';

const config = {
  CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '18',
  CUSTOMER_ANALYTICS_NORMAL_DAYS: '35',
  CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '65',
  CUSTOMER_ANALYTICS_DELAY_DAYS: '95',
  CUSTOMER_ANALYTICS_WARNING_DAYS: '125',
  CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: '155',
  CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '185',
};

const fields = [
  ['Lookback months', 'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS', '18'],
  ['Normal term (days)', 'CUSTOMER_ANALYTICS_NORMAL_DAYS', '35'],
  ['Mild delay (days)', 'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS', '65'],
  ['Delay (days)', 'CUSTOMER_ANALYTICS_DELAY_DAYS', '95'],
  ['Warning (days)', 'CUSTOMER_ANALYTICS_WARNING_DAYS', '125'],
  ['Double warning (days)', 'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS', '155'],
  ['Severe warning (days)', 'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS', '185'],
] as const;

function renderCard(overrides: Partial<React.ComponentProps<typeof CustomerAnalyticsSettingsCard>> = {}) {
  const props: React.ComponentProps<typeof CustomerAnalyticsSettingsCard> = {
    loading: false,
    saving: false,
    canEdit: true,
    config,
    tx: (_zh, en) => en,
    onFieldChange: jest.fn(),
    onSave: jest.fn(),
    ...overrides,
  };
  render(<CustomerAnalyticsSettingsCard {...props} />);
  return props;
}

describe('CustomerAnalyticsSettingsCard', () => {
  it('renders all seven bounded integer fields from generic config state', () => {
    renderCard();

    for (const [label, _key, value] of fields) {
      const input = screen.getByRole('spinbutton', { name: label });
      expect(input).toHaveValue(Number(value));
      expect(input).toHaveAttribute('step', '1');
    }
    expect(screen.getByRole('spinbutton', { name: 'Lookback months' })).toHaveAttribute('max', '60');
    expect(screen.getByRole('spinbutton', { name: 'Severe warning (days)' })).toHaveAttribute('max', '3650');
  });

  it('uses approved defaults when generic config is not loaded yet', () => {
    renderCard({ config: {} });

    expect(screen.getByRole('spinbutton', { name: 'Lookback months' })).toHaveValue(12);
    expect(screen.getByRole('spinbutton', { name: 'Normal term (days)' })).toHaveValue(30);
    expect(screen.getByRole('spinbutton', { name: 'Severe warning (days)' })).toHaveValue(180);
  });

  it('forwards every field change with its exact system setting key', () => {
    const onFieldChange = jest.fn();
    renderCard({ onFieldChange });

    fields.forEach(([label, key], index) => {
      fireEvent.change(screen.getByRole('spinbutton', { name: label }), {
        target: { value: String(20 + index) },
      });
      expect(onFieldChange).toHaveBeenLastCalledWith(key, String(20 + index));
    });
  });

  it('uses the existing save action', () => {
    const onSave = jest.fn();
    renderCard({ onSave });

    fireEvent.click(screen.getByRole('button', { name: 'Save Customer Analytics Settings' }));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('disables editing for non-admin accounts and explains why', () => {
    renderCard({ canEdit: false });

    for (const [label] of fields) {
      expect(screen.getByRole('spinbutton', { name: label })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Save Customer Analytics Settings' })).toBeDisabled();
    expect(screen.getByText('Only admins can edit global customer analytics rules.')).toBeInTheDocument();
  });
});
