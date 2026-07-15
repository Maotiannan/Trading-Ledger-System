'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerAnalyticsRiskIndicator } from './customer-analytics-risk-indicator';

describe('CustomerAnalyticsRiskIndicator', () => {
  it('keeps the row visual compact and opens the explanation on tap', async () => {
    render(
      <CustomerAnalyticsRiskIndicator
        roundedDays={52}
        riskBand={{
          id: 'mild-delay',
          minDays: 31,
          maxDays: 59,
          zh: '轻微拖延',
          en: 'Mild delay',
        }}
        tx={(_zh, en) => en}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Payment-cycle risk: 52 days' });
    expect(trigger).toHaveTextContent('52d');
    expect(trigger).toHaveClass('text-amber-700');
    expect(screen.queryByText('Mild delay')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(await screen.findByTestId('customer-analytics-risk-popover')).toHaveTextContent('Mild delay');
    expect(screen.getByTestId('customer-analytics-risk-popover')).toHaveTextContent('31–59 days');
  });

  it('exposes the same explanation on keyboard focus', async () => {
    render(
      <CustomerAnalyticsRiskIndicator
        roundedDays={180}
        riskBand={{
          id: 'severe-warning',
          minDays: 180,
          maxDays: null,
          zh: '严重警告',
          en: 'Severe warning',
        }}
        tx={(_zh, en) => en}
      />,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Payment-cycle risk: 180 days' }));

    await waitFor(() => {
      expect(screen.getByTestId('customer-analytics-risk-tooltip')).toHaveTextContent('Severe warning');
    });
  });
});
