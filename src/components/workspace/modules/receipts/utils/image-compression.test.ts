import { compressReceiptDirectImage } from './image-compression';

describe('compressReceiptDirectImage', () => {
  const originalCreateImageBitmap = global.createImageBitmap;
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.createImageBitmap = originalCreateImageBitmap;
    document.createElement = originalCreateElement;
  });

  it('keeps small images unchanged when compression is unnecessary', async () => {
    const file = new File([new Uint8Array(200_000)], 'small.jpg', { type: 'image/jpeg' });

    const result = await compressReceiptDirectImage(file);

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(result.qualityUsed).toBeNull();
  });

  it('compresses large receipt images without dropping quality below 0.30', async () => {
    const file = new File([new Uint8Array(7_000_000)], 'large.jpg', { type: 'image/jpeg' });
    global.createImageBitmap = jest.fn().mockResolvedValue({
      width: 4032,
      height: 3024,
      close: jest.fn(),
    });

    const toBlob = jest.fn((callback: BlobCallback, _type?: string, quality?: number) => {
      const q = Number((quality ?? 0).toFixed(2));
      const size = q >= 0.8
        ? 2_100_000
        : q >= 0.65
          ? 1_550_000
          : 1_200_000;
      callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    });

    document.createElement = jest.fn((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: jest.fn(() => ({ drawImage: jest.fn() })),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement;

    const result = await compressReceiptDirectImage(file);

    expect(result.compressed).toBe(true);
    expect(result.qualityUsed).not.toBeNull();
    expect(result.qualityUsed!).toBeGreaterThanOrEqual(0.30);
    expect(result.file.size).toBeLessThan(file.size);
    expect(result.file.type).toBe('image/jpeg');
    expect(global.createImageBitmap).toHaveBeenCalledWith(file);
    expect(toBlob.mock.calls.length).toBeGreaterThan(2);
  });
});
