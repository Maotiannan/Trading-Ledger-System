import { act, renderHook } from '@testing-library/react';
import { useSettingsForms } from './use-settings-forms';

describe('useSettingsForms', () => {
  it('updates config fields and toggles purge modules', () => {
    const { result } = renderHook(() => useSettingsForms());

    act(() => {
      result.current.updateConfigField('DETAIL_RECEIPT_MATCH_TOLERANCE', '9');
    });
    expect(result.current.config.DETAIL_RECEIPT_MATCH_TOLERANCE).toBe('9');

    act(() => {
      result.current.togglePurgeModule('invoice', true);
    });
    expect(result.current.purgeForm.modules).toEqual(['invoice']);

    act(() => {
      result.current.togglePurgeModule('detail', true);
    });
    expect(result.current.purgeForm.modules).toEqual(expect.arrayContaining(['invoice', 'detail']));

    act(() => {
      result.current.togglePurgeModule('all', true);
    });
    expect(result.current.purgeForm.modules).toEqual(['all']);

    act(() => {
      result.current.togglePurgeModule('all', false);
    });
    expect(result.current.purgeForm.modules).toEqual([]);
  });

  it('updates all user preference fields and removes individual purge modules', () => {
    const { result } = renderHook(() => useSettingsForms());

    act(() => {
      result.current.updateUserPreferenceField('imageCompressionEnabled', false);
      result.current.updateUserPreferenceField('imageCompressionQualityFloor', '0.45');
      result.current.updateUserPreferenceField('ocrTargetMaxKb', '640');
    });

    expect(result.current.userPreferences).toEqual({
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: '0.45',
      ocrTargetMaxKb: '640',
    });

    act(() => {
      result.current.togglePurgeModule('invoice', true);
      result.current.togglePurgeModule('detail', true);
    });
    expect(result.current.purgeForm.modules).toEqual(expect.arrayContaining(['invoice', 'detail']));

    act(() => {
      result.current.togglePurgeModule('invoice', false);
    });
    expect(result.current.purgeForm.modules).toEqual(['detail']);
  });

  it('throws when updating an unsupported user preference field', () => {
    const { result } = renderHook(() => useSettingsForms());

    expect(() => {
      act(() => {
        result.current.updateUserPreferenceField('unsupported' as never, 'value' as never);
      });
    }).toThrow('Unhandled user preference field: unsupported');
  });
});
