'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const items = [
  ['Overview', '/dashboard', '⌂'],
  ['Conversations', '/dashboard/conversations', '◷'],
  ['WhatsApp', '/dashboard/whatsapp', '◉'],
  ['Website Chat', '/dashboard/website-chat', '▣'],
  ['Knowledge Base', '/dashboard/knowledge', '▤'],
  ['Products', '/dashboard/products', '◇'],
  ['AI Assistant', '/dashboard/assistant', '✦'],
  ['Learning gaps', '/dashboard/learning', '◎'],
  ['Leads', '/dashboard/leads', '◉'],
  ['Settings', '/dashboard/settings', '⚙'],
] as const;

export function MerchantShell({
  children,
  businessName,
  active,
}: {
  children: React.ReactNode;
  businessName: string;
  active: string;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="shell">
      <button
        className="mobile-menu"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-controls="merchant-navigation"
        aria-expanded={open}
        data-hydrated={hydrated}
        onClick={() => setOpen(!open)}
      >
        ☰
      </button>
      {open && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="merchant-navigation"
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
      >
        <Link className="brand" href="/dashboard">
          <span className="brand-mark">k</span>
          <span>Kleva</span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace">
          <span className="workspace-icon">
            {businessName.slice(0, 1).toUpperCase()}
          </span>
          <span>{businessName}</span>
          <span className="chevron">⌄</span>
        </div>
        <nav aria-label="Main navigation" className="nav-list">
          {items.map(([label, href, icon]) => {
            const selected =
              href === '/dashboard'
                ? pathname === href
                : pathname.startsWith(href);
            return (
              <Link
                onClick={() => setOpen(false)}
                key={href}
                href={href}
                aria-current={selected ? 'page' : undefined}
                className={`nav-link ${selected ? 'nav-active' : ''}`}
              >
                <span className="nav-icon" aria-hidden="true">
                  {icon}
                </span>
                {label}
                {label === 'Conversations' && (
                  <span className="nav-new">Soon</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-dot" />
            <div>
              <strong>Getting started</strong>
              <p>Connect WhatsApp to get set up.</p>
            </div>
          </div>
          <a className="profile-link" href="/dashboard/settings">
            <span className="avatar">M</span>
            <span>
              <strong>Merchant account</strong>
              <small>Business workspace</small>
            </span>
            <span className="chevron">•••</span>
          </a>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span>{' '}
            <strong>
              {active.split('/').at(-1) === 'dashboard'
                ? 'Overview'
                : active
                    .split('/')
                    .at(-1)
                    ?.replace(/\b\w/g, (c) => c.toUpperCase())}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="secure-label">
              <i /> Secure workspace
            </span>
          </div>
        </header>
        <main id="main-content" className="content">
          {children}
        </main>
      </div>
    </div>
  );
}
