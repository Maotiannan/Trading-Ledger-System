'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { apiCall } from '@/components/workspace/shared';

export function useWorkspaceAuth() {
  const { user, setUser } = useStore();
  // A persisted user lets the workspace render while the server revalidates the session.
  // Every API route still performs its own authorization check.
  const [initialized, setInitialized] = useState(() => Boolean(user));

  useEffect(() => {
    if (user) setInitialized(true);
  }, [user]);

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
