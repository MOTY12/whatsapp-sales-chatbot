# Product requirements

Kleva helps merchants turn inbound conversations into qualified sales opportunities. It answers from merchant-approved knowledge, suggests relevant offers, captures requirements, and hands exceptions to a person. A shared inbox and sales history give the merchant visibility across channels as official integrations become available.

## Initial buyer and scope

Start with Nigerian small businesses that already sell through WhatsApp, receive repetitive questions, and have a person available to take over. Prioritize retailers and appointment-based service providers with a stable offer list and a recognizable conversion event. Configure field labels and workflow templates for real estate (budget and viewing), logistics (route and parcel requirements), education (programme and intake), hospitality (dates and party size), and professional services (service and preferred time). Keep these templates as configuration. Each still uses the same consent, approval and ownership rules.

| Stage | Included |
| --- | --- |
| Paid pilot | One approved WhatsApp connection per business, owner and inbox agent access, setup checklist, approved FAQs/text/text-based PDF knowledge, native product/service catalog, playground, contextual text replies, lead qualification, inbox/handoff, opt-in automation, support/sales metrics, lightweight gap review and approval, usage caps and manual pilot invoicing |
| Expansion | Additional official channels, richer media, merchant-controlled lead scoring, draft orders, bookings, provider payment links and verified status, follow-up execution, billing automation and deeper analytics |
| Conditional | LinkedIn and TikTok business messaging only after written or account-specific confirmation of approved access and automation scope |

Pilot non-goals include mass outreach, automatic discounts, financial custody, enterprise CRM custom objects, cross-channel contact deduplication by inference, and autonomous actions that commit a customer to a purchase. A merchant can sell and collect payment through their current process, then mark the opportunity converted with evidence. No third-party CRM or inventory system is required.

## Journeys and acceptance

- Merchant signs in, creates or verifies a legacy business claim, connects the WhatsApp number, enters offers, publishes knowledge and tests the agent. The checklist shows connection, publication, playground, inbox staffing and usage cap. Activation requires all five. Merchant pauses automation immediately from the overview.
- Customer sends a message, sees AI disclosure and receives an answer grounded in approved data. The agent asks only necessary questions, records the lead after an allowed interaction, and offers human help. A pending human takeover fences queued AI replies. The customer can request an agent or stop follow-ups at any time.
- Agent sees a single tenant's inbox, reviews the evidence and lead, takes over, replies inside the channel window, and updates the opportunity. Owner can review gaps, correct offers and publish a revision. An unanswered question stays outside the published knowledge base until approved.
- Pilot support can connect a sandbox merchant, demonstrate a complete inbound-to-qualified journey, show all messages and outcomes in the inbox, and demonstrate rollback to human-only operation. Paid pilot requires invoice collection and merchant acknowledgement of support, privacy and channel terms.

## Measurements

Use merchant-local dates with UTC event timestamps. Track time from setup start to first successful playground and first approved live reply, connected-and-activated merchants, distinct inquiries, qualification rate (qualified opportunities / distinct sales inquiries), and manually recorded conversion rate (converted / qualified opportunities). Report model-assisted and human-only cohorts separately. Track p95 acknowledgement under 500 ms and p95 eligible response under 8 seconds as initial targets under declared pilot load, measured to provider acceptance. Track grounded-answer review, incorrect price/stock claims, handoff rate and time, opt-outs, cost per active merchant and paid retention. Define the scored evaluation set before activation. Target zero known cross-tenant exposure and zero verified unsupported price, stock or payment claims in release tests. Record pilot denominators and baselines before setting conversion uplift targets.

See [sales workflows](sales-workflows.md), [dashboard](merchant-dashboard.md) and [cost model](infrastructure-and-costs.md).
