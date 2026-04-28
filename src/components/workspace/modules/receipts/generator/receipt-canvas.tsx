'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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

function formatTemplateMoney(value: number) {
  const num = Number(value) || 0;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function styleTranslate(offset: { x?: number; y?: number }) {
  const x = offset.x || 0;
  const y = offset.y || 0;
  return `translate(${x}mm, ${y}mm)`;
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const next = `${current} ${words[index]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[index];
  }

  lines.push(current);
  return lines;
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
  const phoneLineHeight = Math.ceil(ptToPx(RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt) * 1.35);
  const fieldLineHeight = 21;
  const amountBoxHeight = 28;
  const detailPaddingX = RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.paddingPx.leftRight;
  const detailPaddingY = RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.paddingPx.topBottom;
  const labelWidth = 125;
  const rightLabelWidth = 62;
  const signatureLabelGap = 18;

  const prepareContext = () => {
    ctx = getContext();
    ctx.strokeStyle = '#1a1a2e';
    ctx.fillStyle = '#1a1a2e';
    ctx.lineWidth = 1.5;
    ctx.textBaseline = 'top';
    return ctx;
  };

  prepareContext();

  ctx.font = `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt}pt Times New Roman`;
  const phoneLines = wrapText(ctx, `Tél: ${layout.clientTel || '-'}`, metaWidth);
  const extraHeaderOffset = Math.max(0, phoneLines.length - 1) * phoneLineHeight;

  const titleY = 112 + extraHeaderOffset;
  const amountY = 146 + extraHeaderOffset;
  const detailY = 190 + extraHeaderOffset;
  const detailX = padding.left;
  const detailWidth = contentWidth;
  const detailInnerX = detailX + detailPaddingX;
  const detailInnerWidth = detailWidth - detailPaddingX * 2;
  const valueWidth = detailInnerWidth - labelWidth - 12;

  ctx.font = `600 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
  const fieldLineCounts = [
    wrapText(ctx, layout.clientName, valueWidth).length,
    wrapText(ctx, layout.amountInWords, valueWidth).length,
    wrapText(ctx, layout.motif, valueWidth).length,
    wrapText(ctx, layout.resteAPayer, valueWidth).length,
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
  ctx.fillText(`Date: ${layout.dateText}`, metaRightX, metaTopY + 26);
  phoneLines.forEach((line, index) => {
    ctx.fillText(line, metaRightX, metaTopY + 46 + index * phoneLineHeight);
  });

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
  const gnfBoxX = amountX + 32;
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.borderWidthPx;
  ctx.strokeRect(gnfBoxX, amountY, gnfWidth, amountBoxHeight);

  const usdLabelX = gnfBoxX + gnfWidth + boxGap + 10;
  ctx.strokeStyle = '#1a1a2e';
  ctx.fillText('USD', usdLabelX, amountY + 4);
  const usdBoxX = usdLabelX + 34;
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

    ctx.font = `600 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
    ctx.fillStyle = '#1a1a2e';
    const lines = drawWrappedText(ctx, value, detailInnerX + labelWidth, currentY, valueWidth, fieldLineHeight);

    if (options?.rightLabel && options.rightValue) {
      const rightX = detailX + detailWidth - 185;
      ctx.font = `italic ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt Times New Roman`;
      ctx.fillStyle = '#333333';
      ctx.fillText(options.rightLabel, rightX, currentY);
      ctx.font = `700 ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt Times New Roman`;
      ctx.fillStyle = '#1a1a2e';
      drawWrappedText(ctx, options.rightValue, rightX + rightLabelWidth, currentY, 95, fieldLineHeight);
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
  if (receiverImage) {
    ctx.drawImage(receiverImage, receiverSigX, receiverSigTop, receiverSigWidth, receiverSigHeight);
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
  if (payerImage) {
    ctx.drawImage(payerImage, detailX, payerSigTop, payerSigWidth, payerSigHeight);
  }
  ctx.strokeStyle = TEMPLATE_SIGNATURE_LINE_COLOR;
  ctx.lineWidth = 1;
  drawLine(ctx, detailX, payerSigTop + payerSigHeight, detailX + payerSigWidth, payerSigTop + payerSigHeight);
}

function FieldRow({ label, value, trailing }: { label: string; value: string; trailing?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '2mm',
        borderBottom: '0.8px dotted #aaa',
        paddingBottom: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldGapPx - 1}px`,
        fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt`,
      }}
    >
      <span
        style={{
          whiteSpace: 'nowrap',
          fontStyle: 'italic',
          fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt`,
          color: '#333',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ fontWeight: 600, flex: 1 }}>{value}</span>
      {trailing}
    </div>
  );
}

function SignatureSlot({
  dataTestId,
  alt,
  src,
  widthMm,
  heightMm,
}: {
  dataTestId: string;
  alt: string;
  src: string | null;
  widthMm: number;
  heightMm: number;
}) {
  return (
    <div
      data-testid={dataTestId}
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        position: 'relative',
        cursor: 'pointer',
        background: 'transparent',
        borderBottom: `1px solid ${TEMPLATE_SIGNATURE_LINE_COLOR}`,
        overflow: 'visible',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {src ? (
        <img
          alt={alt}
          src={src}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
      ) : null}
    </div>
  );
}

export const ReceiptCanvas = forwardRef<ReceiptCanvasHandle, ReceiptCanvasProps>(function ReceiptCanvas(
  { layout, receiverSignature, payerSignature, className = '' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [mobileScale, setMobileScale] = useState(1);
  const [shellHeight, setShellHeight] = useState<number>(RECEIPT_TEMPLATE_CANVAS.height);
  const usdAmountText = `$${formatTemplateMoney(layout.usdAmount)}#`;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const shell = shellRef.current;
    if (!shell) return undefined;

    const updateScale = () => {
      const viewportWidth = window.innerWidth;
      const nextScale = viewportWidth <= 768
        ? Math.min(1, Math.max(0.5, (viewportWidth - 32) / RECEIPT_TEMPLATE_CANVAS.width))
        : 1;
      setMobileScale(nextScale);
      setShellHeight(shell.offsetHeight);
    };

    updateScale();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          updateScale();
        });
    observer?.observe(shell);
    window.addEventListener('resize', updateScale);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateScale);
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
          style={{
            width: `${RECEIPT_TEMPLATE_CANVAS.width * mobileScale}px`,
            height: `${shellHeight * mobileScale}px`,
            margin: '0 auto',
          }}
        >
          <div
            ref={shellRef}
            data-testid="receipt-template-shell"
            style={{
              width: `${RECEIPT_TEMPLATE_CANVAS.width}px`,
              minHeight: `${RECEIPT_TEMPLATE_CANVAS.height}px`,
              padding: `${RECEIPT_TEMPLATE_CANVAS.paddingMm.top}mm ${RECEIPT_TEMPLATE_CANVAS.paddingMm.right}mm ${RECEIPT_TEMPLATE_CANVAS.paddingMm.bottom}mm ${RECEIPT_TEMPLATE_CANVAS.paddingMm.left}mm`,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: `${RECEIPT_TEMPLATE_CANVAS.contentGapMm}mm`,
              background: '#fff',
              color: '#1a1a2e',
              fontFamily: "'Times New Roman', Times, serif",
              overflow: 'hidden',
              transform: `scale(${mobileScale})`,
              transformOrigin: 'top left',
            }}
          >
            <img
              alt="DMD watermark"
              src={RECEIPT_TEMPLATE_ASSETS.bottomWatermarkDataUrl}
              style={{
                position: 'absolute',
                left: '50%',
                bottom: `${RECEIPT_TEMPLATE_WATERMARK.offsetMm.bottom}mm`,
                width: `${RECEIPT_TEMPLATE_WATERMARK.widthPercent}%`,
                height: `${RECEIPT_TEMPLATE_WATERMARK.heightPx}px`,
                transform: 'translateX(-50%)',
                opacity: RECEIPT_TEMPLATE_WATERMARK.opacityPercent / 100,
                objectFit: 'contain',
                zIndex: 0,
                pointerEvents: 'none',
              }}
            />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `${RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.left}px ${RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.center}px ${RECEIPT_TEMPLATE_HEADER_GRID.columnsPx.right}px`,
              gap: `${RECEIPT_TEMPLATE_HEADER_GRID.gapMm}mm`,
              alignItems: 'start',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div>
              <img
                alt="DMD left logo"
                src={RECEIPT_TEMPLATE_ASSETS.leftLogoDataUrl}
                style={{
                  display: 'block',
                  width: `${RECEIPT_TEMPLATE_LOGO_BLOCKS.left.widthPx}px`,
                  height: `${RECEIPT_TEMPLATE_LOGO_BLOCKS.left.heightPx}px`,
                  objectFit: 'contain',
                  transform: styleTranslate(RECEIPT_TEMPLATE_LOGO_BLOCKS.left.offsetMm),
                  transformOrigin: 'left top',
                }}
              />
            </div>

            <div
              style={{
                textAlign: 'center',
                minWidth: 0,
                transform: styleTranslate(RECEIPT_TEMPLATE_TEXT_REGIONS.companyBlock.offsetMm),
                transformOrigin: 'center top',
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: "'Algerian', 'Times New Roman', Times, serif",
                    fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.companyBlock.companyFontPt}pt`,
                    fontWeight: 400,
                    letterSpacing: '0.06em',
                    color: '#1a1a2e',
                  }}
                >
                  {TEMPLATE_COMPANY_NAME}
                </span>
              </div>
              <div
                style={{
                  fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.companyBlock.addressFontPt}pt`,
                  color: '#333',
                  lineHeight: 1.5,
                  marginTop: '1mm',
                }}
              >
                {TEMPLATE_COMPANY_ADDRESS.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <img
                alt="DMD right logo"
                src={RECEIPT_TEMPLATE_ASSETS.rightLogoDataUrl}
                style={{
                  display: 'inline-block',
                  width: `${RECEIPT_TEMPLATE_LOGO_BLOCKS.right.widthPx}px`,
                  height: `${RECEIPT_TEMPLATE_LOGO_BLOCKS.right.heightPx}px`,
                  objectFit: 'contain',
                  transform: styleTranslate(RECEIPT_TEMPLATE_LOGO_BLOCKS.right.offsetMm),
                  transformOrigin: 'right top',
                }}
              />
              <div
                style={{
                  marginTop: '1mm',
                  transform: styleTranslate(RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.offsetMm),
                  transformOrigin: 'right top',
                }}
              >
                <div>
                  <span style={{ fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt}pt`, fontWeight: 600 }}>No: </span>
                  <span
                    data-testid="receipt-number-value"
                    style={{
                      fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.numberFontPt}pt`,
                      fontWeight: 700,
                      color: TEMPLATE_RECEIPT_NUMBER_COLOR,
                      letterSpacing: '.04em',
                    }}
                  >
                    {layout.receiptNo}
                  </span>
                </div>
                <div style={{ fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt}pt`, marginTop: '.5mm' }}>
                  <span style={{ fontWeight: 600 }}>Date: </span>
                  {layout.dateText}
                </div>
                <div
                  style={{
                    fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.metaBlock.detailFontPt}pt`,
                    marginTop: '.5mm',
                    maxWidth: '160px',
                    marginLeft: 'auto',
                    textAlign: 'right',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Tél: </span>
                  <span>{layout.clientTel || '-'}</span>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              textAlign: 'center',
              fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.titleBlock.fontPt}pt`,
              fontWeight: 800,
              letterSpacing: `${RECEIPT_TEMPLATE_TEXT_REGIONS.titleBlock.letterSpacingEm}em`,
              color: '#1a1a2e',
              margin: '.5mm 0',
              position: 'relative',
              zIndex: 1,
              transform: styleTranslate(RECEIPT_TEMPLATE_TEXT_REGIONS.titleBlock.offsetMm),
              transformOrigin: 'center top',
            }}
          >
            REÇU DE PAIEMENT
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.rowGapMm}mm`,
              position: 'relative',
              zIndex: 1,
              transform: styleTranslate(RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.offsetMm),
              transformOrigin: 'left top',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.boxGapMm}mm` }}>
              <label style={{ fontWeight: 700, fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.labelFontPt}pt` }}>GNF</label>
              <div
                style={{
                  border: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.borderWidthPx}px solid #999`,
                  minWidth: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.gnfWidthMm}mm`,
                  padding: `${Math.max(RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.paddingPx - 2, 0)}px ${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.paddingPx + 2}px`,
                  fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.valueFontPt}pt`,
                  fontWeight: 700,
                  textAlign: 'center',
                  color: 'transparent',
                  background: 'transparent',
                }}
              >
                —
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.boxGapMm}mm` }}>
              <label style={{ fontWeight: 700, fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.labelFontPt}pt` }}>USD</label>
              <div
                style={{
                  border: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.borderWidthPx}px solid #1a1a2e`,
                  minWidth: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.usdWidthMm}mm`,
                  padding: `${Math.max(RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.paddingPx - 2, 0)}px ${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.paddingPx + 2}px`,
                  fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.amountRow.valueFontPt}pt`,
                  fontWeight: 700,
                  textAlign: 'center',
                  background: 'transparent',
                }}
              >
                {usdAmountText}
              </div>
            </div>
          </div>

          <div
            style={{
              border: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.borderWidthPx}px solid #1a1a2e`,
              padding: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.paddingPx.topBottom}px ${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.paddingPx.leftRight}px`,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldGapPx}px`,
              position: 'relative',
              zIndex: 1,
              background: 'transparent',
            }}
          >
            <FieldRow label="Reçu de M./Mme. :" value={layout.clientName} />
            <FieldRow label="La somme de :" value={layout.amountInWords} />
            <FieldRow
              label="Motif :"
              value={layout.motif}
              trailing={(
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '1mm',
                    marginLeft: 'auto',
                    flexShrink: 0,
                    fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt`,
                  }}
                >
                  <span style={{ fontStyle: 'italic', color: '#333' }}>Frais :</span>
                  <span style={{ fontWeight: 700 }}>{TEMPLATE_FRAIS_LABEL}</span>
                </span>
              )}
            />
            <FieldRow label="Reste à payer :" value={layout.resteAPayer} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '1mm' }}>
              <div>
                <div style={{ fontStyle: 'italic', fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt`, color: '#333' }}>Reçu par :</div>
                <div style={{ fontWeight: 600, fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.fieldFontPt}pt` }}>{layout.receivedBy}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontStyle: 'italic', fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt`, color: '#333' }}>Signature :</div>
                <SignatureSlot
                  dataTestId="receiver-signature-slot"
                  alt="Receiver signature"
                  src={receiverSignature}
                  widthMm={RECEIPT_TEMPLATE_SIGNATURE_SLOTS.receiver.widthMm}
                  heightMm={RECEIPT_TEMPLATE_SIGNATURE_SLOTS.receiver.heightMm}
                />
              </div>
            </div>
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontStyle: 'italic', fontSize: `${RECEIPT_TEMPLATE_TEXT_REGIONS.detailBox.labelFontPt}pt`, color: '#333' }}>Signature du payeur :</div>
            <SignatureSlot
              dataTestId="payer-signature-slot"
              alt="Payer signature"
              src={payerSignature}
              widthMm={RECEIPT_TEMPLATE_SIGNATURE_SLOTS.payer.widthMm}
              heightMm={RECEIPT_TEMPLATE_SIGNATURE_SLOTS.payer.heightMm}
            />
          </div>
          </div>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={RECEIPT_TEMPLATE_CANVAS.width}
        height={RECEIPT_TEMPLATE_CANVAS.height}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </div>
  );
});
