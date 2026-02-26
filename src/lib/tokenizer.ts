function normalizeOrderNo(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.filter(Boolean)));
}

export function tokenizeOrder(value: string): string[] {
  const normalized = normalizeOrderNo(value);
  if (!normalized) return [];

  const parts = normalized.split(' ');
  const compact = normalized.replace(/\s+/g, '');
  if (compact && !parts.includes(compact)) {
    parts.push(compact);
  }
  return uniqueTokens(parts);
}

export function serializeOrderTokens(value: string): string {
  return JSON.stringify(tokenizeOrder(value));
}

export function parseOrderTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return uniqueTokens(parsed.map((x) => String(x).toLowerCase()));
    }
    return [];
  } catch {
    return [];
  }
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function normalizedLevenshteinSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length));
}

function tokenJaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection++;
  }
  const union = aSet.size + bSet.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function calculateOrderSimilarity(
  inputOrderNo: string,
  candidateOrderNo: string,
  candidateTokens?: string[]
): number {
  const normalizedInput = normalizeOrderNo(inputOrderNo);
  const normalizedCandidate = normalizeOrderNo(candidateOrderNo);
  if (!normalizedInput || !normalizedCandidate) return 0;
  if (normalizedInput === normalizedCandidate) return 1;

  const inputTokens = tokenizeOrder(inputOrderNo);
  const orderTokens = candidateTokens && candidateTokens.length > 0
    ? uniqueTokens(candidateTokens.map((x) => x.toLowerCase()))
    : tokenizeOrder(candidateOrderNo);

  const tokenScore = tokenJaccardSimilarity(inputTokens, orderTokens);
  const textScore = normalizedLevenshteinSimilarity(
    normalizedInput.replace(/\s+/g, ''),
    normalizedCandidate.replace(/\s+/g, '')
  );
  const includeBonus = normalizedCandidate.includes(normalizedInput) ||
    normalizedInput.includes(normalizedCandidate)
    ? 0.1
    : 0;

  return Math.min(1, tokenScore * 0.55 + textScore * 0.45 + includeBonus);
}

export function checkTokenMatch(inputOrderNo: string, candidateOrderNo: string, threshold = 0.65): boolean {
  return calculateOrderSimilarity(inputOrderNo, candidateOrderNo) >= threshold;
}
