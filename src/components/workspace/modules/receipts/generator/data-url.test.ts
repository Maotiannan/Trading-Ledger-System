import { dataUrlToBlob } from './data-url';

describe('dataUrlToBlob', () => {
  it('converts a base64 data url into a blob without fetch', async () => {
    const text = 'signed';
    const dataUrl = `data:image/png;base64,${Buffer.from(text, 'utf8').toString('base64')}`;

    const blob = dataUrlToBlob(dataUrl);

    expect(blob.type).toBe('image/png');
    const decoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(decoded).toBe(text);
  });

  it('throws on malformed input', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow('Invalid data URL');
  });
});
