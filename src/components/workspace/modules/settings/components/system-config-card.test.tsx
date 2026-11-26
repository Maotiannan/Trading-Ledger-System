'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import { SystemConfigCard } from './system-config-card';

describe('SystemConfigCard', () => {
  it('tests only saved OCR settings and never offers retired SWIFT thresholds', () => {
    const onTestOcrConfig = jest.fn();
    const props = { loading: false, savingConfig: false, testingConfig: false, canEditConfig: true,
      config: {}, tx: (_zh: string, en: string) => en, onTestOcrConfig,
      onConfigFieldChange: jest.fn(), onSaveConfig: jest.fn() };
    const { rerender } = render(<SystemConfigCard {...props} ocrConfigDirty />);
    const testButton = () => screen.getByRole('button', { name: 'Test saved OCR configuration' });
    expect(testButton()).toBeDisabled();
    fireEvent.click(testButton());
    expect(onTestOcrConfig).not.toHaveBeenCalled();
    expect(screen.queryByText(/SWIFT_(WARNING|REJECT)_TOLERANCE/)).not.toBeInTheDocument();
    expect(screen.getByText('SWIFT_MAX_FEE_PER_COPY')).toBeInTheDocument();
    rerender(<SystemConfigCard {...props} ocrConfigDirty={false} />);
    fireEvent.click(testButton());
    expect(onTestOcrConfig).toHaveBeenCalledTimes(1);
  });

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
