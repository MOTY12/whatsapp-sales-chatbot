import Link from 'next/link';

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>{title}</h1><p className="muted">{description}</p></div></div><section className="coming-card"><div className="coming-illustration" aria-hidden="true"><span>✦</span><i/><i/><i/></div><span className="coming-tag">COMING SOON</span><h2>{title} is on the way</h2><p>We’re building this part of Kleva now. Your workspace will show real business information here as soon as it’s available.</p><Link className="button button-secondary" href="/dashboard">Back to overview <span aria-hidden="true">→</span></Link></section></>;
}
