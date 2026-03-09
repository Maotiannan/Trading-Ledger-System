import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { getCurrentUser } from '@/lib/request-auth';
import { db } from '@/lib/db';
import { buildDetailVisibilityWhere, buildReceiptVisibilityWhere, buildSwiftVisibilityWhere, getOwnerVisibleIds } from '@/lib/resource-visibility';

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
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get('path') || '';
    if (!rawPath.startsWith(PUBLIC_UPLOAD_PREFIX)) {
      return NextResponse.json({ success: false, error: '无效图片路径' }, { status: 400 });
    }

    const relativePath = rawPath.slice(PUBLIC_UPLOAD_PREFIX.length);
    if (!relativePath || relativePath.includes('..')) {
      return NextResponse.json({ success: false, error: '无效图片路径' }, { status: 400 });
    }

    const ownerIds = await getOwnerVisibleIds(currentUser);
    const [receipt, detail, swift] = await Promise.all([
      db.receipt.findFirst({
        where: {
          imageUrl: rawPath,
          ...buildReceiptVisibilityWhere(ownerIds),
        },
        select: { id: true },
      }),
      db.detail.findFirst({
        where: {
          imageUrl: rawPath,
          ...buildDetailVisibilityWhere(ownerIds),
        },
        select: { id: true },
      }),
      db.swift.findFirst({
        where: {
          imageUrl: rawPath,
          ...buildSwiftVisibilityWhere(ownerIds),
        },
        select: { id: true },
      }),
    ]);
    if (!receipt && !detail && !swift) {
      return NextResponse.json({ success: false, error: '无权访问该图片' }, { status: 403 });
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
