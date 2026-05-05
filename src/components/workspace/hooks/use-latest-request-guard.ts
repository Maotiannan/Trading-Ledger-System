'use client';

import { useCallback, useMemo, useRef } from 'react';

export function useLatestRequestGuard() {
  const tokenRef = useRef(0);

  const nextToken = useCallback(() => {
    tokenRef.current += 1;
    return tokenRef.current;
  }, []);

  const isLatest = useCallback((token: number) => tokenRef.current === token, []);

  return useMemo(() => ({
    nextToken,
    isLatest,
  }), [isLatest, nextToken]);
}
