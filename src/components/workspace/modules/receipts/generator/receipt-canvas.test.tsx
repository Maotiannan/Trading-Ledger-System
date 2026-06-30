import React, { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ReceiptCanvas, type ReceiptCanvasHandle } from './receipt-canvas';
import { buildReceiptGeneratorLayout } from '@/lib/receipt-generator-layout';
import { RECEIPT_TEMPLATE_META_ABSOLUTE_LAYOUT } from './template-geometry';

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

  it('renders the preview from the same canvas used for export', async () => {
    render(
      <ReceiptCanvas
        layout={layout}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    expect(screen.getByTestId('receipt-template-shell')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-preview-canvas')).toBeInTheDocument();

    await waitFor(() => {
      expect(fillText).toHaveBeenCalledWith('DMD MERCERIE', expect.any(Number), expect.any(Number));
      expect(fillText).toHaveBeenCalledWith('REÇU DE PAIEMENT', expect.any(Number), expect.any(Number));
      expect(fillText).toHaveBeenCalledWith('Alpha Trading SARL "Big Alpha"', expect.any(Number), expect.any(Number));
    });
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
      expect(drawImage.mock.calls.length).toBeGreaterThanOrEqual(5);
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

  it('draws receipt number, date, and phone as separate layers at the approved absolute coordinates', async () => {
    const ref = createRef<ReceiptCanvasHandle>();

    render(
      <ReceiptCanvas
        ref={ref}
        layout={layout}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    await ref.current?.exportBlob();

    const { layers } = RECEIPT_TEMPLATE_META_ABSOLUTE_LAYOUT;
    const expectedLayers = [
      [layers.receiptNoLabel, layers.receiptNoLabel.text, '#1a1a2e'],
      [layers.receiptNoValue, layout.receiptNo, '#e05a00'],
      [layers.dateLabel, layers.dateLabel.text, '#1a1a2e'],
      [layers.dateValue, layout.dateText, '#1a1a2e'],
      [layers.telLabel, layers.telLabel.text, '#1a1a2e'],
      [layers.telValue, layout.clientTel, '#1a1a2e'],
    ] as const;

    expectedLayers.forEach(([layer, text, fillStyle]) => {
      expect(fillTextCalls).toContainEqual({
        text,
        x: layer.x,
        y: layer.y,
        fillStyle,
        font: `${layer.fontWeight} ${layer.fontSize}px Times New Roman`,
      });
    });
    expect(fillTextCalls.some((call) => call.text === `Date: ${layout.dateText}`)).toBe(false);
    expect(fillTextCalls.some((call) => call.text === `Tél: ${layout.clientTel}`)).toBe(false);
  });

  it('keeps long payer phone values on one line and keeps payer signature inside the exported canvas bounds', async () => {
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

    const phoneDrawCalls = fillTextCalls.filter((call) => call.text.includes('66484333516') || call.text.includes('657311550') || call.text.includes('6200711'));
    expect(phoneDrawCalls.length).toBeGreaterThan(0);
    expect([...new Set(phoneDrawCalls.map((call) => call.text))]).toEqual([
      '622 49 12 86 / 66484333516 / 6200711 / 657311550',
    ]);
    const previewCanvas = container.querySelector('[data-testid="receipt-preview-canvas"]') as HTMLCanvasElement | null;
    expect(previewCanvas).not.toBeNull();
    const bottomLine = strokeSegments[strokeSegments.length - 1];
    expect(bottomLine.to.y).toBeLessThanOrEqual(previewCanvas!.height);
  });

  it('places receiver signature near Reçu par and moves payer signature to the former right-side signature area', async () => {
    const ref = createRef<ReceiptCanvasHandle>();

    render(
      <ReceiptCanvas
        ref={ref}
        layout={layout}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    await ref.current?.exportBlob();

    const receiverNameCall = fillTextCalls.find((call) => call.text === layout.receivedBy);
    expect(receiverNameCall).toBeDefined();
    const signatureImageCalls = drawImage.mock.calls.slice(-2);
    expect(signatureImageCalls).toHaveLength(2);
    const receiverSignatureX = Number(signatureImageCalls[0][1]);
    const payerSignatureX = Number(signatureImageCalls[1][1]);

    expect(receiverSignatureX).toBeGreaterThan(receiverNameCall!.x + 140);
    expect(receiverSignatureX).toBeLessThan(payerSignatureX);
    expect(payerSignatureX).toBeGreaterThan(450);
  });

  it('uses the approved interactive signature row layout for labels, signatures, and underline positions', async () => {
    const ref = createRef<ReceiptCanvasHandle>();

    render(
      <ReceiptCanvas
        ref={ref}
        layout={{
          ...layout,
          receivedBy: 'Transferred via bank account',
        }}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    await ref.current?.exportBlob();

    const recuParCall = fillTextCalls.find((call) => call.text === 'Reçu par :');
    const receivedByCall = fillTextCalls.find((call) => call.text === 'Transferred via bank account');
    const signatureCall = fillTextCalls.find((call) => call.text === 'Signature :');
    const payerLabelCall = fillTextCalls.find((call) => call.text === 'Signature du payeur :');
    expect(recuParCall).toBeDefined();
    expect(receivedByCall).toBeDefined();
    expect(signatureCall).toBeDefined();
    expect(payerLabelCall).toBeDefined();

    const rowTop = recuParCall!.y - 22;
    expect(receivedByCall!.x).toBe(recuParCall!.x);
    expect(receivedByCall!.y).toBe(rowTop + 55);
    expect(signatureCall!.x - recuParCall!.x).toBe(268);
    expect(signatureCall!.y).toBe(recuParCall!.y);
    expect(payerLabelCall!.x - recuParCall!.x).toBe(478);
    expect(payerLabelCall!.y).toBe(recuParCall!.y);

    const signatureImageCalls = drawImage.mock.calls.slice(-2);
    expect(Number(signatureImageCalls[0][1]) - recuParCall!.x).toBe(268);
    expect(Number(signatureImageCalls[0][2])).toBe(rowTop + 50);
    expect(Number(signatureImageCalls[0][3])).toBe(196);
    expect(Number(signatureImageCalls[0][4])).toBe(45);
    expect(Number(signatureImageCalls[1][1]) - recuParCall!.x).toBe(478);
    expect(Number(signatureImageCalls[1][2])).toBe(rowTop + 50);
    expect(Number(signatureImageCalls[1][3])).toBe(200);
    expect(Number(signatureImageCalls[1][4])).toBe(46);

    const receiverLine = strokeSegments.find((segment) => segment.from.x === recuParCall!.x + 268 && segment.to.x === recuParCall!.x + 468);
    const payerLine = strokeSegments.find((segment) => segment.from.x === recuParCall!.x + 478 && segment.to.x === recuParCall!.x + 678);
    expect(receiverLine?.from.y).toBe(rowTop + 100);
    expect(receiverLine?.to.y).toBe(rowTop + 100);
    expect(payerLine?.from.y).toBe(rowTop + 100);
    expect(payerLine?.to.y).toBe(rowTop + 100);
  });

  it('keeps amount label gaps and body values attached to each row label colon', async () => {
    const ref = createRef<ReceiptCanvasHandle>();

    render(
      <ReceiptCanvas
        ref={ref}
        layout={layout}
        receiverSignature="data:image/png;base64,receiver"
        payerSignature="data:image/png;base64,payer"
      />,
    );

    await ref.current?.exportBlob();

    const gnfLabelCall = fillTextCalls.find((call) => call.text === 'GNF');
    const usdLabelCall = fillTextCalls.find((call) => call.text === 'USD');
    expect(gnfLabelCall).toBeDefined();
    expect(usdLabelCall).toBeDefined();

    const [gnfRectX] = strokeRect.mock.calls[0];
    const [usdRectX] = strokeRect.mock.calls[1];
    expect(gnfRectX - gnfLabelCall!.x - 'GNF'.length * 8).toBeGreaterThan(9.5);
    expect(usdRectX - usdLabelCall!.x - 'USD'.length * 8).toBeGreaterThan(9.5);

    const clientLabelCall = fillTextCalls.find((call) => call.text === 'Reçu de M./Mme. :');
    const clientValueCall = fillTextCalls.find((call) => call.text === layout.clientName);
    expect(clientLabelCall).toBeDefined();
    expect(clientValueCall).toBeDefined();
    expect(clientValueCall!.x).toBe(clientLabelCall!.x + 'Reçu de M./Mme. :'.length * 8 + 2);

    const motifLabelCall = fillTextCalls.find((call) => call.text === 'Motif :');
    const motifValueCall = fillTextCalls.find((call) => call.text === layout.motif);
    const fraisLabelCall = fillTextCalls.find((call) => call.text === 'Frais : ');
    const fraisValueCall = fillTextCalls.find((call) => call.text === 'Payé');
    const paymentModeValueCall = fillTextCalls.find((call) => call.text === 'Espèces');
    expect(motifLabelCall).toBeDefined();
    expect(motifValueCall).toBeDefined();
    expect(fraisLabelCall).toBeDefined();
    expect(fraisValueCall).toBeDefined();
    expect(paymentModeValueCall).toBeDefined();
    expect(motifValueCall!.x).toBe(motifLabelCall!.x + 'Motif :'.length * 8 + 2);
    expect(fraisLabelCall!.x).toBeGreaterThan(motifValueCall!.x);
  });
});
