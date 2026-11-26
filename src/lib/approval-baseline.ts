import { createApiError } from '@/lib/api-error';

export type ApprovalDifference = { field: string; known: boolean; before: unknown; requested: unknown; current: unknown };

function comparable(value: unknown): string {
  // Detail items have no persistent line position. Preserve duplicates, not the database's scan order.
  if (Array.isArray(value)) return JSON.stringify(value.map(comparable).sort());
  if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, comparable(v)]));
  return JSON.stringify(value);
}

export function checkedApprovalPatch<T extends Record<string, unknown>>(current: T, before: unknown, after: unknown, normalize: (value: T) => T): T {
  const base = before && typeof before === 'object' && !Array.isArray(before) ? before as Record<string, unknown> : {};
  const wanted = after && typeof after === 'object' && !Array.isArray(after) ? after as Record<string, unknown> : {};
  if (!Object.keys(current).some(key => Object.hasOwn(wanted, key))) {
    throw createApiError({ code: 'APPROVAL_BASELINE_CONFLICT', status: 409, message: '申请内容不完整，请拒绝后重新申请。' });
  }
  // An old request may predate a field. Omission is not an instruction to clear it.
  const editable = Object.keys(current).filter(key => Object.hasOwn(wanted, key));
  const patch = normalize({ ...current, ...Object.fromEntries(editable.map(key => [key, wanted[key]])) });
  const fields: ApprovalDifference[] = [];
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(wanted, key)) continue;
    const known = Object.hasOwn(base, key);
    if (comparable(known ? base[key] : patch[key]) !== comparable(current[key])) {
      fields.push({ field: key, known, before: known ? base[key] : null, requested: patch[key], current: current[key] });
    }
  }
  if (fields.length) throw createApiError({ code: 'APPROVAL_BASELINE_CONFLICT', status: 409, message: '原单已变更；当前值已保留。请拒绝旧申请，按最新信息重新提交。', detail: { fields } });
  return patch;
}
