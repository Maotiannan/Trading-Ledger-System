import React, { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ReceiptCanvas, type ReceiptCanvasHandle } from './receipt-canvas';
import { buildReceiptGeneratorLayout } from '@/lib/receipt-generator-layout';

type FillTextCall = {
  text: string;
  x: number;
  y: number;
  fillStyle: string;
  font: string;
};

type StrokeSegment = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  strokeStyle: string;
  lineWidth: number;
};

describe('ReceiptCanvas', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const OriginalImage = global.Image;

  const fillTextCalls: FillTextCall[] = [];
  const strokeSegments: StrokeSegment[] = [];

  const drawImage = jest.fn();
  const fillRect = jest.fn();
  const strokeRect = jest.fn();
  const beginPath = jest.fn();
  const save = jest.fn();
  const restore = jest.fn();
  const translate = jest.fn();
  const globalAlphaDescriptor = { value: 1 };
  const textAlignDescriptor = { value: 'start' };
  const textBaselineDescriptor = { value: 'alphabetic' };
  const fillStyleDescriptor = { value: '#000000' };
  const strokeStyleDescriptor = { value: '#000000' };
  const lineWidthDescriptor = { value: 1 };
  const fontDescriptor = { value: '16px serif' };
  const pathState: { from: { x: number; y: number } | null; to: { x: number; y: number } | null } = {
    from: null,
    to: null,
  };

  const fillText = jest.fn((text: string, x: number, y: number) => {
    fillTextCalls.push({ text, x, y, fillStyle: fillStyleDescriptor.value, font: fontDescriptor.value });
  });
  const moveTo = jest.fn((x: number, y: number) => {
    pathState.from = { x, y };
  });
  const lineTo = jest.fn((x: number, y: number) => {
    pathState.to = { x, y };
  });
  const stroke = jest.fn(() => {
    if (pathState.from && pathState.to) {
      strokeSegments.push({
        from: pathState.from,
        to: pathState.to,
        strokeStyle: strokeStyleDescriptor.value,
        lineWidth: lineWidthDescriptor.value,
      });
    }
  });

  const mockContext = {
    drawImage,
    fillRect,
    fillText,
    strokeRect,
    beginPath,
    moveTo,
    lineTo,
    stroke,
    save,
    restore,
    translate,
    measureText: jest.fn((text: string) => ({ width: text.length * 8 })),
    set fillStyle(value: string) { fillStyleDescriptor.value = value; },
    get fillStyle() { return fillStyleDescriptor.value; },
    set strokeStyle(value: string) { strokeStyleDescriptor.value = value; },
    get strokeStyle() { return strokeStyleDescriptor.value; },
    set lineWidth(value: number) { lineWidthDescriptor.value = value; },
    get lineWidth() { return lineWidthDescriptor.value; },
    set font(value: string) { fontDescriptor.value = value; },
    get font() { return fontDescriptor.value; },
    set globalAlpha(value: number) { globalAlphaDescriptor.value = value; },
    get globalAlpha() { return globalAlphaDescriptor.value; },
    set textAlign(value: CanvasTextAlign) { textAlignDescriptor.value = value; },
    get textAlign() { return textAlignDescriptor.value as CanvasTextAlign; },
    set textBaseline(value: CanvasTextBaseline) { textBaselineDescriptor.value = value; },
    get textBaseline() { return textBaselineDescriptor.value as CanvasTextBaseline; },
  } as unknown as CanvasRenderingContext2D;

  const layout = buildReceiptGeneratorLayout({
    receiptNo: '0001000',
    orderNo: 'Big Alpha-07',
    invNo: 'L25MH060523',
    customerMark: 'Big Alpha',
    customerCompanyName: 'Alpha Trading SARL',
    customerName: 'Alpha Oumar Diallo',
    clientTel: '628 38 63 63',
    usdAmount: 2500,
    balanceBefore: 34660,
    generatedAt: new Date('2026-04-27T12:00:00+08:00'),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fillTextCalls.length = 0;
    strokeSegments.length = 0;
    pathState.from = null;
    pathState.to = null;

    HTMLCanvasElement.prototype.getContext = jest.fn(() => mockContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = jest.fn((callback: BlobCallback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    });

    class MockImage {
      onload: null | (() => void) = null;
      onerror: null | ((error?: unknown) => void) = null;
      width = 0;
      height = 0;
      private _src = '';

      set src(value: string) {
        this._src = value;
        queueMicrotask(() => this.onload?.());
      }

      get src() {
        return this._src;
      }
    }

    // @ts-expect-error test mock
    global.Image = MockImage;
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    global.Image = OriginalImage;
  });

  it('renders the approved DMD receipt shell details in the preview', () => {
    render(
      <ReceiptCanvas
        layout={layout}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    expect(screen.getByTestId('receipt-template-shell')).toBeInTheDocument();
    expect(screen.getByText('DMD MERCERIE')).toBeInTheDocument();
    expect(screen.getByText('REÇU DE PAIEMENT')).toBeInTheDocument();
    expect(screen.getByAltText('DMD left logo')).toBeInTheDocument();
    expect(screen.getByAltText('DMD right logo')).toBeInTheDocument();
    expect(screen.getByAltText('DMD watermark')).toBeInTheDocument();

    expect(screen.getByTestId('receipt-number-value')).toHaveStyle({ color: '#e05a00' });
    expect(screen.getByTestId('receiver-signature-slot')).toHaveStyle({ borderBottom: '1px solid #555' });
    expect(screen.getByTestId('payer-signature-slot')).toHaveStyle({ borderBottom: '1px solid #555' });
    expect(screen.getByText('Alpha Trading SARL "Big Alpha"')).toBeInTheDocument();
  });

  it('exports a png with the same receipt number color and signature underline treatment', async () => {
    const ref = createRef<ReceiptCanvasHandle>();

    render(
      <ReceiptCanvas
        ref={ref}
        layout={layout}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    const blob = await ref.current?.exportBlob();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/png');

    await waitFor(() => {
      expect(drawImage).toHaveBeenCalledTimes(5);
    });

    const receiptNoDraw = fillTextCalls.find((call) => call.text === layout.receiptNo);
    expect(receiptNoDraw?.fillStyle).toBe('#e05a00');

    const signatureLines = strokeSegments.filter((segment) => segment.strokeStyle === '#555555' || segment.strokeStyle === '#555');
    expect(signatureLines.length).toBeGreaterThanOrEqual(2);
    expect(signatureLines.some((segment) => segment.lineWidth === 1)).toBe(true);

    expect(fillText).toHaveBeenCalledWith('DMD MERCERIE', expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith('REÇU DE PAIEMENT', expect.any(Number), expect.any(Number));
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
  });

  it('wraps long phone values with a fixed tel label and keeps payer signature inside the exported canvas bounds', async () => {
    const ref = createRef<ReceiptCanvasHandle>();
    const longPhoneLayout = buildReceiptGeneratorLayout({
      receiptNo: '0001001',
      orderNo: 'MAB-1-10',
      invNo: 'L25MH071089C',
      customerMark: 'MAB-1',
      customerCompanyName: 'MAB-1',
      customerName: 'MAB-1',
      clientTel: '622 49 12 86 / 66484333516 / 6200711 / 657311550',
      usdAmount: 1,
      balanceBefore: 8459,
      generatedAt: new Date('2026-04-28T12:00:00+08:00'),
    });

    const { container } = render(
      <ReceiptCanvas
        ref={ref}
        layout={longPhoneLayout}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    await ref.current?.exportBlob();

    const telLabelCall = fillTextCalls.find((call) => call.text === 'Tél:');
    expect(telLabelCall).toBeDefined();
    const phoneDrawCalls = fillTextCalls.filter((call) => call.text.includes('66484333516') || call.text.includes('657311550') || call.text.includes('6200711'));
    expect(phoneDrawCalls.length).toBeGreaterThan(1);
    expect(phoneDrawCalls.every((call) => !call.text.startsWith('Tél:'))).toBe(true);
    expect(phoneDrawCalls.every((call) => call.text.length <= 14)).toBe(true);

    const hiddenCanvas = container.querySelector('canvas[aria-hidden="true"]') as HTMLCanvasElement | null;
    expect(hiddenCanvas).not.toBeNull();
    const bottomLine = strokeSegments[strokeSegments.length - 1];
    expect(bottomLine.to.y).toBeLessThanOrEqual(hiddenCanvas!.height);
  });
});
