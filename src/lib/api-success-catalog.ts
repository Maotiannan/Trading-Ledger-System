import { defaultLocale, isSupportedLocale, type SupportedLocale } from '@/lib/i18n';

const exactSuccessMessages: Record<string, Record<SupportedLocale, string>> = {
  '已退出登录': { zh: '已退出登录', en: 'Signed out' },
  '角色已更新': { zh: '角色已更新', en: 'Role updated' },
  '用户已删除': { zh: '用户已删除', en: 'User deleted' },
  '密码已重置': { zh: '密码已重置', en: 'Password reset' },
  '密码修改成功': { zh: '密码修改成功', en: 'Password updated successfully' },
  '管理员已存在': { zh: '管理员已存在', en: 'Admin already exists' },
  '管理员初始化成功': { zh: '管理员初始化成功', en: 'Admin initialized successfully' },
  '订单客户信息已修复': { zh: '订单客户信息已修复', en: 'Order customer information fixed' },
  '收据客户信息已修复': { zh: '收据客户信息已修复', en: 'Receipt customer information fixed' },
  '客户已删除': { zh: '客户已删除', en: 'Customer deleted' },
  '申请已拒绝': { zh: '申请已拒绝', en: 'Request rejected' },
  '删除成功，状态已回退': { zh: '删除成功，状态已回退', en: 'Deletion completed and status reverted' },
  '账单已保存': { zh: '账单已保存', en: 'Invoice saved' },
  '账单日期已更新': { zh: '账单日期已更新', en: 'Invoice dates updated' },
  '订单已删除': { zh: '订单已删除', en: 'Order deleted' },
  '账单已删除': { zh: '账单已删除', en: 'Invoice deleted' },
  '收据已直接创建': { zh: '收据已直接创建', en: 'Receipt created directly' },
  '付款明细已直接创建': { zh: '付款明细已直接创建', en: 'Payment detail created directly' },
  'SWIFT已直接创建': { zh: 'SWIFT已直接创建', en: 'SWIFT created directly' },
  '错误SWIFT记录已删除': { zh: '错误SWIFT记录已删除', en: 'Error SWIFT record deleted' },
  'SWIFT已删除，状态已回退': { zh: 'SWIFT已删除，状态已回退', en: 'SWIFT deleted and status reverted' },
  '请修复客户信息': { zh: '请修复客户信息', en: 'Please fix customer information' },
  '配置已更新': { zh: '配置已更新', en: 'Configuration updated' },
  '无变更': { zh: '无变更', en: 'No changes' },
  'OCR配置连通成功': { zh: 'OCR配置连通成功', en: 'OCR configuration test passed' },
  'OCR配置已连通，但模型不可用': {
    zh: 'OCR配置已连通，但模型不可用',
    en: 'OCR configuration is reachable, but the model is unavailable',
  },
  '订单已更新': { zh: '订单已更新', en: 'Order updated' },
  '订单已添加': { zh: '订单已添加', en: 'Order added' },
  '订单已合并': { zh: '订单已合并', en: 'Order merged' },
  '业务数据已清空（系统配置/用户数据保留）': {
    zh: '业务数据已清空（系统配置/用户数据保留）',
    en: 'Business data purged (system settings and user data preserved)',
  },
};

const containsSuccessMessages: Array<[string, Record<SupportedLocale, string>]> = [
  ['账单已保存，', { zh: '账单已保存，', en: 'Invoice saved, ' }],
  ['导入完成：成功 ', { zh: '导入完成：成功 ', en: 'Import completed: ' }],
  [' 个账单，失败 ', { zh: ' 个账单，失败 ', en: ' invoices succeeded, ' }],
  [' 行', { zh: ' 行', en: ' rows' }],
  ['导入完成：新增 ', { zh: '导入完成：新增 ', en: 'Import completed: created ' }],
  ['，更新 ', { zh: '，更新 ', en: ', updated ' }],
  ['，无变更 ', { zh: '，无变更 ', en: ', unchanged ' }],
  ['，失败 ', { zh: '，失败 ', en: ', failed ' }],
  ['部分订单已合并: ', { zh: '部分订单已合并: ', en: 'Merged orders: ' }],
  ['；请修复客户信息', { zh: '；请修复客户信息', en: '; please fix customer information' }],
  ['冲突处理完成（当前可见范围）：人工合并 ', {
    zh: '冲突处理完成（当前可见范围）：人工合并 ',
    en: 'Conflict handling completed (visible scope): manually merged ',
  }],
  ['重新匹配完成（当前可见范围）：合并重复订单 ', {
    zh: '重新匹配完成（当前可见范围）：合并重复订单 ',
    en: 'Rematch completed (visible scope): duplicate orders merged ',
  }],
  ['，自动合并 ', { zh: '，自动合并 ', en: ', auto-merged ' }],
  ['，组合合并 ', { zh: '，组合合并 ', en: ', grouped merged ' }],
  ['，补匹配收据 ', { zh: '，补匹配收据 ', en: ', receipts matched ' }],
  ['，同步客户 ', { zh: '，同步客户 ', en: ', customers synced ' }],
  ['，清理空账单 ', { zh: '，清理空账单 ', en: ', empty invoices removed ' }],
  ['，清理空订单 ', { zh: '，清理空订单 ', en: ', zero-amount orders removed ' }],
  ['成功转移 $', { zh: '成功转移 $', en: 'Transferred $' }],
  [' 到订单 ', { zh: ' 到订单 ', en: ' to order ' }],
  ['已清空账号 ', { zh: '已清空账号 ', en: 'Purged branch business data for account ' }],
  [' 分支业务数据（系统配置/用户配置保留）', {
    zh: ' 分支业务数据（系统配置/用户配置保留）',
    en: ' (system settings and user configuration preserved)',
  }],
];

const reverseLookup = new Map<string, Record<SupportedLocale, string>>();
for (const value of Object.values(exactSuccessMessages)) {
  reverseLookup.set(value.zh, value);
  reverseLookup.set(value.en, value);
}

export function normalizeApiSuccessLocale(locale?: string | null): SupportedLocale {
  if (isSupportedLocale(locale)) return locale;
  return defaultLocale;
}

export function translateApiSuccessMessage(raw: string, locale: SupportedLocale): string {
  if (!raw) return raw;

  const exact = reverseLookup.get(raw);
  if (exact) {
    return exact[locale];
  }

  let translated = raw;
  for (const [needle, replacements] of containsSuccessMessages) {
    if (translated.includes(needle)) {
      translated = translated.replaceAll(needle, replacements[locale]);
    }
  }
  return translated;
}
