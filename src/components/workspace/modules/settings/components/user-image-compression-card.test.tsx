'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import { UserImageCompressionCard } from './user-image-compression-card';
import { useSettingsForms } from '../hooks/use-settings-forms';
import type { UserImageCompressionPreferenceDraft } from '../types';

describe('UserImageCompressionCard', () => {
  const tx = (zh: string, _en: string) => zh;
  const preferences: UserImageCompressionPreferenceDraft = {
    imageCompressionEnabled: true,
    imageCompressionQualityFloor: '0.3',
    ocrTargetMaxKb: '500',
  };

  it('renders current user compression preferences and emits field updates', () => {
    const onPreferenceFieldChange = jest.fn();
    const onSavePreferences = jest.fn();

    render(
      <UserImageCompressionCard
        loading={false}
        saving={false}
        preferences={preferences}
        tx={tx}
        onPreferenceFieldChange={onPreferenceFieldChange}
        onSavePreferences={onSavePreferences}
      />
    );

    expect(screen.getByText('图片压缩偏好')).toBeInTheDocument();
    expect(screen.getByLabelText('启用图片压缩')).toBeChecked();
    expect(screen.getByLabelText('压缩质量下限')).toHaveDisplayValue('0.3');
    expect(screen.getByLabelText('OCR 目标大小（KB）')).toHaveDisplayValue('500');

    fireEvent.click(screen.getByLabelText('启用图片压缩'));
    expect(onPreferenceFieldChange).toHaveBeenCalledWith('imageCompressionEnabled', false);

    fireEvent.change(screen.getByLabelText('压缩质量下限'), { target: { value: '0.45' } });
    expect(onPreferenceFieldChange).toHaveBeenCalledWith('imageCompressionQualityFloor', '0.45');

    fireEvent.change(screen.getByLabelText('OCR 目标大小（KB）'), { target: { value: '640' } });
    expect(onPreferenceFieldChange).toHaveBeenCalledWith('ocrTargetMaxKb', '640');

    fireEvent.click(screen.getByRole('button', { name: '保存个人偏好' }));
    expect(onSavePreferences).toHaveBeenCalledTimes(1);
  });

  it('keeps user preferences visible while disabling edits during loading or save', () => {
    render(
      <UserImageCompressionCard
        loading={true}
        saving={true}
        preferences={preferences}
        tx={tx}
        onPreferenceFieldChange={jest.fn()}
        onSavePreferences={jest.fn()}
      />
    );

    expect(screen.getByLabelText('启用图片压缩')).toBeDisabled();
    expect(screen.getByLabelText('压缩质量下限')).toBeDisabled();
    expect(screen.getByLabelText('OCR 目标大小（KB）')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存个人偏好' })).toBeDisabled();
  });

  it('preserves intermediate numeric text while the user is editing', () => {
    const Harness = () => {
      const { userPreferences, updateUserPreferenceField } = useSettingsForms();

      return (
        <UserImageCompressionCard
          loading={false}
          saving={false}
          preferences={userPreferences}
          tx={tx}
          onPreferenceFieldChange={updateUserPreferenceField}
          onSavePreferences={jest.fn()}
        />
      );
    };

    render(<Harness />);

    const qualityInput = screen.getByLabelText('压缩质量下限') as HTMLInputElement;
    const ocrInput = screen.getByLabelText('OCR 目标大小（KB）') as HTMLInputElement;

    fireEvent.change(qualityInput, { target: { value: '' } });
    expect(qualityInput.value).toBe('');

    fireEvent.change(qualityInput, { target: { value: '0.' } });
    expect(qualityInput.value).toBe('0.');

    fireEvent.change(ocrInput, { target: { value: '' } });
    expect(ocrInput.value).toBe('');
  });
});
