'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { LoginPage } from '@/components/workspace/chrome';
import { getWorkspacePath } from '@/components/workspace/routes';
import { useWorkspaceAuth } from '@/components/workspace/hooks';

export default function HomePage() {
  const router = useRouter();
  const { initialized, user } = useWorkspaceAuth();

  useEffect(() => {
    if (initialized && user) {
      router.replace(getWorkspacePath('dashboard'));
    }
  }, [initialized, router, user]);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}
