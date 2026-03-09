'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { apiCall } from '@/components/workspace/shared';

export function useWorkspaceAuth() {
  const { user, setUser } = useStore();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkAuth = async () => {
      try {
        const result = await apiCall('auth', {
          method: 'POST',
          body: JSON.stringify({ action: 'me' }),
        });
        if (cancelled) return;
        if (result.success && result.data) {
          setUser(result.data);
        } else {
          setUser(null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setInitialized(true);
      }
    };

    void checkAuth();

    return () => {
      cancelled = true;
    };
  }, [setUser]);

  return { initialized, user };
}
