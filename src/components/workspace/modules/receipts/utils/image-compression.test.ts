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

    const toBlob = jest
      .fn()
      .mockImplementationOnce((callback: BlobCallback) => callback(new Blob([new Uint8Array(2_100_000)], { type: 'image/jpeg' })))
      .mockImplementationOnce((callback: BlobCallback) => callback(new Blob([new Uint8Array(1_700_000)], { type: 'image/jpeg' })))
      .mockImplementationOnce((callback: BlobCallback) => callback(new Blob([new Uint8Array(1_200_000)], { type: 'image/jpeg' })));

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
  });
});
