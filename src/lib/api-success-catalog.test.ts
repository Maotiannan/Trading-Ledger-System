import { translateApiSuccessMessage } from '@/lib/api-success-catalog';

describe('api-success-catalog', () => {
  it('translates exact success messages', () => {
    expect(translateApiSuccessMessage('账单已删除', 'en')).toBe('Invoice deleted');
    expect(translateApiSuccessMessage('Password updated successfully', 'zh')).toBe('密码修改成功');
    expect(translateApiSuccessMessage('收据修改申请已提交，等待管理员同意', 'en'))
      .toBe('Receipt edit request submitted. Waiting for administrator approval.');
    expect(translateApiSuccessMessage('修改已完成', 'en')).toBe('Update completed.');
    expect(translateApiSuccessMessage('余额转移已撤销', 'en')).toBe('Balance transfer reversed.');
  });

  it('translates composed success messages', () => {
    expect(
      translateApiSuccessMessage('账单已保存，部分订单已合并: IB-01；请修复客户信息', 'en'),
    ).toBe('Invoice saved, Merged orders: IB-01; please fix customer information');
  });

  it('translates batch processing and transfer success messages', () => {
    expect(
      translateApiSuccessMessage('导入完成：新增 2，更新 1，无变更 0，失败 3 行', 'en'),
    ).toBe('Import completed: created 2, updated 1, unchanged 0, failed 3 rows');
    expect(
      translateApiSuccessMessage('成功转移 $15.50 到订单 IB-01', 'en'),
    ).toBe('Transferred $15.50 to order IB-01');
  });

  it('translates rematch and OCR success messages', () => {
    expect(
      translateApiSuccessMessage(
        '重新匹配完成（当前可见范围）：合并重复订单 1，组合合并 2，补匹配收据 3，同步客户 4，清理空账单 5，清理空订单 6',
        'en',
      ),
    ).toBe('Rematch completed (visible scope): duplicate orders merged 1, grouped merged 2, receipts matched 3, customers synced 4, empty invoices removed 5, zero-amount orders removed 6');
    expect(translateApiSuccessMessage('OCR配置连通成功', 'en')).toBe('OCR configuration test passed');
  });

  it('translates user query and settings export summaries', () => {
    expect(
      translateApiSuccessMessage('用户列表已加载，共 3 个账号', 'en'),
    ).toBe('User list loaded: 3 users');
    expect(
      translateApiSuccessMessage('可选上级账户已加载，共 2 个候选账号', 'en'),
    ).toBe('Parent account options loaded: 2 parent options');
    expect(
      translateApiSuccessMessage('配置审计导出完成：已导出 88 条（服务端上限 5000，结果已截断）', 'en'),
    ).toBe('Configuration audit export completed: exported 88 rows (server cap 5000, truncated)');
    expect(
      translateApiSuccessMessage('配置审计导出历史已加载，共 5 条记录', 'en'),
    ).toBe('Configuration audit export history loaded: 5 entries');
    expect(
      translateApiSuccessMessage('客户列表已加载，共 12 个客户', 'en'),
    ).toBe('Customer list loaded: 12 customers');
    expect(
      translateApiSuccessMessage('客户归属候选已加载，共 3 个账号', 'en'),
    ).toBe('Customer owner options loaded: 3 accounts');
    expect(
      translateApiSuccessMessage('账单列表已加载，共 7 个账单', 'en'),
    ).toBe('Invoice list loaded: 7 invoices');
  });

  it('translates email management success and dynamic count messages', () => {
    expect(translateApiSuccessMessage('邮件任务已取消', 'en')).toBe('Email task cancelled');
    expect(translateApiSuccessMessage('失败邮件已重新排队', 'en')).toBe('Failed email queued for retry');
    expect(translateApiSuccessMessage('更正邮件任务已创建，请审核后发送', 'en'))
      .toBe('Correction email task created. Review it before sending.');
    expect(translateApiSuccessMessage('已批准 3 个邮件任务，等待发送', 'en'))
      .toBe('Approved 3 email tasks and queued them for delivery');
    expect(translateApiSuccessMessage('邮件任务已加载，共 12 条', 'en'))
      .toBe('Email tasks loaded: 12');
  });
});
