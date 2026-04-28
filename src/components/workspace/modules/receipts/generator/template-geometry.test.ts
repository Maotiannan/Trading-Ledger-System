import {
  RECEIPT_TEMPLATE_CANVAS,
  RECEIPT_TEMPLATE_SIGNATURE_BOXES,
  RECEIPT_TEMPLATE_TEXT_ROWS,
} from '@/components/workspace/modules/receipts/generator/template-geometry';

describe('receipt generator template geometry', () => {
  it('defines the approved fixed canvas and both signature boxes', () => {
    expect(RECEIPT_TEMPLATE_CANVAS).toEqual({ width: 1200, height: 1650 });
    expect(RECEIPT_TEMPLATE_SIGNATURE_BOXES.receiver.width).toBeGreaterThan(300);
    expect(RECEIPT_TEMPLATE_SIGNATURE_BOXES.payer.width).toBeGreaterThan(300);
    expect(RECEIPT_TEMPLATE_TEXT_ROWS.length).toBeGreaterThan(8);
  });
});
