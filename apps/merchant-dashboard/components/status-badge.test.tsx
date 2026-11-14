import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it.each([['active', 'Connected'], ['inactive', 'Action required'], ['pending', 'Not connected'], ['unknown', 'Status unavailable']] as const)('renders %s clearly', (status, label) => {
    render(<StatusBadge status={status}/>);
    expect(screen.getByText(label)).toBeVisible();
  });
});
