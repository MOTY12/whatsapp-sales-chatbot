'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamAuditEvent, TeamInvitation, TeamMember } from '@/lib/api';

async function mutate(
  path: string,
  method: 'POST' | 'PATCH',
  body?: unknown,
  key?: string,
) {
  const csrf =
    document.cookie
      .split('; ')
      .find((part) => /kleva_csrf=/i.test(part))
      ?.split('=')
      .slice(1)
      .join('=') ?? '';
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(result?.error?.message ?? 'Team update failed.');
  return result;
}

export function TeamExperience({
  businessId,
  members,
  invitations,
  audit,
}: {
  businessId: string;
  members: TeamMember[];
  invitations: TeamInvitation[];
  audit: TeamAuditEvent[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent' | 'editor'>('agent');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [searchResults, setSearchResults] = useState(members);
  const [searchBusy, setSearchBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      status,
      limit: '100',
    });
    if (query.trim()) params.set('search', query.trim());
    setSearchBusy(true);
    void fetch(`/api/team/${businessId}?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          items?: TeamMember[];
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(payload.error?.message ?? 'Member search failed.');
        setSearchResults(payload.items ?? []);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Member search failed.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearchBusy(false);
      });
    return () => controller.abort();
  }, [businessId, query, status]);
  const visible = useMemo(() => searchResults, [searchResults]);
  const active = members.filter((member) => member.status === 'active');
  const ownerCount = active.filter((member) => member.role === 'owner').length;
  async function action(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      setNotice(success);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Team update failed.');
    } finally {
      setBusy(false);
    }
  }
  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action(async () => {
      await mutate(
        `/api/team/${businessId}/invitations`,
        'POST',
        { email, role },
        crypto.randomUUID(),
      );
      setEmail('');
    }, 'Invitation queued. The teammate must sign in with the invited email address.');
  }
  return (
    <>
      <div className="team-summary" aria-label="Team counts">
        <article>
          <strong>{active.length}</strong>
          <span>Active members</span>
        </article>
        <article>
          <strong>
            {active.filter((member) => member.role === 'owner').length}
          </strong>
          <span>Owners</span>
        </article>
        <article>
          <strong>
            {active.filter((member) => member.role === 'editor').length}
          </strong>
          <span>Editors</span>
        </article>
        <article>
          <strong>
            {active.filter((member) => member.role === 'agent').length}
          </strong>
          <span>Agents</span>
        </article>
        <article>
          <strong>
            {
              invitations.filter(
                (invitation) => invitation.status === 'PENDING',
              ).length
            }
          </strong>
          <span>Pending invitations</span>
        </article>
      </div>
      {notice && (
        <p className="success-banner" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="settings-section">
        <div className="section-title">
          <div>
            <h2>Invite a teammate</h2>
            <p className="muted">
              Owners can invite someone as an agent or knowledge editor. Team
              access works without WhatsApp approval.
            </p>
          </div>
        </div>
        <form className="team-invite-form" onSubmit={invite}>
          <label>
            Email address
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as 'agent' | 'editor')
              }
            >
              <option value="agent">Agent · shared inbox</option>
              <option value="editor">Editor · FAQs, documents, products</option>
            </select>
          </label>
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
      </section>
      <section className="settings-section">
        <div className="section-title">
          <div>
            <h2>Team members</h2>
            <p className="muted">
              Changes take effect immediately. Inactive access can be restored
              by sending a new invitation to the verified email.
            </p>
          </div>
        </div>
        <div className="team-toolbar">
          <label>
            Search members
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as 'active' | 'inactive')
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Revoked</option>
            </select>
          </label>
        </div>
        <div className="team-table-wrap">
          <table className="team-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.id}>
                  <td>
                    <strong>{member.name || 'Merchant teammate'}</strong>
                    <small>
                      {member.email || 'Verified email unavailable'}
                    </small>
                  </td>
                  <td>{member.role}</td>
                  <td>{member.status === 'active' ? 'Active' : 'Revoked'}</td>
                  <td>{new Date(member.joinedAt).toLocaleDateString()}</td>
                  <td>
                    {member.status === 'active' &&
                    (member.role !== 'owner' || ownerCount > 1) ? (
                      <div className="team-actions">
                        <select
                          aria-label={`Role for ${member.email ?? member.name}`}
                          value={member.role}
                          disabled={busy}
                          onChange={(event) => {
                            const nextRole = event.target.value as
                              'agent' | 'editor';
                            if (
                              member.role === 'owner' &&
                              !window.confirm(
                                `Change this owner to ${nextRole}? The business must retain an active owner.`,
                              )
                            )
                              return;
                            void action(
                              () =>
                                mutate(
                                  `/api/team/${businessId}/members/${member.id}`,
                                  'PATCH',
                                  { role: nextRole, version: member.version },
                                ),
                              'Member role updated.',
                            );
                          }}
                        >
                          {member.role === 'owner' && (
                            <option value="owner">Owner</option>
                          )}
                          <option value="agent">Agent</option>
                          <option value="editor">Editor</option>
                        </select>
                        <button
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke ${member.email ?? 'this teammate'} from this business?`,
                              )
                            )
                              void action(
                                () =>
                                  mutate(
                                    `/api/team/${businessId}/members/${member.id}/revoke`,
                                    'POST',
                                    { version: member.version },
                                  ),
                                'Business access revoked.',
                              );
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : member.status === 'active' &&
                      member.role === 'owner' ? (
                      'Only active owner · cannot revoke'
                    ) : (
                      'Access revoked'
                    )}
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={5}>No members match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-title">
          <div>
            <h2>Invitations</h2>
            <p className="muted">
              Links are one-time, expire after three days and are bound to the
              verified recipient email.
            </p>
          </div>
        </div>
        <div className="team-table-wrap">
          <table className="team-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Invited</th>
                <th>Expires</th>
                <th>Delivery</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td>{invitation.recipient_email}</td>
                  <td>{invitation.invited_role}</td>
                  <td>
                    {new Date(invitation.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    {new Date(invitation.expires_at).toLocaleDateString()}
                  </td>
                  <td>{invitation.delivery_status.toLowerCase()}</td>
                  <td>
                    {invitation.status === 'PENDING' && (
                      <div className="team-actions">
                        <button
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () =>
                                mutate(
                                  `/api/team/${businessId}/invitations/${invitation.id}/resend`,
                                  'POST',
                                ),
                              'Invitation email queued with a new one-time link.',
                            )
                          }
                        >
                          Resend
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke the invitation for ${invitation.recipient_email}?`,
                              )
                            )
                              void action(
                                () =>
                                  mutate(
                                    `/api/team/${businessId}/invitations/${invitation.id}/revoke`,
                                    'POST',
                                  ),
                                'Invitation revoked.',
                              );
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!invitations.length && (
                <tr>
                  <td colSpan={6}>No invitations yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-title">
          <div>
            <h2>Team activity</h2>
            <p className="muted">
              Recent invitations and membership changes for this business.
            </p>
          </div>
        </div>
        <div className="team-audit-list">
          {audit.map((event) => (
            <article key={event.id}>
              <strong>{event.event_kind.replaceAll('.', ' ')}</strong>
              <span>{new Date(event.created_at).toLocaleString()}</span>
              <small>
                {event.target_account_id
                  ? `Account ${event.target_account_id.slice(0, 8)}`
                  : 'Invitation or membership record'}
              </small>
            </article>
          ))}
          {!audit.length && (
            <p className="muted">No team activity recorded yet.</p>
          )}
        </div>
      </section>
    </>
  );
}
