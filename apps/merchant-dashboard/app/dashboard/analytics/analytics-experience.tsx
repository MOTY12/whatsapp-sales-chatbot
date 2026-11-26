import Link from 'next/link';
import type { MerchantAnalyticsReport } from '@/lib/api';
import styles from './analytics.module.css';

function count(value: number) {
  return new Intl.NumberFormat('en-NG').format(value);
}
function duration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return 'Unavailable';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}

export function AnalyticsExperience({
  report,
  businessName,
}: {
  report: MerchantAnalyticsReport;
  businessName: string;
}) {
  const e = report.engagement;
  const r = report.responses;
  const aiRate = e.inboundConversations
    ? Math.round(((r.aiOnly + r.mixed) / e.inboundConversations) * 100)
    : null;
  const handoffRate = e.inboundConversations
    ? Math.round((report.handoffs.conversations / e.inboundConversations) * 100)
    : null;
  const metric = (title: string, value: string, description: string) => (
    <article className={styles.metric} key={title}>
      <span className={styles.metricTitle}>{title}</span>
      <strong>{value}</strong>
      <span className={styles.metricDescription}>{description}</span>
    </article>
  );
  const trend = e.trend ?? [];
  const leadTrend = report.sales.leadTrend ?? [];
  const maxTrend = Math.max(1, ...trend.map((day) => day.conversations));
  const maxLeads = Math.max(1, ...leadTrend.map((day) => day.leads));
  const updatedAt = new Intl.DateTimeFormat('en-NG', {
    timeZone: report.range.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(report.generatedAt));
  return (
    <>
      <div className={styles.meta}>
        <span>
          {businessName} · {report.range.timezone}
        </span>
        <span>
          Local business dates: {report.range.from} – {report.range.to} ·{' '}
          {report.trendGrouping ?? 'daily'} trend
        </span>
        <span>Last updated {updatedAt}</span>
      </div>
      <section
        className={styles.metrics}
        aria-label="Key performance indicators"
      >
        {metric(
          'Customer conversations',
          count(e.inboundConversations),
          'Distinct conversations with an inbound customer message in this range.',
        )}
        {metric(
          'AI-handled rate',
          aiRate === null ? 'Unavailable' : `${aiRate}%`,
          'AI-only and mixed conversations ÷ inbound conversation cohort.',
        )}
        {metric(
          'Median first response',
          duration(r.medianFirstResponseSeconds),
          'First accepted public AI or human response after the cohort’s first inbound message.',
        )}
        {metric(
          'Qualified leads',
          count(report.sales.qualifiedLeads),
          'Leads created in the selected period that are currently qualified.',
        )}
        {metric(
          'Recorded conversions',
          count(report.sales.won),
          'WON conversion events recorded in the selected period; not payment confirmation.',
        )}
        {metric(
          'Human handoff rate',
          handoffRate === null ? 'Unavailable' : `${handoffRate}%`,
          'Distinct cohort conversations with a recorded handoff ÷ inbound conversation cohort.',
        )}
      </section>
      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Customer engagement</h2>
              <p>Inbound conversation cohort by local business date</p>
            </div>
            <span className={styles.panelTotal}>
              {count(e.inboundMessages)} messages
            </span>
          </div>
          {trend.length ? (
            <div
              className={styles.chart}
              role="img"
              aria-label="Daily customer conversation counts"
            >
              <div className={styles.bars}>
                {trend.map((day) => (
                  <div
                    className={styles.barColumn}
                    key={day.date}
                    title={`${day.date}: ${day.conversations} conversations`}
                  >
                    <span>{day.conversations || ''}</span>
                    <i
                      style={{
                        height: `${Math.max(day.conversations ? 4 : 0, (day.conversations / maxTrend) * 100)}%`,
                      }}
                    />
                    <small>{day.date.slice(5)}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className={styles.empty}>
              No customer activity in this date range.
            </p>
          )}
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Response outcomes</h2>
              <p>Conversation classifications are exclusive.</p>
            </div>
          </div>
          <div className={styles.outcomes}>
            {[
              ['AI only', r.aiOnly],
              ['Human only', r.humanOnly],
              ['AI and human', r.mixed],
              ['Unanswered', r.unanswered],
            ].map(([label, value]) => (
              <div className={styles.outcome} key={label}>
                <span>{label}</span>
                <strong>{count(Number(value))}</strong>
              </div>
            ))}
          </div>
          <p className={styles.footnote}>
            Unanswered means no accepted public response is recorded after the
            first inbound message in the selected cohort. Provider acceptance
            and confirmed delivery are combined.
          </p>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Sales performance</h2>
              <p>
                Lead creation cohort and conversion events are reported
                separately.
              </p>
            </div>
          </div>
          <div className={styles.sales}>
            <span>
              Leads created<strong>{count(report.sales.leadsCreated)}</strong>
            </span>
            <span>
              Qualified leads
              <strong>{count(report.sales.qualifiedLeads)}</strong>
            </span>
            <span>
              Qualification rate
              <strong>
                {report.sales.qualificationRate === null
                  ? 'Unavailable'
                  : `${report.sales.qualificationRate}%`}
              </strong>
            </span>
            <span>
              Cohort WON rate
              <strong>
                {report.sales.cohortConversionRate === null
                  ? 'Unavailable'
                  : `${report.sales.cohortConversionRate}%`}
              </strong>
            </span>
            <span>
              Open opportunities
              <strong>{count(report.sales.openOpportunities)}</strong>
            </span>
            <span>
              Won<strong>{count(report.sales.won)}</strong>
            </span>
            <span>
              Lost<strong>{count(report.sales.lost)}</strong>
            </span>
          </div>
          {leadTrend.length > 0 && (
            <div
              className={styles.leadBars}
              role="img"
              aria-label="Daily lead creation counts"
            >
              {leadTrend.map((day) => (
                <span key={day.date} title={`${day.date}: ${day.leads} leads`}>
                  <i
                    style={{
                      height: `${Math.max(day.leads ? 4 : 0, (day.leads / maxLeads) * 100)}%`,
                    }}
                  />
                  <small>{day.date.slice(5)}</small>
                </span>
              ))}
            </div>
          )}
          <p className={styles.footnote}>
            Qualification uses current lead status for leads created in this
            range. WON/LOST are conversion events recorded during the selected
            range.
          </p>
          <div className={styles.revenue}>
            <b>Recorded conversion value</b>
            {report.sales.recordedValuesByCurrency.length ? (
              report.sales.recordedValuesByCurrency.map((item) => (
                <span key={item.currency}>
                  {item.currency} {item.value}
                </span>
              ))
            ) : (
              <span>Unavailable · no recorded value</span>
            )}
          </div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Customer support</h2>
              <p>Response and conversation state</p>
            </div>
          </div>
          <div className={styles.support}>
            <span>
              Awaiting response<strong>{count(e.awaitingResponse)}</strong>
            </span>
            <span>
              Awaiting human
              <strong>{count(report.handoffs.awaitingHuman)}</strong>
            </span>
            <span>
              Resolved events<strong>{count(e.resolvedEvents)}</strong>
            </span>
            <span>
              Reopened events<strong>{count(e.reopenedEvents)}</strong>
            </span>
            <span>
              Median AI first response
              <strong>{duration(r.medianAiFirstResponseSeconds)}</strong>
            </span>
            <span>
              Median human first response
              <strong>{duration(r.medianHumanFirstResponseSeconds)}</strong>
            </span>
          </div>
          {report.handoffs.reasons.length > 0 && (
            <div className={styles.reasons}>
              <b>Recorded handoff reasons</b>
              {report.handoffs.reasons.map((item) => (
                <span key={item.reason}>
                  {item.reason.replaceAll('_', ' ').toLowerCase()} ·{' '}
                  {count(item.count)}
                </span>
              ))}
            </div>
          )}
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>AI assistant</h2>
              <p>Generation outcomes and evidence-backed delivery</p>
            </div>
          </div>
          <div className={styles.support}>
            <span>
              Grounded runs accepted<strong>{report.ai.accepted ?? '—'}</strong>
            </span>
            <span>
              Eligible grounded runs<strong>{report.ai.eligible ?? '—'}</strong>
            </span>
            <span>
              Acceptance rate
              <strong>
                {report.ai.acceptanceRate == null
                  ? 'Unavailable'
                  : `${report.ai.acceptanceRate}%`}
              </strong>
            </span>
            <span>
              Insufficient evidence
              <strong>{count(report.ai.insufficientEvidence)}</strong>
            </span>
            <span>
              Generation failures
              <strong>{count(report.ai.failedGenerations)}</strong>
            </span>
            <span>
              Suppressed<strong>{count(report.ai.suppressed)}</strong>
            </span>
          </div>
          <p className={styles.footnote}>
            Generated answers count only when an accepted outbound record is
            linked. Acceptance is not proof of delivery.
          </p>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Knowledge improvement</h2>
              <p>Redacted topics from retained learning-gap records</p>
            </div>
            <Link href="/dashboard/learning">Open learning gaps →</Link>
          </div>
          <div className={styles.support}>
            <span>
              Occurrences<strong>{count(report.knowledge.occurrences)}</strong>
            </span>
            <span>
              Topics<strong>{count(report.knowledge.topics)}</strong>
            </span>
            <span>
              Open<strong>{count(report.knowledge.openTopics)}</strong>
            </span>
            <span>
              Reviewed<strong>{count(report.knowledge.reviewedTopics)}</strong>
            </span>
            <span>
              Published improvements
              <strong>{count(report.knowledge.publishedImprovements)}</strong>
            </span>
            <span>
              Indexing failures
              <strong>{count(report.knowledge.failedIndexing)}</strong>
            </span>
            <span>
              Completed evaluations
              <strong>{count(report.knowledge.completedEvaluations)}</strong>
            </span>
            <span>
              Grounded valid cases
              <strong>
                {count(report.knowledge.groundedValidCases)} /{' '}
                {count(report.knowledge.evaluationCases)}
              </strong>
            </span>
          </div>
          {report.knowledge.topTopics.length ? (
            <div className={styles.reasons}>
              {report.knowledge.topTopics.slice(0, 5).map((topic) => (
                <span key={topic.topic}>
                  {topic.topic} · {count(topic.count)}
                </span>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              No retained knowledge gaps in this range.
            </p>
          )}
          <p className={styles.footnote}>
            Published improvements and evaluation outcomes are separate
            measures; publication alone does not imply better retrieval.
          </p>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>AI usage</h2>
              <p>UTC monthly quota period · current month</p>
            </div>
          </div>
          {report.usage.length ? (
            <div className={styles.usage}>
              <div className={styles.usageHead}>
                <span>Category / purpose</span>
                <span>Consumed</span>
                <span>Reserved</span>
                <span>Uncertain</span>
              </div>
              {report.usage.map((item) => (
                <div
                  className={styles.usageRow}
                  key={`${item.category}-${item.purpose}`}
                >
                  <span>
                    {item.category.replaceAll('_', ' ')} ·{' '}
                    {item.purpose.toLowerCase().replaceAll('_', ' ')}
                  </span>
                  <span>{count(item.consumed)}</span>
                  <span>{count(item.reserved)}</span>
                  <span>{count(item.uncertain)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No usage recorded this month.</p>
          )}
          <p className={styles.footnote}>
            Costs are unavailable because model-specific pricing is not
            configured. Historical purpose is labeled unattributed where no
            purpose was recorded.
          </p>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Team performance</h2>
              <p>Recorded accepted human replies by actor</p>
            </div>
          </div>
          {!report.team.canView ? (
            <p className={styles.empty}>
              Team-level performance is available to business owners.
            </p>
          ) : report.team.agents.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Conversations</th>
                    <th>Accepted replies</th>
                    <th>Resolved</th>
                    <th>Median response</th>
                  </tr>
                </thead>
                <tbody>
                  {report.team.agents.map((agent, index) => (
                    <tr key={`${agent.name}-${index}`}>
                      <td>{agent.name}</td>
                      <td>{count(agent.conversationsHandled)}</td>
                      <td>{count(agent.acceptedReplies)}</td>
                      <td>{count(agent.resolvedConversations)}</td>
                      <td>{duration(agent.medianResponseSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>
              No human replies with recorded actor attribution in this period.
            </p>
          )}
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Channel performance</h2>
              <p>Interactions and CRM outcomes grouped by source</p>
            </div>
          </div>
          {report.channels.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Conversations</th>
                    <th>AI replies</th>
                    <th>Human replies</th>
                    <th>Median response</th>
                    <th>Qualified</th>
                    <th>Conversions</th>
                  </tr>
                </thead>
                <tbody>
                  {report.channels.map((channel) => (
                    <tr key={channel.channel}>
                      <td>
                        {channel.channel === 'WEBSITE'
                          ? 'Website chat'
                          : 'WhatsApp'}
                      </td>
                      <td>{count(channel.inboundConversations)}</td>
                      <td>{count(channel.acceptedAiResponses)}</td>
                      <td>{count(channel.humanResponses)}</td>
                      <td>{duration(channel.medianFirstResponseSeconds)}</td>
                      <td>{count(channel.qualifiedLeads)}</td>
                      <td>{count(channel.recordedConversions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>No channel activity in this range.</p>
          )}
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Monthly allowances</h2>
              <p>UTC calendar month, matching quota enforcement</p>
            </div>
          </div>
          <div className={styles.support}>
            {Object.entries(report.monthlyAllowances).map(([name, value]) => (
              <span key={name}>
                {name.replaceAll(/([A-Z])/g, ' $1')}
                <strong>
                  {value.remaining === null
                    ? 'Unlimited'
                    : `${count(value.remaining)} remaining`}
                </strong>
              </span>
            ))}
          </div>
          <p className={styles.footnote}>
            Quota-counted amounts include reservations and uncertain provider
            outcomes. Consumed usage above is shown separately.
          </p>
        </article>
      </section>
    </>
  );
}
