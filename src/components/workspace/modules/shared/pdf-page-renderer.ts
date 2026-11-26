import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

export function mountPdfPages(
  document: PDFDocumentProxy,
  container: HTMLDivElement,
  scrollRoot: HTMLDivElement,
  labels: { page: (number: number) => string; onError: (error: unknown) => void },
) {
  let disposed = false;
  let observer: IntersectionObserver | null = null;
  const tasks = new Set<RenderTask>();
  const queued = new Set<number>();
  let queue = Promise.resolve();
  const render = async (number: number, shell: HTMLDivElement, existing?: PDFPageProxy) => {
    if (disposed) return;
    const page = existing || await document.getPage(number);
    if (disposed) return;
    const base = page.getViewport({ scale: 1 });
    const width = Math.max(240, Math.min(container.clientWidth || 760, 900));
    const viewport = page.getViewport({ scale: Math.min(Math.max(width / base.width, 0.6), 2) });
    const canvas = window.document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.className = 'max-w-full rounded border bg-white shadow-sm';
    shell.append(canvas);
    const task = page.render({ canvasContext: context, viewport });
    tasks.add(task);
    try {
      await task.promise;
      shell.style.minHeight = '';
    } finally {
      tasks.delete(task);
      page.cleanup();
    }
  };
  const ready = (async () => {
    const first = await document.getPage(1);
    if (disposed) return;
    const viewport = first.getViewport({ scale: 1 });
    const placeholderHeight = Math.max(240, container.clientWidth || 760) * viewport.height / viewport.width + 28;
    const shells: HTMLDivElement[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const shell = window.document.createElement('div');
      shell.className = 'min-w-0 space-y-2';
      shell.dataset.page = String(number);
      shell.style.minHeight = `${placeholderHeight}px`;
      const label = window.document.createElement('div');
      label.className = 'text-xs text-muted-foreground';
      label.textContent = labels.page(number);
      shell.append(label);
      container.append(shell);
      shells.push(shell);
    }
    await render(1, shells[0], first);
    if (disposed) return;
    const enqueue = (number: number, shell: HTMLDivElement) => {
      if (queued.has(number) || disposed) return;
      queued.add(number);
      queue = queue.then(() => render(number, shell)).catch(error => { if (!disposed) labels.onError(error); });
    };
    if (typeof IntersectionObserver === 'undefined') {
      // Older browsers still get every page rather than an inaccessible placeholder.
      shells.slice(1).forEach((shell, index) => enqueue(index + 2, shell));
      return;
    }
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer?.unobserve(entry.target);
        enqueue(Number((entry.target as HTMLDivElement).dataset.page), entry.target as HTMLDivElement);
      });
    }, { root: scrollRoot, rootMargin: '400px 0px' });
    shells.slice(1).forEach(shell => observer!.observe(shell));
  })();
  return {
    ready,
    dispose() { disposed = true; observer?.disconnect(); tasks.forEach(task => task.cancel()); },
  };
}
