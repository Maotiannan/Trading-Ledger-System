'use client';
import { useEffect, useState } from 'react';
import { buildCustomerOutstandingStatementSvg } from '@/lib/customer-outstanding-export-image';
import { customerOutstandingStatementLabels } from '@/lib/customer-outstanding-statement-labels';
import type { DashboardCustomerOutstanding } from '@/lib/dashboard-customer-outstanding';
import { formatAppDate } from '@/lib/app-time';
import { useUiText } from '@/components/workspace/shared';

export function OutstandingReminderPreview({ snapshot }: { snapshot: unknown }) {
  const tx = useUiText();
  const [rendered, setRendered] = useState<{ snapshot: unknown; url: string } | null>(null);
  const url = rendered && rendered.snapshot === snapshot ? rendered.url : '';
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    const data = snapshot as { outstanding?: DashboardCustomerOutstanding; statementDate?: string };
    if (data?.outstanding && data.statementDate) {
      void buildCustomerOutstandingStatementSvg({ outstanding: data.outstanding, customerMark: data.outstanding.customerMark,
        statementDate: formatAppDate(data.statementDate), labels: customerOutstandingStatementLabels('fr'),
      }).then(svg => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setRendered({ snapshot, url: objectUrl });
      }).catch(() => { if (active) setRendered(null); });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [snapshot]);
  return url
    // The SVG has variable height; retain its natural dimensions without a fixed crop.
    ? <img src={url} alt={tx('法语客户欠款对账图片预览', 'French outstanding statement preview')} className="h-auto w-full max-w-[720px]" />
    : <p role="status">{tx('对账图片尚未加载，请刷新预览后再审核。', 'Statement image is not loaded. Refresh the preview before approving.')}</p>;
}
