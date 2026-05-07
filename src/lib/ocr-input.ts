import sharp from 'sharp';

const OCR_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png']);
const OCR_MAX_IMAGE_EDGE = 1600;
const OCR_JPEG_QUALITY = 85;

function isPdfUpload(file: File, mime: string, buffer: Buffer): boolean {
  const name = String(file.name || '').toLowerCase();
  const looksLikePdf = mime === 'application/pdf' || name.endsWith('.pdf');
  if (!looksLikePdf) return false;
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return true;
  }
  throw new Error('PDF文件内容与扩展名不匹配');
}

export async function toOcrDataUrl(file: File): Promise<string> {
  const mime = (file.type || '').toLowerCase();
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  if (isPdfUpload(file, mime, buffer)) {
    return `data:application/pdf;base64,${buffer.toString('base64')}`;
  }

  if (OCR_ALLOWED_TYPES.has(mime)) {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const needResize = width > OCR_MAX_IMAGE_EDGE || height > OCR_MAX_IMAGE_EDGE;
    if (!needResize) {
      return `data:${mime};base64,${buffer.toString('base64')}`;
    }

    const resized = await sharp(buffer)
      .resize({
        width: OCR_MAX_IMAGE_EDGE,
        height: OCR_MAX_IMAGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: OCR_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString('base64')}`;
  }

  // GLM OCR only accepts JPG/PNG/PDF. For WEBP/HEIC/HEIF, normalize to PNG.
  const normalizedBuffer = await sharp(buffer)
    .resize({
      width: OCR_MAX_IMAGE_EDGE,
      height: OCR_MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: OCR_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${normalizedBuffer.toString('base64')}`;
}
