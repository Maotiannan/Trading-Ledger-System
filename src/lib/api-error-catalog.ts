import type { ApiErrorCode } from '@/lib/api-error';
import { defaultLocale, isSupportedLocale, type SupportedLocale } from '@/lib/i18n';
import { presentBusinessErrorMessage } from '@/lib/business-error-message-map';

const codeMessages: Record<ApiErrorCode, Record<SupportedLocale, string>> = {
  AUTH_REQUIRED: { zh: '未登录', en: 'Not logged in' },
  INVALID_CREDENTIALS: { zh: '邮箱或密码错误', en: 'Invalid email or password' },
  BAD_REQUEST: { zh: '请求无效', en: 'Invalid request' },
  VALIDATION_ERROR: { zh: '参数校验失败', en: 'Validation failed' },
  FORBIDDEN: { zh: '无权限', en: 'Permission denied' },
  RESOURCE_NOT_FOUND: { zh: '资源不存在', en: 'Resource not found' },
  CONFLICT: { zh: '数据冲突', en: 'Conflict detected' },
  REQUEST_TOO_LARGE: { zh: '请求体过大', en: 'Request body too large' },
  RATE_LIMITED: { zh: '请求过于频繁，请稍后再试', en: 'Too many requests, please retry later' },
  INVALID_FILE_TYPE: { zh: '文件类型无效', en: 'Invalid file type' },
  UPLOAD_ABORTED: { zh: '上传中断，请在更稳定的网络下重试', en: 'Upload interrupted. Please try again on a more stable network.' },
  UPLOAD_IDLE_TIMEOUT: { zh: '上传空闲超时，请检查网络后重试', en: 'Upload stalled for too long. Check your network and retry.' },
  UPLOAD_HARD_TIMEOUT: { zh: '上传耗时过长，请重试', en: 'Upload took too long. Please retry.' },
  INVALID_FILE_PATH: { zh: '文件路径无效', en: 'Invalid file path' },
  FILE_ACCESS_DENIED: { zh: '无权访问文件', en: 'File access denied' },
  FILE_READ_FAILED: { zh: '文件读取失败', en: 'Failed to read file' },
  EMAIL_ALREADY_EXISTS: { zh: '邮箱已存在', en: 'Email already exists' },
  PARENT_NOT_FOUND: { zh: '指定上级不存在', en: 'Parent account does not exist' },
  PARENT_SCOPE_FORBIDDEN: { zh: '无权指定该上级账户', en: 'Cannot assign the selected parent account' },
  ROLE_NOT_ALLOWED: { zh: '角色操作不允许', en: 'Role change is not allowed' },
  SELF_ACTION_FORBIDDEN: { zh: '不能对自己执行该操作', en: 'You cannot operate on yourself' },
  PRIMARY_ADMIN_PROTECTED: { zh: '主管理员受保护', en: 'Primary admin is protected' },
  PASSWORD_TOO_SHORT: { zh: '新密码至少8位', en: 'Password is too short' },
  EXPORT_FORMAT_INVALID: { zh: '导出格式必须是 excel 或 pdf', en: 'Export format must be excel or pdf' },
  REPORT_EXPORT_FAILED: { zh: '报表导出失败', en: 'Report export failed' },
  INIT_DISABLED: { zh: '初始化接口已禁用', en: 'Init route is disabled' },
  INIT_TOKEN_INVALID: { zh: '初始化令牌无效', en: 'Invalid init token' },
  INIT_CONFIG_MISSING: { zh: '缺少初始化管理员配置', en: 'Missing init admin configuration' },
  INIT_PASSWORD_WEAK: { zh: '初始化管理员密码不安全，请配置非默认强密码', en: 'Initial admin password is unsafe. Configure a non-default strong password.' },
  CUSTOMER_DUPLICATE: { zh: '发现重复客户', en: 'Duplicate customer detected' },
  CUSTOMER_SCOPE_FORBIDDEN: { zh: '客户超出当前可操作范围', en: 'Customer is outside your permitted scope' },
  IMPORT_EMPTY_FILE: { zh: '导入文件为空', en: 'Import file is empty' },
  IMPORT_TEMPLATE_INVALID: { zh: '导入模板不正确', en: 'Import template is invalid' },
  NO_IMPORT_ROWS: { zh: '没有可导入的数据行', en: 'No import rows found' },
  INVALID_ACTION: { zh: '未知操作', en: 'Unknown action' },
  INVALID_TARGET_TYPE: { zh: '目标类型无效', en: 'Invalid target type' },
  DELETION_NOT_ALLOWED: { zh: '当前状态不允许删除', en: 'Deletion is not allowed in the current state' },
  DELETION_REQUEST_EXISTS: { zh: '删除申请已存在', en: 'Deletion request already exists' },
  DELETION_REQUEST_NOT_FOUND: { zh: '删除申请不存在', en: 'Deletion request not found' },
  DELETION_REQUEST_ALREADY_PROCESSED: { zh: '删除申请已处理', en: 'Deletion request has already been processed' },
  DELETION_REQUEST_STATE_CHANGED: { zh: '删除申请状态已变化', en: 'Deletion request state has changed' },
  EXCEL_TOKEN_REQUIRED: { zh: '缺少Excel API令牌', en: 'Excel API token is required' },
  EXCEL_TOKEN_INVALID: { zh: 'Excel API令牌无效', en: 'Invalid Excel API token' },
  EXCEL_TOKEN_REVOKED: { zh: 'Excel API令牌已撤销', en: 'Excel API token has been revoked' },
  EXCEL_TOKEN_EXPIRED: { zh: 'Excel API令牌已过期', en: 'Excel API token has expired' },
  EXCEL_TOKEN_NOT_FOUND: { zh: 'Excel API令牌不存在', en: 'Excel API token not found' },
  EXCEL_FIELD_INVALID: { zh: 'Excel字段编号无效', en: 'Invalid Excel field number' },
  EXCEL_ORDER_NOT_FOUND: { zh: 'Excel订单未匹配到客户', en: 'Excel order was not matched to a customer' },
  EXCEL_ORDER_CONFLICT: { zh: 'Excel订单匹配到多个客户', en: 'Excel order matched multiple customers' },
  INTERNAL_ERROR: { zh: '服务器错误', en: 'Server error' },
};

const exactMessageMap: Record<string, Record<SupportedLocale, string>> = {
  '未登录': { zh: '未登录', en: 'Not logged in' },
  '无权限': { zh: '无权限', en: 'Permission denied' },
  '服务器错误': { zh: '服务器错误', en: 'Server error' },
  '邮箱或密码错误': { zh: '邮箱或密码错误', en: 'Invalid email or password' },
  '参数错误': { zh: '参数错误', en: 'Invalid request' },
  '密码错误': { zh: '密码错误', en: 'Incorrect password' },
  '网络错误，请重试': { zh: '网络错误，请重试', en: 'Network error, please retry.' },
  '请求体过大': { zh: '请求体过大', en: 'Request body too large' },
  '请求过于频繁，请稍后再试': { zh: '请求过于频繁，请稍后再试', en: 'Too many requests, please retry later' },
  '上传中断，请在更稳定的网络下重试': { zh: '上传中断，请在更稳定的网络下重试', en: 'Upload interrupted. Please try again on a more stable network.' },
  '上传空闲超时，请检查网络后重试': { zh: '上传空闲超时，请检查网络后重试', en: 'Upload stalled for too long. Check your network and retry.' },
  '上传耗时过长，请重试': { zh: '上传耗时过长，请重试', en: 'Upload took too long. Please retry.' },
  '请上传图片': { zh: '请上传图片', en: 'Please upload an image' },
  '请上传Excel文件': { zh: '请上传Excel文件', en: 'Please upload an Excel file' },
  '缺少必要参数': { zh: '缺少必要参数', en: 'Missing required parameters' },
  '未知操作': { zh: '未知操作', en: 'Unknown action' },
  '创建失败': { zh: '创建失败', en: 'Create failed' },
  '删除失败': { zh: '删除失败', en: 'Delete failed' },
  '导入失败': { zh: '导入失败', en: 'Import failed' },
  '导入成功': { zh: '导入成功', en: 'Import successful' },
  '模板下载失败': { zh: '模板下载失败', en: 'Failed to download template' },
  '申请失败': { zh: '申请失败', en: 'Request failed' },
  '操作失败': { zh: '操作失败', en: 'Operation failed' },
  '保存失败': { zh: '保存失败', en: 'Save failed' },
  '配置已保存': { zh: '配置已保存', en: 'Configuration saved' },
  '密码修改成功': { zh: '密码修改成功', en: 'Password updated successfully' },
  '密码修改失败': { zh: '密码修改失败', en: 'Password update failed' },
  '客户MARK不能为空': { zh: '客户MARK不能为空', en: 'Customer MARK is required' },
  '收据已直接创建': { zh: '收据已直接创建', en: 'Receipt created directly' },
  '付款明细已直接创建': { zh: '付款明细已直接创建', en: 'Payment detail created directly' },
  'SWIFT已直接创建': { zh: 'SWIFT已直接创建', en: 'SWIFT created directly' },
  '当前角色无权生成签名收据': { zh: '当前角色无权生成签名收据', en: 'Your role cannot generate signed receipts' },
  '未找到对应订单，无法生成签名收据': { zh: '未找到对应订单，无法生成签名收据', en: 'Matching order not found for signed receipt generation' },
  '订单未能唯一匹配客户，请先修复客户信息': { zh: '订单未能唯一匹配客户，请先修复客户信息', en: 'The order could not be matched to a unique customer. Fix the customer information first.' },
  '签名收据会话不存在': { zh: '签名收据会话不存在', en: 'Signed receipt session not found' },
  '无权访问该签名收据会话': { zh: '无权访问该签名收据会话', en: 'You do not have access to this signed receipt session' },
  '无权完成该签名收据': { zh: '无权完成该签名收据', en: 'You do not have permission to finalize this signed receipt' },
  '签名或收据图片缺失': { zh: '签名或收据图片缺失', en: 'Signature or receipt image is missing' },
  '签名收据会话已结束或收据状态无效': { zh: '签名收据会话已结束或收据状态无效', en: 'The signed receipt session is closed or the receipt status is invalid' },
  '请先完成 Full Reconcile，再启用增量同步': {
    zh: '请先完成 Full Reconcile，再启用增量同步',
    en: 'Complete Full Reconcile before enabling incremental sync.',
  },
  'Full Reconcile 预览不存在': { zh: 'Full Reconcile 预览不存在', en: 'Full Reconcile preview not found.' },
  'Full Reconcile 预览已过期，请重新预览': {
    zh: 'Full Reconcile 预览已过期，请重新预览',
    en: 'The Full Reconcile preview expired. Generate a new preview.',
  },
  'Full Reconcile 预览已执行，请重新预览': {
    zh: 'Full Reconcile 预览已执行，请重新预览',
    en: 'The Full Reconcile preview was already applied. Generate a new preview.',
  },
  'MU Contract 数据已变化，请重新预览后再执行': {
    zh: 'MU Contract 数据已变化，请重新预览后再执行',
    en: 'MU Contract data changed. Generate and review a new preview.',
  },
  '另一个同步任务正在运行，请稍后重试': {
    zh: '另一个同步任务正在运行，请稍后重试',
    en: 'Another synchronization is running. Try again later.',
  },
  'MU Contract 同步尚未正确配置': {
    zh: 'MU Contract 同步尚未正确配置',
    en: 'MU Contract synchronization is not configured correctly.',
  },
  'MU Contract 同步认证失败': { zh: 'MU Contract 同步认证失败', en: 'MU Contract synchronization authentication failed.' },
  'MU Contract 同步失败，请稍后重试': {
    zh: 'MU Contract 同步失败，请稍后重试',
    en: 'MU Contract synchronization failed. Try again later.',
  },
  '签名未完成的收据不能进入业务流程': { zh: '签名未完成的收据不能进入业务流程', en: 'A receipt with unfinished signatures cannot enter the business workflow' },
  '签名未完成的收据不能进入付款明细流程': { zh: '签名未完成的收据不能进入付款明细流程', en: 'A receipt with unfinished signatures cannot enter the payment-detail workflow' },
  '待签字收据的收据号不能为空': { zh: '待签字收据的收据号不能为空', en: 'A pending signed receipt must have a receipt number.' },
  '待签字收据的ORDER NO不能为空': { zh: '待签字收据的ORDER NO不能为空', en: 'A pending signed receipt must have an ORDER NO.' },
  '待签字收据缺少有效签字会话，无法修改': { zh: '待签字收据缺少有效签字会话，无法修改', en: 'This pending signed receipt has no active signing session and cannot be edited.' },
  '待签字收据的签字状态已变化，请刷新后重试': { zh: '待签字收据的签字状态已变化，请刷新后重试', en: 'The signing status changed. Refresh the receipt and try again.' },
};

const containsMessageMap: Array<[string, string]> = [
  ['，请换一个编号', ', please choose another number'],
  ['收据号', 'Receipt No.'],
  ['请换一个编号', 'Please choose another number'],
  ['只能填写数字', 'can only contain digits'],
  ['自动分配失败', 'automatic allocation failed'],
  ['不能为空', 'cannot be empty'],
  ['不存在', 'does not exist'],
  ['已存在', 'already exists'],
  ['不能小于', 'cannot be lower than'],
  ['不能早于', 'cannot be earlier than'],
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

export function normalizeApiErrorLocale(locale?: string | null): SupportedLocale {
  if (isSupportedLocale(locale)) return locale;
  return defaultLocale;
}

export function translateApiErrorMessage(raw: string, locale: SupportedLocale): string {
  if (!raw) return raw;
  const presented = presentBusinessErrorMessage(raw, locale);
  if (presented !== raw) return presented;
  if (locale === 'zh') return raw;

  if (exactMessageMap[raw]) {
    return exactMessageMap[raw][locale];
  }

  let translated = raw;
  for (const [zhPart, enPart] of containsMessageMap) {
    if (translated.includes(zhPart)) {
      translated = translated.replaceAll(zhPart, enPart);
    }
  }
  return translated;
}

export function translateApiErrorCode(
  code: string | null | undefined,
  fallbackMessage = '',
  locale: SupportedLocale = defaultLocale,
): string {
  if (code && code in codeMessages) {
    return codeMessages[code as ApiErrorCode][locale];
  }
  return translateApiErrorMessage(fallbackMessage, locale);
}
