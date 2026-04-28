export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(?:;(base64))?,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid data URL');
  }

  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';

  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }

  return new Blob([decodeURIComponent(payload)], { type: mime });
}
