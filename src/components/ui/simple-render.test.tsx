import { render, screen } from '@testing-library/react';

function SampleBadge({ text }: { text: string }) {
  return <span>{text}</span>;
}

describe('react testing library setup', () => {
  it('renders content', () => {
    render(<SampleBadge text="ok" />);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
