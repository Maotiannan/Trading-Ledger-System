import { fireEvent, render, screen } from '@testing-library/react';
import { ListPagination } from './list-pagination';

const tx = (zh: string, _en: string) => zh;

describe('ListPagination', () => {
  it('renders compact pagination controls and keeps page-size selection accessible', () => {
    const onPageSizeChange = jest.fn();
    const onPreviousPage = jest.fn();
    const onNextPage = jest.fn();

    render(
      <ListPagination
        idPrefix="test"
        tx={tx}
        currentPage={1}
        totalPages={2}
        totalCount={15}
        pageSize={10}
        pageSizeOptions={[5, 10, 20, 50]}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
        onPageSizeChange={onPageSizeChange}
      />
    );

    expect(screen.getByText('1 / 2 (15)')).toBeInTheDocument();
    expect(screen.queryByText('每页条数')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toHaveTextContent('←');
    expect(screen.getByRole('button', { name: '下一页' })).toHaveTextContent('→');

    fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    expect(onPageSizeChange).toHaveBeenCalledWith(20);
    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPreviousPage).not.toHaveBeenCalled();
  });
});
