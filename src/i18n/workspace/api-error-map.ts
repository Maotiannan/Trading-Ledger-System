const codeMap: Record<string, string> = {
  BAD_REQUEST: 'Invalid request',
  FORBIDDEN: 'Permission denied',
  RESOURCE_NOT_FOUND: 'Resource not found',
  CONFLICT: 'Conflict detected',
  INVALID_ACTION: 'Unknown action',
  INVALID_TARGET_TYPE: 'Invalid target type',
  DELETION_NOT_ALLOWED: 'Deletion is not allowed in the current state',
  DELETION_REQUEST_EXISTS: 'Deletion request already exists',
  DELETION_REQUEST_NOT_FOUND: 'Deletion request not found',
  DELETION_REQUEST_ALREADY_PROCESSED: 'Deletion request has already been processed',
  DELETION_REQUEST_STATE_CHANGED: 'Deletion request state has changed',
  INTERNAL_ERROR: 'Server error',
};

const exactMap: Record<string, string> = {
  '未登录': 'Not logged in',
  '无权限': 'Permission denied',
  '服务器错误': 'Server error',
  '网络错误，请重试': 'Network error, please retry.',
  '请上传图片': 'Please upload an image',
  '请上传Excel文件': 'Please upload an Excel file',
  '缺少必要参数': 'Missing required parameters',
  '未知操作': 'Unknown action',
  '创建失败': 'Create failed',
  '删除失败': 'Delete failed',
  '导入失败': 'Import failed',
  '导入成功': 'Import successful',
  '模板下载失败': 'Failed to download template',
  '申请失败': 'Request failed',
  '操作失败': 'Operation failed',
  '保存失败': 'Save failed',
  '配置已保存': 'Configuration saved',
  '密码修改成功': 'Password updated successfully',
  '密码修改失败': 'Password update failed',
  '客户MARK不能为空': 'Customer MARK is required',
  '收据已直接创建': 'Receipt created directly',
  '付款明细已直接创建': 'Payment detail created directly',
  'SWIFT已直接创建': 'SWIFT created directly',
};

const containsMap: Array<[string, string]> = [
  ['不能为空', 'cannot be empty'],
  ['不存在', 'does not exist'],
  ['已存在', 'already exists'],
  ['禁止删除', 'deletion is forbidden in current status'],
  ['禁止修改', 'modification is forbidden in current status'],
  ['请修复客户信息', 'Please fix customer information'],
  ['格式错误，应为 YYYY-MM-DD', 'has invalid format, expected YYYY-MM-DD'],
  ['大于等于0的数字', 'a number greater than or equal to 0'],
  ['模板缺少列', 'Template missing columns'],
  ['导入失败', 'Import failed'],
  ['导入完成', 'Import completed'],
  ['OCR', 'OCR'],
];

export function translateApiErrorMessage(raw: string): string {
  if (!raw) return raw;
  if (exactMap[raw]) return exactMap[raw];

  for (const [zhPart, enPart] of containsMap) {
    if (raw.includes(zhPart)) {
      return raw.replace(zhPart, enPart);
    }
  }

  return raw;
}

export function translateApiErrorCode(code?: string | null, fallbackMessage = ''): string {
  if (code && codeMap[code]) return codeMap[code];
  return translateApiErrorMessage(fallbackMessage);
}
