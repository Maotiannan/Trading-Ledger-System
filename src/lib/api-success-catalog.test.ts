import { translateApiSuccessMessage } from '@/lib/api-success-catalog';

describe('api-success-catalog', () => {
  it('translates exact success messages', () => {
    expect(translateApiSuccessMessage('账单已删除', 'en')).toBe('Invoice deleted');
    expect(translateApiSuccessMessage('Password updated successfully', 'zh')).toBe('密码修改成功');
  });

  it('translates composed success messages', () => {
    expect(
      translateApiSuccessMessage('账单已保存，部分订单已合并: IB-01；请修复客户信息', 'en'),
    ).toBe('Invoice saved, Merged orders: IB-01; please fix customer information');
  });
});
