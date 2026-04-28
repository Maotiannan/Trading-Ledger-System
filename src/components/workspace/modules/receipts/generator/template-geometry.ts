export const RECEIPT_TEMPLATE_CANVAS = {
  width: 720,
  height: 507,
  paddingMm: { top: 2, right: 4, bottom: 2, left: 4 },
  contentGapMm: 2,
} as const;

export const RECEIPT_TEMPLATE_HEADER_GRID = {
  columnsPx: { left: 170, center: 312, right: 170 },
  gapMm: 5,
} as const;

export const RECEIPT_TEMPLATE_LOGO_BLOCKS = {
  left: { widthPx: 216, heightPx: 88, offsetMm: { x: 0, y: 3 }, anchor: 'top-left' },
  right: { widthPx: 164, heightPx: 30, offsetMm: { x: 0, y: 8 }, anchor: 'top-right' },
} as const;

export const RECEIPT_TEMPLATE_WATERMARK = {
  widthPercent: 88,
  heightPx: 172,
  opacityPercent: 12,
  offsetMm: { x: 0, bottom: 35 },
  anchor: 'bottom-center',
} as const;

export const RECEIPT_TEMPLATE_TEXT_REGIONS = {
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
} as const;

export const RECEIPT_TEMPLATE_SIGNATURE_SLOTS = {
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
} as const;
