'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import { SystemConfigCard } from './system-config-card';

describe('SystemConfigCard', () => {
  it('does not expose OCR_API_KEY as a password field to browser password managers', () => {
    render(
      <SystemConfigCard
        loading={false}
        savingConfig={false}
        testingConfig={false}
        canEditConfig
        config={{ OCR_API_KEY: 'secret-value' }}
        tx={(zh) => zh}
        onConfigFieldChange={jest.fn()}
        onTestOcrConfig={jest.fn()}
        onSaveConfig={jest.fn()}
      />
    );

    const input = screen.getByDisplayValue('secret-value');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('data-form-type', 'other');

    fireEvent.click(screen.getByRole('button', { name: 'Show OCR API key' }));
    expect(screen.getByRole('button', { name: 'Hide OCR API key' })).toBeInTheDocument();
  });
});
