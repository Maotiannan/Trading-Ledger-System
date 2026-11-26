import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';

// Call only after authentication and resource visibility checks, including 304s.
export async function privateFileResponse(
  request: Request,
  filePath: string,
  options: { contentType: string; disposition?: string; maxAgeSeconds?: number },
): Promise<NextResponse> {
  const file = await open(filePath, 'r');
  try {
    const stats = await file.stat();
    const modified = stats.mtime.toUTCString();
    const etag = `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}-${stats.ctimeMs.toString(16)}"`;
    const headers = new Headers({
      'Content-Type': options.contentType,
      'Cache-Control': options.maxAgeSeconds ? `private, max-age=${options.maxAgeSeconds}` : 'private, no-cache',
      Vary: 'Cookie',
      ETag: etag,
      'Last-Modified': modified,
      'Accept-Ranges': 'bytes',
    });
    if (options.disposition) headers.set('Content-Disposition', options.disposition);
    const noneMatch = request.headers.get('if-none-match');
    const modifiedSince = request.headers.get('if-modified-since');
    const unchanged = noneMatch
      ? noneMatch.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
      : Boolean(modifiedSince && Date.parse(modifiedSince) >= Math.floor(stats.mtimeMs / 1000) * 1000);
    if (unchanged) {
      await file.close();
      return new NextResponse(null, { status: 304, headers });
    }
    let start = 0;
    let end = stats.size - 1;
    let partial = false;
    const range = request.headers.get('range');
    const ifRange = request.headers.get('if-range');
    // A weak ETag cannot validate If-Range; an exact Last-Modified date can.
    const match = request.method !== 'HEAD' && (!ifRange || ifRange === modified)
      ? /^bytes=(\d*)-(\d*)$/.exec(range || '')
      : null;
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, stats.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stats.size) {
        await file.close();
        headers.set('Content-Range', `bytes */${stats.size}`);
        return new NextResponse(null, { status: 416, headers });
      }
      partial = true;
      headers.set('Content-Range', `bytes ${start}-${end}/${stats.size}`);
    }
    headers.set('Content-Length', String(partial ? end - start + 1 : stats.size));
    if (request.method === 'HEAD' || stats.size === 0) {
      await file.close();
      return new NextResponse(null, { status: 200, headers });
    }
    // The stream owns the handle and closes it on completion or cancellation.
    const stream = file.createReadStream(partial ? { start, end } : {});
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: partial ? 206 : 200, headers });
  } catch (error) {
    await file.close().catch(() => undefined);
    throw error;
  }
}
