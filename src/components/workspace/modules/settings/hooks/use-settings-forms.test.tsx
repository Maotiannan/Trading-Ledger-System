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
  });
});
