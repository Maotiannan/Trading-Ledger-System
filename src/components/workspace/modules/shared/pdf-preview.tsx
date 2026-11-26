'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { mountPdfPages } from './pdf-page-renderer';

type PdfStatus = 'idle' | 'loading' | 'ready' | 'error';

export type PdfPreviewProps = {
  src: string;
  fileName?: string | null;
  className?: string;
  tx?: (zh: string, en: string) => string;
};

function defaultTx(zh: string) {
  return zh;
}

function dataUrlToBytes(src: string): Uint8Array {
  const base64 = src.split(',')[1] || '';
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isPdfPreviewSource(src: string | null | undefined, fileName?: string | null): boolean {
  const raw = `${src || ''} ${fileName || ''}`;
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })().toLowerCase();
  return decoded.startsWith('data:application/pdf')
    || decoded.includes('application/pdf')
    || /\.pdf(?:$|[?#&\s])/.test(decoded);
}

export function PdfPreview({ src, fileName, className = 'max-h-[70dvh]', tx = defaultTx }: PdfPreviewProps) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PdfStatus>('idle');
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<unknown>; destroy?: () => Promise<void> } | null = null;
    let pdfDocument: PDFDocumentProxy | null = null;
    let renderer: ReturnType<typeof mountPdfPages> | null = null;

    const renderPdf = async () => {
      const pagesContainer = pagesRef.current;
      if (!src || !pagesContainer) return;
      setStatus('loading');
      setError(null);
      setPageCount(0);
      pagesContainer.replaceChildren();

      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();

        const documentSource = src.startsWith('data:application/pdf')
          ? { data: dataUrlToBytes(src) }
          : { url: src, withCredentials: true, disableAutoFetch: true, disableStream: true };
        loadingTask = pdfjs.getDocument(documentSource);
        pdfDocument = await loadingTask.promise as typeof pdfDocument;
        if (cancelled || !pdfDocument) return;

        setPageCount(pdfDocument.numPages);

        renderer = mountPdfPages(pdfDocument, pagesContainer, scrollRef.current!, {
          page: number => tx(`第 ${number} 页`, `Page ${number}`),
          onError: renderError => {
            if (cancelled) return;
            setError(renderError instanceof Error ? renderError.message : String(renderError));
            setStatus('error');
          },
        });
        await renderer.ready;

        if (!cancelled) setStatus('ready');
      } catch (renderError) {
        if (cancelled) return;
        const message = renderError instanceof Error ? renderError.message : String(renderError);
        setError(message || tx('PDF预览失败', 'PDF preview failed'));
        setStatus('error');
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      renderer?.dispose();
      void loadingTask?.destroy?.();

      pagesRef.current?.replaceChildren();
    };
  }, [src, tx]);

  return (
    <div
      ref={scrollRef}
      data-testid="pdf-preview"
      className={`min-h-0 min-w-0 max-w-full touch-pan-y overscroll-contain overflow-x-hidden overflow-y-auto rounded border bg-muted/20 ${className}`}
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="min-w-0 break-all">{fileName || tx('PDF预览', 'PDF preview')}</span>
          {pageCount > 0 && <span className="shrink-0 text-xs text-muted-foreground">({pageCount})</span>}
        </div>
        <Button asChild size="sm" variant="outline" className="h-8 shrink-0">
          <a href={src} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {tx('打开', 'Open')}
          </a>
        </Button>
      </div>
      {status === 'loading' && (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {tx('正在加载PDF预览...', 'Loading PDF preview...')}
        </div>
      )}
      {status === 'error' && (
        <div className="px-4 py-8 text-sm text-destructive">
          {tx('PDF预览失败，可点击打开查看原文件。', 'PDF preview failed. Use Open to view the original file.')}
          {error && <div className="mt-2 text-xs text-muted-foreground">{error}</div>}
        </div>
      )}
      <div ref={pagesRef} className="space-y-4 p-3" />
    </div>
  );
}
