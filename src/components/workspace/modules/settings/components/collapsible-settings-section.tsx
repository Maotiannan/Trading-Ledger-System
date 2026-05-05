'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';

type CollapsibleSettingsSectionProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function CollapsibleSettingsSection({
  title,
  description,
  defaultOpen = false,
  children,
}: CollapsibleSettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left"
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}
