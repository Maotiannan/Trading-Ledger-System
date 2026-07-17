import { fireEvent, render, screen } from '@testing-library/react';

import { MuContractSyncSettingsCard } from './mu-contract-sync-settings-card';

const tx = (_zh: string, en: string) => en;

function props(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    saving: false,
    canEdit: true,
    action: null,
    config: {
      MU_CONTRACT_SYNC_ENABLED: 'false',
      MU_CONTRACT_SYNC_INTERVAL_SECONDS: '30',
      MU_CONTRACT_SYNC_BATCH_SIZE: '100',
    },
    status: {
      enabled: false,
      intervalSeconds: 30,
      batchSize: 100,
      initialReconcileCompletedAt: null,
      committedCursor: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      nextEligiblePollAt: null,
      running: false,
      reconcileStatus: 'IDLE',
      unmatchedCount: 0,
      conflictCount: 0,
    },
    preview: null,
    tx,
    onFieldChange: jest.fn(),
    onSave: jest.fn(),
    onRefresh: jest.fn(),
    onSyncNow: jest.fn(),
    onPreviewReconcile: jest.fn(),
    onApplyReconcile: jest.fn(),
    ...overrides,
  };
}

describe('MuContractSyncSettingsCard', () => {
  it('renders approved defaults and initial reconcile gate', () => {
    const input = props();

    render(<MuContractSyncSettingsCard {...input} />);

    expect(screen.getByLabelText('Enabled')).not.toBeChecked();
    expect(screen.getByLabelText('Polling interval (seconds)')).toHaveValue(30);
    expect(screen.getByLabelText('Batch size')).toHaveValue(100);
    expect(screen.getByText('Initial reconcile required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply Reconcile' })).toBeDisabled();
  });

  it('edits only the three audited non-secret settings', () => {
    const onFieldChange = jest.fn();
    const input = props({ onFieldChange });
    render(<MuContractSyncSettingsCard {...input} />);

    fireEvent.click(screen.getByLabelText('Enabled'));
    fireEvent.change(screen.getByLabelText('Polling interval (seconds)'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Batch size'), { target: { value: '250' } });

    expect(onFieldChange).toHaveBeenCalledWith('MU_CONTRACT_SYNC_ENABLED', 'true');
    expect(onFieldChange).toHaveBeenCalledWith('MU_CONTRACT_SYNC_INTERVAL_SECONDS', '45');
    expect(onFieldChange).toHaveBeenCalledWith('MU_CONTRACT_SYNC_BATCH_SIZE', '250');
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/base url/i)).not.toBeInTheDocument();
  });

  it('exposes status actions and renders preview counts before apply', () => {
    const onPreviewReconcile = jest.fn();
    const onApplyReconcile = jest.fn();
    const input = props({
      status: {
        ...props().status,
        enabled: true,
        initialReconcileCompletedAt: '2026-07-18T09:00:00.000Z',
        committedCursor: '1042',
        lastSuccessAt: '2026-07-18T09:10:00.000Z',
        unmatchedCount: 3,
        conflictCount: 2,
      },
      preview: {
        previewId: 'preview-1',
        expiresAt: '2026-07-18T09:20:00.000Z',
        highWatermark: '1042',
        summary: {
          totalSourceRows: 53,
          metadataOnly: 39,
          creates: 14,
          updates: 0,
          inactive: 0,
          unmatched: 0,
          conflicts: 0,
          manualOnlyUntouched: 10,
        },
      },
      onPreviewReconcile,
      onApplyReconcile,
    });

    render(<MuContractSyncSettingsCard {...input} />);

    expect(screen.getByText('39')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Committed cursor: 1042')).toBeInTheDocument();
    expect(screen.getByText('Unmatched: 3')).toBeInTheDocument();
    expect(screen.getByText('Open conflicts: 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Full Reconcile' }));
    expect(onPreviewReconcile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Apply Reconcile' }));
    expect(onApplyReconcile).toHaveBeenCalledTimes(1);
  });

  it('shows a readable error summary without rendering upstream diagnostics', () => {
    const input = props({
      status: {
        ...props().status,
        lastError: 'private upstream stack and token details',
      },
    });

    render(<MuContractSyncSettingsCard {...input} />);

    expect(screen.getByText('The latest synchronization failed. Check the service log.')).toBeInTheDocument();
    expect(screen.queryByText(/private upstream stack/i)).not.toBeInTheDocument();
  });

  it('disables every mutation while an action is running or the account cannot edit', () => {
    const input = props({ canEdit: false, action: 'sync-now' });
    render(<MuContractSyncSettingsCard {...input} />);

    expect(screen.getByLabelText('Enabled')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Sync Settings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Full Reconcile' })).toBeDisabled();
  });
});
