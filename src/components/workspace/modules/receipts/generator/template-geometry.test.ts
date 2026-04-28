import { RECEIPT_TEMPLATE_ASSETS } from '@/components/workspace/modules/receipts/generator/template-assets';
import {
  RECEIPT_TEMPLATE_CANVAS,
  RECEIPT_TEMPLATE_HEADER_GRID,
  RECEIPT_TEMPLATE_LOGO_BLOCKS,
  RECEIPT_TEMPLATE_TEXT_REGIONS,
  RECEIPT_TEMPLATE_SIGNATURE_SLOTS,
  RECEIPT_TEMPLATE_WATERMARK,
} from '@/components/workspace/modules/receipts/generator/template-geometry';

describe('receipt generator approved template freeze', () => {
  it('freezes every embedded asset used by the approved HTML shell', () => {
    expect(Object.keys(RECEIPT_TEMPLATE_ASSETS)).toEqual([
      'leftLogoDataUrl',
      'rightLogoDataUrl',
      'bottomWatermarkDataUrl',
    ]);
    expect(RECEIPT_TEMPLATE_ASSETS.leftLogoDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(RECEIPT_TEMPLATE_ASSETS.rightLogoDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(RECEIPT_TEMPLATE_ASSETS.bottomWatermarkDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(RECEIPT_TEMPLATE_ASSETS.leftLogoDataUrl.length).toBeGreaterThan(1000);
    expect(RECEIPT_TEMPLATE_ASSETS.rightLogoDataUrl.length).toBeGreaterThan(1000);
    expect(RECEIPT_TEMPLATE_ASSETS.bottomWatermarkDataUrl.length).toBeGreaterThan(1000);
  });

  it('freezes the approved receipt shell geometry from the HTML template', () => {
    expect(RECEIPT_TEMPLATE_CANVAS).toEqual({
      width: 720,
      height: 507,
      paddingMm: { top: 2, right: 4, bottom: 2, left: 4 },
      contentGapMm: 2,
    });

    expect(RECEIPT_TEMPLATE_HEADER_GRID).toEqual({
      columnsPx: { left: 170, center: 312, right: 170 },
      gapMm: 5,
    });

    expect(RECEIPT_TEMPLATE_LOGO_BLOCKS).toEqual({
      left: { widthPx: 216, heightPx: 88, offsetMm: { x: 0, y: 3 }, anchor: 'top-left' },
      right: { widthPx: 164, heightPx: 30, offsetMm: { x: 0, y: 8 }, anchor: 'top-right' },
    });

    expect(RECEIPT_TEMPLATE_WATERMARK).toEqual({
      widthPercent: 88,
      heightPx: 172,
      opacityPercent: 12,
      offsetMm: { x: 0, bottom: 35 },
      anchor: 'bottom-center',
    });

    expect(RECEIPT_TEMPLATE_TEXT_REGIONS).toEqual({
      companyBlock: { offsetMm: { x: 5, y: 1 }, companyFontPt: 25, addressFontPt: 8 },
      metaBlock: { offsetMm: { x: -8, y: 16 }, numberFontPt: 16, detailFontPt: 11 },
      titleBlock: { offsetMm: { x: 0, y: 0 }, fontPt: 16, letterSpacingEm: 0.04 },
      amountRow: {
        offsetMm: { x: 23, y: 0 },
        rowGapMm: 8,
        boxGapMm: 2,
        borderWidthPx: 2,
        paddingPx: 5,
        gnfWidthMm: 46,
        usdWidthMm: 38,
        labelFontPt: 12,
        valueFontPt: 12,
      },
      detailBox: {
        borderWidthPx: 1.5,
        paddingPx: { topBottom: 2, leftRight: 6 },
        fieldGapPx: 2,
        fieldFontPt: 16,
        labelFontPt: 14,
        labels: [
          'Reçu de M./Mme. :',
          'La somme de :',
          'Motif :',
          'Frais :',
          'Reste à payer :',
          'Reçu par :',
          'Signature :',
          'Signature du payeur :',
        ],
      },
    });

    expect(RECEIPT_TEMPLATE_SIGNATURE_SLOTS).toEqual({
      receiver: {
        widthMm: 52,
        heightMm: 16,
        offsetMm: { x: 0, y: 0 },
        placement: 'detail-box-top-right',
      },
      payer: {
        widthMm: 62,
        heightMm: 17,
        offsetMm: { x: 0, y: 0 },
        placement: 'below-detail-box',
      },
    });
  });
});
