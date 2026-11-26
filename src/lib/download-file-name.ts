export function downloadFileName(disposition: string, fallback: string): string {
  const extended = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
  const encoded = (extended?.[1] || extended?.[2] || '').trim();
  let name = '';
  if (/^UTF-8'/i.test(encoded)) {
    try { name = decodeURIComponent(encoded.replace(/^UTF-8'[^']*'/i, '')); } catch { /* Use the safe fallback below. */ }
  }
  if (!name) {
    const plain = /(?:^|;)\s*filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
    name = (plain?.[1] || plain?.[2] || '').trim();
  }
  return (name || fallback).replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '_');
}
