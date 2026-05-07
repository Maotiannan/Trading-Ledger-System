'use client';

import { render, screen } from '@testing-library/react';
import { ReceiptImagePreviewDialog } from './receipt-image-preview-dialog';

describe('ReceiptImagePreviewDialog', () => {
  it('shows binding metadata instead of the stored file name', () => {
    render(
      <ReceiptImagePreviewDialog
        image={{
          url: '/upload/images/receipts/ocr/ab.jpg',
          alt: 'Receipt image',
          orderNo: 'AB-13B',
          invNo: 'Un_Associated',
          creator: 'Pikin',
        }}
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByText('已绑定ORDER NO：AB-13B')).toBeInTheDocument();
    expect(screen.getByText('已绑定发票号：Un_Associated')).toBeInTheDocument();
    expect(screen.getByText('创建者：Pikin')).toBeInTheDocument();
    expect(screen.queryByText(/IMG_20260506_172643/)).not.toBeInTheDocument();
  });

  it('uses provided translations for English UI', () => {
    render(
      <ReceiptImagePreviewDialog
        image={{
          url: '/upload/images/receipts/ocr/ab.jpg',
          alt: 'Receipt image',
          orderNo: 'AB-13B',
          invNo: 'Un_Associated',
          creator: 'Pikin',
        }}
        tx={(_zh, en) => en}
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByText('Bound ORDER NO: AB-13B')).toBeInTheDocument();
    expect(screen.getByText('Bound invoice: Un_Associated')).toBeInTheDocument();
    expect(screen.getByText('Creator: Pikin')).toBeInTheDocument();
  });
});
