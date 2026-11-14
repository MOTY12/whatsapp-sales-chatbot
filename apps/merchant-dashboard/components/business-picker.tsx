'use client';

export function BusinessPicker({ current, choices, action = '/dashboard' }: { current: string; choices: { id: string; name: string }[]; action?: string }) {
  return <form className="business-switcher" action={action} method="get">
    <label htmlFor="business-select">Business</label>
    <select id="business-select" name="businessId" value={current} onChange={(event) => event.currentTarget.form?.requestSubmit()} aria-label="Select business">
      {choices.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
    </select>
    <noscript><button className="button button-secondary" type="submit">Switch</button></noscript>
  </form>;
}
