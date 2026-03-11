'use client';

import { APP_VERSION } from '@/lib/app-version';

export function AppVersionFooter() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-40 text-center">
      <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] text-gray-500 shadow-sm backdrop-blur dark:bg-gray-900/80 dark:text-gray-400">
        {APP_VERSION}
      </span>
    </div>
  );
}
