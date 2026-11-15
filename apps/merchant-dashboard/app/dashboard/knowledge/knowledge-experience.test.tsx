import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeExperience } from './knowledge-experience';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

describe('KnowledgeExperience', () => {
  it('shows the empty state and validates required question and answer fields', async () => {
    render(
      <KnowledgeExperience
        businessId="business-1"
        initialFaqs={[]}
        initialError={null}
      />,
    );
    expect(screen.getByText('No FAQs yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Customer question/), {
      target: { value: 'What time do you open?' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save draft' }).at(-1)!);
    expect((await screen.findAllByRole('alert')).at(-1)).toHaveTextContent(
      'Add an answer before saving.',
    );
  });
});
