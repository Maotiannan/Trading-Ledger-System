'use client';

import { fireEvent, render, screen } from '@testing-library/react';
import { DashboardCardPagination } from './dashboard-card-pagination';

describe('DashboardCardPagination', () => {
  it('renders a compact fixed-bottom pager without page-size controls', () => {
    render(
      <DashboardCardPagination
        page={1}
        totalPages={2}
        totalItems={15}
        tx={(_zh, en) => en}
        onPrevious={jest.fn()}
        onNext={jest.fn()}
      />,
    );

    expect(screen.getByTestId('dashboard-card-pagination')).toHaveClass('mt-auto');
    expect(screen.getByText('1 / 2 (15)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveTextContent('←');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveTextContent('→');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('calls page actions and disables the last-page boundary', () => {
    const onPrevious = jest.fn();
    const onNext = jest.fn();
    const { rerender } = render(
      <DashboardCardPagination
        page={1}
        totalPages={2}
        totalItems={15}
        tx={(_zh, en) => en}
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);

    rerender(
      <DashboardCardPagination
        page={2}
        totalPages={2}
        totalItems={15}
        tx={(_zh, en) => en}
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('keeps an equal-height placeholder when there are no rows', () => {
    render(
      <DashboardCardPagination
        page={1}
        totalPages={1}
        totalItems={0}
        tx={(_zh, en) => en}
        onPrevious={jest.fn()}
        onNext={jest.fn()}
      />,
    );

    expect(screen.getByTestId('dashboard-card-pagination-placeholder')).toHaveClass('mt-auto');
  });
});
