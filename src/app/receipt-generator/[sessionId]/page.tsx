'use client';

import { useParams } from 'next/navigation';
import { SigningView } from '@/components/workspace/modules/receipts/generator/signing-view';
import { useUiText } from '@/components/workspace/shared';

export default function ReceiptGeneratorSigningPage() {
  const tx = useUiText();
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';

  return <SigningView sessionId={sessionId} tx={tx} />;
}
