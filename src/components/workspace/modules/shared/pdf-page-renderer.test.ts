import { mountPdfPages } from './pdf-page-renderer';

test('renders the first page immediately and later pages only near the viewport', async () => {
  let callback: IntersectionObserverCallback;
  const disconnect = jest.fn();
  const unobserve = jest.fn();
  const observe = jest.fn();
  const original = global.IntersectionObserver;
  global.IntersectionObserver = jest.fn().mockImplementation(cb => { callback = cb; return { observe, unobserve, disconnect }; });
  const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
  const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: jest.fn(() => ({ promise: Promise.resolve(), cancel: jest.fn() })), cleanup: jest.fn() };
  const document = { numPages: 3, getPage: jest.fn().mockResolvedValue(page) };
  const container = window.document.createElement('div');
  const root = window.document.createElement('div');
  root.append(container);
  const onError = jest.fn();
  try {
    const renderer = mountPdfPages(document as never, container, root, { page: n => `Page ${n}`, onError });
    await renderer.ready;
    expect(document.getPage.mock.calls).toEqual([[1]]);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(observe).toHaveBeenCalledTimes(2);
    callback!([{ isIntersecting: true, target: container.children[1] }] as never, {} as never);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getPage.mock.calls).toEqual([[1], [2]]);
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    renderer.dispose();
    callback!([{ isIntersecting: true, target: container.children[2] }] as never, {} as never);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getPage).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  } finally { getContext.mockRestore(); global.IntersectionObserver = original; }
});
