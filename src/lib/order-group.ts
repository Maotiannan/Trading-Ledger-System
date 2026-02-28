export function tokenizeOrderNo(orderNo: string | null | undefined): string[] {
  if (!orderNo) return [];
  const tokens = orderNo
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return tokens;
}

export function deriveOrderGroupKey(orderNo: string | null | undefined): string {
  const tokens = tokenizeOrderNo(orderNo);
  if (tokens.length <= 1) return tokens.join('-');
  return tokens.slice(0, -1).join('-');
}

export function isSameOrderGroup(left: string | null | undefined, right: string | null | undefined): boolean {
  const lk = deriveOrderGroupKey(left);
  const rk = deriveOrderGroupKey(right);
  return lk.length > 0 && lk === rk;
}
