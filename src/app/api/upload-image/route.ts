import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const DEFAULT_UPLOAD_DIR = '/app/upload/images';
const PUBLIC_UPLOAD_PREFIX = '/upload/images/';

function resolveImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic') return 'image/heic';
  if (ext === '.heif') return 'image/heif';
  return 'application/octet-stream';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get('path') || '';
    if (!rawPath.startsWith(PUBLIC_UPLOAD_PREFIX)) {
      return NextResponse.json({ success: false, error: '无效图片路径' }, { status: 400 });
    }

    const relativePath = rawPath.slice(PUBLIC_UPLOAD_PREFIX.length);
    if (!relativePath || relativePath.includes('..')) {
      return NextResponse.json({ success: false, error: '无效图片路径' }, { status: 400 });
    }

    const uploadDir = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
    const absolutePath = path.join(uploadDir, relativePath);
    const content = await readFile(absolutePath);

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': resolveImageMimeType(absolutePath),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Read upload image error:', error);
    return NextResponse.json({ success: false, error: '图片读取失败' }, { status: 404 });
  }
}

