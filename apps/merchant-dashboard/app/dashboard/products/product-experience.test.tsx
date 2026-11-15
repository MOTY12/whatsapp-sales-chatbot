import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductExperience } from './product-experience';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('ProductExperience', () => {
  it('shows the empty catalog and rejects a negative price', async () => {
    render(
      <ProductExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialPage={{ items: [], limit: 50, offset: 0, hasMore: false }}
        initialError={null}
      />,
    );
    expect(screen.getByText('No products yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Product name/), {
      target: { value: 'Catalog product' },
    });
    fireEvent.change(document.getElementById('product-price')!, {
      target: { value: '-1.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect((await screen.findAllByRole('alert')).at(-1)).toHaveTextContent(
      'non-negative price',
    );
  });
});
