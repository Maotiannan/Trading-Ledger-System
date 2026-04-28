'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ReceiptGeneratorLayoutData } from '@/lib/receipt-generator-layout';
import { RECEIPT_TEMPLATE_ASSETS } from './template-assets';
import {
  RECEIPT_TEMPLATE_CANVAS,
  RECEIPT_TEMPLATE_HEADER_GRID,
  RECEIPT_TEMPLATE_LOGO_BLOCKS,
  RECEIPT_TEMPLATE_SIGNATURE_SLOTS,
  RECEIPT_TEMPLATE_TEXT_REGIONS,
  RECEIPT_TEMPLATE_WATERMARK,
} from './template-geometry';

export type ReceiptCanvasHandle = {
  exportBlob: () => Promise<Blob>;
};

type ReceiptCanvasProps = {
  layout: ReceiptGeneratorLayoutData;
  receiverSignature: string | null;
  payerSignature: string | null;
  className?: string;
};

const TEMPLATE_COMPANY_NAME = 'DMD MERCERIE';
const TEMPLATE_COMPANY_ADDRESS = [
  'Madina Niger, Avaria, Centre Afia, Boutique No. B - 6.',
  'Tél: Mamadou Dian Diallo: 622 49 12 86, 660 57 57 32.',
  'Email: grandtobusiness@gmail.com',
] as const;
const TEMPLATE_FRAIS_LABEL = 'Paid';
const TEMPLATE_RECEIPT_NUMBER_COLOR = '#e05a00';
const TEMPLATE_SIGNATURE_LINE_COLOR = '#555';

function mmToPx(mm: number) {
  return (mm * 96) / 25.4;
}

function ptToPx(pt: number) {
  return (pt * 96) / 72;
}

const RECEIPT_META_PHONE_LINE_HEIGHT = Math.ceil(ptToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt) * 1.35);

function formatTemplateMoney(value: number) {
  const num = Number(value) || 0;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

async function loadImage(dataUrl: string | null): Promise<HTMLImageElement | null> {
  if (!dataUrl) return null;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function splitLongToken(ctx: CanvasRenderingContext2D, token: string, maxWidth: number) {
  if (ctx.measureText(token).width <= maxWidth) {
    return [token];
  }

  const segments: string[] = [];
  let current = '';
  for (const char of token) {
    const next = `${current}${char}`;
    if (current && ctx.measureText(next).width > maxWidth) {
      segments.push(current);
      current = char;
      continue;
    }
    current = next;
  }

  if (current) {
    segments.push(current);
  }

  return segments.length ? segments : [token];
}

function tokenizeForWrap(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized
    .split(/(\s+|\/)/)
    .filter((part) => part.length > 0)
    .flatMap((part) => (part === '/' ? ['/', ' '] : [part]));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const tokens = tokenizeForWrap(text);
  if (tokens.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  const pushLine = (line: string) => {
    const trimmed = line.trimEnd();
    lines.push(trimmed.length > 0 ? trimmed : '');
  };

  for (const token of tokens) {
    const next = `${current}${token}`;
    if (current && ctx.measureText(next).width > maxWidth) {
      pushLine(current);
      current = '';
    }

    if (ctx.measureText(token).width > maxWidth) {
      const chunks = splitLongToken(ctx, token.trim(), maxWidth);
      chunks.forEach((chunk, index) => {
        if (index < chunks.length - 1) {
          pushLine(chunk);
        } else {
          current = chunk;
        }
      });
      continue;
    }

    current += token;
  }

  if (current) {
    pushLine(current);
  }

  return lines.length ? lines : [''];
}

function wrapPhoneText(text: string, maxCharsPerLine: number) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return ['-'];

  const lines: string[] = [];
  let current = '';

  for (const char of normalized) {
    const isBreak = char === ' ';
    const next = `${current}${char}`;
    if (current && next.length > maxCharsPerLine) {
      lines.push(current.trimEnd());
      current = isBreak ? '' : char;
      continue;
    }
    current = next;
  }

  if (current) {
    lines.push(current.trimEnd());
  }

  return lines.length ? lines : ['-'];
}

function splitFixedWidthText(text: string, maxCharsPerLine: number) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return ['-'];

  const lines: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    lines.push(normalized.slice(cursor, cursor + maxCharsPerLine));
    cursor += maxCharsPerLine;
  }

  return lines.length ? lines : ['-'];
}

function cropImageToAlphaBounds(image: HTMLImageElement, padding = 12) {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = Math.max(1, image.naturalWidth || image.width || 1);
  sourceCanvas.height = Math.max(1, image.naturalHeight || image.height || 1);
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext || typeof sourceContext.getImageData !== 'function') {
    return image;
  }

  sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
  let imageData: ImageData;
  try {
    imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  } catch {
    return image;
  }
  const { data, width, height } = imageData;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return image;
  }

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = Math.max(1, cropWidth);
  croppedCanvas.height = Math.max(1, cropHeight);
  const croppedContext = croppedCanvas.getContext('2d');
  if (!croppedContext) {
    return image;
  }

  croppedContext.drawImage(
    sourceCanvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  return croppedCanvas;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const lines = wrapText(ctx, text, maxWidth);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  return lines.length;
}

function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

async function drawReceiptCanvas(
  canvas: HTMLCanvasElement,
  layout: ReceiptGeneratorLayoutData,
  receiverSignature: string | null,
  payerSignature: string | null,
) {
  canvas.width = RECEIPT_TEMPLATE_CANVAS.width;
  canvas.height = RECEIPT_TEMPLATE_CANVAS.height;

  const getContext = () => {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Receipt canvas context unavailable');
    }
    return context;
  };

  let ctx = getContext();

  const [leftLogo, rightLogo, watermark, receiverImage, payerImage] = await Promise.all([
    loadImage(RECEIPT_TEMPLATE_ASSETS.leftLogoDataUrl),
    loadImage(RECEIPT_TEMPLATE_ASSETS.rightLogoDataUrl),
    loadImage(RECEIPT_TEMPLATE_ASSETS.bottomWatermarkDataUrl),
    loadImage(receiverSignature),
    loadImage(payerSignature),
  ]);

  const padding = {
    top: mmToPx(RECEIPT_TEMPLATE_CANVAS.paddingMm.top),
    right: mmToPx(RECEIPT_TEMPLATE_CANVAS.paddingMm.right),
    bottom: mmToPx(RECEIPT_TEMPLATE_CANVAS.paddingMm.bottom),
    left: mmToPx(RECEIPT_TEMPLATE_CANVAS.paddingMm.left),
  };
  const contentWidth = canvas.width - padding.left - padding.right;
  const headerGap = mmToPx(RECEIPT_TEMPLATE_HEADER_GRID.gapMm);
  const headerLeftX = padding.left;
  const headerCenterX = headerLeftX + RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.left + headerGap;
  const headerRightX = headerCenterX + RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.center + headerGap;
  const headerTop = padding.top;
  const metaWidth = RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.right - 8;
  const phoneLineHeight = RECEIPT_META_PHONE_LINE_HEIGHT;
  const fieldLineHeight = 21;
  const amountBoxHeight = 28;
  const detailPaddingX = RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.paddingPx.leftRight;
  const detailPaddingY = RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.paddingPx.topBottom;
  const signatureLabelGap = 18;

  const prepareContext = () => {
    ctx = getContext();
    ctx.strokeStyle = '#1a1a2e';
    ctx.fillStyle = '#1a1a2e';
    ctx.lineWidth = 1.5;
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
  };

  prepareContext();

  ctx.font = `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt}pt Times New Roman`;
  const phoneValue = layout.clientTel || '-';
  const phoneLines = splitFixedWidthText(phoneValue, 14);

  const titleY = 112;
  const amountY = 146;
  const detailY = 190;
  const detailX = padding.left;
  const detailWidth = contentWidth;
  const detailInnerX = detailX + detailPaddingX;
  const detailInnerWidth = detailWidth - detailPaddingX * 2;
  const receiverSignatureSource = receiverImage ? cropImageToAlphaBounds(receiverImage) : null;
  const payerSignatureSource = payerImage ? cropImageToAlphaBounds(payerImage) : null;

  ctx.font = `600 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
  const measureFieldValueWidth = (
    label: string,
    options?: { rightLabel?: string; rightValue?: string },
  ) => {
    ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
    const labelWidth = ctx.measureText(label).width;
    const valueStartX = detailInnerX + labelWidth + 2;

    let rightBlockWidth = 0;
    if (options?.rightLabel && options.rightValue) {
      const rightLabelText = `${options.rightLabel} `;
      const rightLabelWidth = ctx.measureText(rightLabelText).width;
      ctx.font = `700 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
      const rightValueWidth = ctx.measureText(options.rightValue).width;
      rightBlockWidth = rightLabelWidth + rightValueWidth;
    }

    ctx.font = `600 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
    return Math.max(
      40,
      detailX + detailWidth - detailPaddingX - valueStartX - (rightBlockWidth ? rightBlockWidth + 16 : 0),
    );
  };
  const fieldLineCounts = [
    wrapText(ctx, layout.clientName, measureFieldValueWidth('Reçu de M./Mme. :')).length,
    wrapText(ctx, layout.amountInWords, measureFieldValueWidth('La somme de :')).length,
    wrapText(ctx, layout.motif, measureFieldValueWidth('Motif :', { rightLabel: 'Frais :', rightValue: TEMPLATE_FRAIS_LABEL })).length,
    wrapText(ctx, layout.resteAPayer, measureFieldValueWidth('Reste à payer :')).length,
  ];
  let measuredY = detailY + detailPaddingY + 16;
  fieldLineCounts.forEach((lineCount) => {
    const nextLineY = measuredY + Math.max(lineCount, 1) * fieldLineHeight + 2;
    measuredY = nextLineY + 7;
  });
  const receiverBlockY = measuredY + 10;
  const receiverSigWidth = mmToPx(RECEIPT_TEMPLATE_SIGNATURE_SLOTS.receiver.widthMm);
  const receiverSigHeight = mmToPx(RECEIPT_TEMPLATE_SIGNATURE_SLOTS.receiver.heightMm);
  const receiverSigTop = receiverBlockY + signatureLabelGap;
  const receiverTextBottom = receiverBlockY + 20 + ptToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt);
  const receiverSigBottom = receiverSigTop + receiverSigHeight + 1;
  const detailHeight = receiverSigBottom + detailPaddingY + 4 - detailY;

  const payerLabelY = detailY + detailHeight + 12;
  const payerSigWidth = mmToPx(RECEIPT_TEMPLATE_SIGNATURE_SLOTS.payer.widthMm);
  const payerSigHeight = mmToPx(RECEIPT_TEMPLATE_SIGNATURE_SLOTS.payer.heightMm);
  const payerSigTop = payerLabelY + signatureLabelGap;
  const payerBottom = payerSigTop + payerSigHeight + 1;

  const requiredHeight = Math.max(
    RECEIPT_TEMPLATE_CANVAS.height,
    Math.ceil(payerBottom + padding.bottom + 4),
  );

  if (requiredHeight !== canvas.height) {
    canvas.height = requiredHeight;
    prepareContext();
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#1a1a2e';
  ctx.fillStyle = '#1a1a2e';
  ctx.lineWidth = 1.5;
  ctx.textBaseline = 'top';

  if (watermark) {
    const width = (canvas.width * RECEIPT_TEMPLATE_WATERMARK.widthPercent) / 100;
    const height = RECEIPT_TEMPLATE_WATERMARK.heightPx;
    const x = (canvas.width - width) / 2;
    const y = canvas.height - mmToPx(RECEIPT_TEMPLATE_WATERMARK.offsetMm.bottom) - height;
    ctx.save();
    ctx.globalAlpha = RECEIPT_TEMPLATE_WATERMARK.opacityPercent / 100;
    ctx.drawImage(watermark, x, y, width, height);
    ctx.restore();
  }

  if (leftLogo) {
    ctx.drawImage(
      leftLogo,
      headerLeftX,
      headerTop + mmToPx(RECEIPT_TEMPLATE_LOGO_BLOCKS.left.offsetMm.y),
      RECEIPT_TEMPLATE_LOGO_BLOCKS.left.widthPx,
      RECEIPT_TEMPLATE_LOGO_BLOCKS.left.heightPx,
    );
  }

  const companyCenterX = headerCenterX + RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.center / 2 + mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.companyBlock.offsetMm.x);
  const companyTopY = headerTop + mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.companyBlock.offsetMm.y);

  ctx.textAlign = 'center';
  ctx.font = `${RECEIPT_TEMPLATE_TEXT_REGIONS.companyBlock.companyFontPt}pt Times New Roman`;
  ctx.fillText(TEMPLATE_COMPANY_NAME, companyCenterX, companyTopY);
  ctx.font = `${RECEIPT_TEMPLATE_TEXT_REGIONS.companyBlock.addressFontPt}pt Times New Roman`;
  TEMPLATE_COMPANY_ADDRESS.forEach((line, index) => {
    ctx.fillText(line, companyCenterX, companyTopY + 36 + index * 14);
  });

  if (rightLogo) {
    ctx.drawImage(
      rightLogo,
      headerRightX + RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.right - RECEIPT_TEMPLATE_LOGO_BLOCKS.right.widthPx,
      headerTop + mmToPx(RECEIPT_TEMPLATE_LOGO_BLOCKS.right.offsetMm.y),
      RECEIPT_TEMPLATE_LOGO_BLOCKS.right.widthPx,
      RECEIPT_TEMPLATE_LOGO_BLOCKS.right.heightPx,
    );
  }

  const metaRightX = padding.left + contentWidth + mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.offsetMm.x);
  const metaTopY = headerTop + RECEIPT_TEMPLATE_LOGO_BLOCKS.right.heightPx + mmToPx(1) + mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.offsetMm.y);
  ctx.textAlign = 'right';
  ctx.font = `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.numberFontPt}pt Times New Roman`;
  ctx.fillStyle = TEMPLATE_RECEIPT_NUMBER_COLOR;
  ctx.fillText(layout.receiptNo, metaRightX, metaTopY);
  const receiptNoWidth = ctx.measureText(layout.receiptNo).width;
  ctx.font = `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt}pt Times New Roman`;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillText('No: ', metaRightX - receiptNoWidth - 4, metaTopY + 2);
  const dateLine = `Date: ${layout.dateText}`;
  ctx.fillText(dateLine, metaRightX, metaTopY + 26);
  const metaBlockLeftX = metaRightX - ctx.measureText(dateLine).width;
  ctx.textAlign = 'left';
  phoneLines.forEach((line, index) => {
    const renderedLine = index === 0 ? `Tél: ${line}` : line;
    ctx.fillText(renderedLine, metaBlockLeftX, metaTopY + 46 + index * phoneLineHeight);
  });
  ctx.textAlign = 'center';

  ctx.textAlign = 'center';
  ctx.font = `800 ${RECEIPT_TEMPLATE_TEXT_REGIONS.titleBlock.fontPt}pt Times New Roman`;
  ctx.fillText('REÇU DE PAIEMENT', canvas.width / 2, titleY);

  const amountX = padding.left + mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.offsetMm.x);
  const boxGap = mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.boxGapMm);
  const gnfWidth = mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.gnfWidthMm);
  const usdWidth = mmToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.usdWidthMm);
  ctx.textAlign = 'left';
  ctx.font = `700 ${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.labelFontPt}pt Times New Roman`;
  ctx.fillText('GNF', amountX, amountY + 4);
  const amountLabelBoxGap = 10;
  const gnfBoxX = amountX + ctx.measureText('GNF').width + amountLabelBoxGap;
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.borderWidthPx;
  ctx.strokeRect(gnfBoxX, amountY, gnfWidth, amountBoxHeight);

  const usdLabelX = gnfBoxX + gnfWidth + boxGap + 14;
  ctx.strokeStyle = '#1a1a2e';
  ctx.fillText('USD', usdLabelX, amountY + 4);
  const usdBoxX = usdLabelX + ctx.measureText('USD').width + amountLabelBoxGap;
  ctx.strokeRect(usdBoxX, amountY, usdWidth, amountBoxHeight);
  ctx.textAlign = 'center';
  ctx.font = `700 ${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.valueFontPt}pt Times New Roman`;
  ctx.fillText(`$${formatTemplateMoney(layout.usdAmount)}#`, usdBoxX + usdWidth / 2, amountY + 5);

  ctx.textAlign = 'left';
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.borderWidthPx;
  ctx.strokeRect(detailX, detailY, detailWidth, detailHeight);
  const detailInnerY = detailY + detailPaddingY + 16;
  let currentY = detailInnerY;

  const drawField = (label: string, value: string, options?: { rightLabel?: string; rightValue?: string }) => {
    ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
    ctx.fillStyle = '#333333';
    ctx.fillText(label, detailInnerX, currentY);
    const valueStartX = detailInnerX + ctx.measureText(label).width + 2;

    ctx.font = `600 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
    ctx.fillStyle = '#1a1a2e';
    let rightBlockWidth = 0;
    let rightValueWidth = 0;

    if (options?.rightLabel && options.rightValue) {
      ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
      const rightLabelText = `${options.rightLabel} `;
      const rightLabelWidth = ctx.measureText(rightLabelText).width;
      ctx.font = `700 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
      rightValueWidth = ctx.measureText(options.rightValue).width;
      rightBlockWidth = rightLabelWidth + rightValueWidth;
      ctx.font = `600 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
    }

    const availableValueWidth = Math.max(
      40,
      detailX + detailWidth - detailPaddingX - valueStartX - (rightBlockWidth ? rightBlockWidth + 16 : 0),
    );
    const lines = drawWrappedText(ctx, value, valueStartX, currentY, availableValueWidth, fieldLineHeight);

    if (options?.rightLabel && options.rightValue) {
      const rightEdge = detailX + detailWidth - detailPaddingX;
      const rightLabelText = `${options.rightLabel} `;
      const rightStartX = rightEdge - rightBlockWidth;
      ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
      ctx.fillStyle = '#333333';
      ctx.fillText(rightLabelText, rightStartX, currentY);
      ctx.font = `700 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
      ctx.fillStyle = '#1a1a2e';
      ctx.fillText(options.rightValue, rightEdge - rightValueWidth, currentY);
    }

    const lineY = currentY + Math.max(lines, 1) * fieldLineHeight + 2;
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 0.8;
    drawLine(ctx, detailInnerX, lineY, detailX + detailWidth - detailPaddingX, lineY);
    currentY = lineY + 7;
  };

  drawField('Reçu de M./Mme. :', layout.clientName);
  drawField('La somme de :', layout.amountInWords);
  drawField('Motif :', layout.motif, { rightLabel: 'Frais :', rightValue: TEMPLATE_FRAIS_LABEL });
  drawField('Reste à payer :', layout.resteAPayer);

  ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
  ctx.fillStyle = '#333333';
  ctx.fillText('Reçu par :', detailInnerX, receiverBlockY);
  ctx.font = `600 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillText(layout.receivedBy, detailInnerX, receiverBlockY + 20);

  const receiverSigX = detailX + detailWidth - detailPaddingX - receiverSigWidth;
  ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
  ctx.fillStyle = '#333333';
  ctx.textAlign = 'right';
  ctx.fillText('Signature :', receiverSigX + receiverSigWidth, receiverBlockY);
  if (receiverSignatureSource) {
    ctx.drawImage(receiverSignatureSource, receiverSigX, receiverSigTop, receiverSigWidth, receiverSigHeight);
  }
  ctx.strokeStyle = TEMPLATE_SIGNATURE_LINE_COLOR;
  ctx.lineWidth = 1;
  drawLine(
    ctx,
    receiverSigX,
    receiverSigTop + receiverSigHeight,
    receiverSigX + receiverSigWidth,
    receiverSigTop + receiverSigHeight,
  );

  ctx.textAlign = 'left';
  ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
  ctx.fillStyle = '#333333';
  ctx.fillText('Signature du payeur :', detailX, payerLabelY);
  if (payerSignatureSource) {
    ctx.drawImage(payerSignatureSource, detailX, payerSigTop, payerSigWidth, payerSigHeight);
  }
  ctx.strokeStyle = TEMPLATE_SIGNATURE_LINE_COLOR;
  ctx.lineWidth = 1;
  drawLine(ctx, detailX, payerSigTop + payerSigHeight, detailX + payerSigWidth, payerSigTop + payerSigHeight);
}

export const ReceiptCanvas = forwardRef<ReceiptCanvasHandle, ReceiptCanvasProps>(function ReceiptCanvas(
  { layout, receiverSignature, payerSignature, className = '' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    drawReceiptCanvas(canvas, layout, receiverSignature, payerSignature)
      .catch(() => {
        // Preview render failures are surfaced during export/finalize.
      })
      .finally(() => {
        if (!active) return;
      });

    return () => {
      active = false;
    };
  }, [layout, receiverSignature, payerSignature]);

  useImperativeHandle(
    ref,
    () => ({
      exportBlob: async () => {
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('Receipt canvas unavailable');
        }
        await drawReceiptCanvas(canvas, layout, receiverSignature, payerSignature);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) {
          throw new Error('Receipt export failed');
        }
        return blob;
      },
    }),
    [layout, receiverSignature, payerSignature],
  );

  return (
    <div className={`rounded-xl border bg-white p-3 shadow-sm ${className}`}>
      <div className="overflow-x-auto">
        <div
          data-testid="receipt-template-shell"
          className="mx-auto"
          style={{
            width: '100%',
            maxWidth: `${RECEIPT_TEMPLATE_CANVAS.width}px`,
          }}
        >
          <canvas
            ref={canvasRef}
            data-testid="receipt-preview-canvas"
            width={RECEIPT_TEMPLATE_CANVAS.width}
            height={RECEIPT_TEMPLATE_CANVAS.height}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              background: '#fff',
            }}
          />
        </div>
      </div>
    </div>
  );
});
