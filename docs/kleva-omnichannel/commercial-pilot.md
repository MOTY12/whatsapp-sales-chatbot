# PILOT-001 — commercial pilot foundation

## Status

Commercial pilot records are implemented locally in migration `1760000000038`. Package terms are versioned, business offers snapshot the exact approved version, owners accept through their authenticated merchant session, operators issue manual invoices and confirm external payments, and entitlements write through the existing `UsageService` tables. A disposable PostgreSQL acceptance scenario passes. This is not evidence of a real paying merchant or final product/legal terms. PILOT-001 remains pending commercial acceptance and the release gates listed below.

The existing WhatsApp enrollment and `MerchantPilotService` are unchanged. A commercial agreement, paid invoice, or connected channel does not set the WhatsApp AI approval row or activate an assistant. Website-only packages need no Meta account, phone number, or WhatsApp allowance.

## Architecture

- PostgreSQL is authoritative for versioned package terms, offers, merchant agreement acceptance, invoices, payment records, entitlement events and immutable audit events.
- `commercial_pilot_capacity` starts unconfigured. Operators must set capacity before issuing offers. Its singleton row is locked while offers reserve capacity, so concurrent offers cannot exceed configured business, channel or usage caps.
- `commercial_pilot_package_versions` preserves each price/allowance/support version. An offered enrollment copies its terms; later package revisions do not change existing offers.
- Merchant read/accept uses `MerchantAccess` tenant/session context and a narrow `SECURITY DEFINER` function. Direct table grants are not provided to merchant roles; forced RLS remains enabled.
- Operator actions use an individual PostgreSQL login with separately granted `kleva_commercial_*_manager` groups and narrow database functions. There is no commercial operator browser identity, so the supported operator surface is the restricted CLI.
- Invoice/payment amounts are exact PostgreSQL `numeric(14,2)` NGN values. Confirmed payment records are changed only through an audited reversal; they are not deleted. References are unique per `reference_scope`.
- Allowances use the existing UTC monthly `UsageService` ledger/limit tables. Provisioning is transactionally idempotent, records prior/next limits, and refuses limits below current period reservations/consumption. It does not reset usage.
- A worker maintenance function marks overdue invoices and elapsed ACTIVE commercial records, writing audit events. The migration does not delete data or payment history.

## Merchant API and workspace

- `GET /merchant/businesses/:businessId/commercial`
- `GET /merchant/businesses/:businessId/commercial/readiness`
- `POST /merchant/businesses/:businessId/commercial/offers/:offerId/accept` with a UUID `requestKey`; owner role and CSRF/session checks are enforced.
- Dashboard page: `/dashboard/commercial` (“Plan & Billing”), with offer details, explicit owner acceptance, allowance summary, operational invoice history, confirmed payments and a backend-derived checklist.

Readiness checks persisted business profile, published knowledge, assistant configuration, completed Playground use, widget/domain state, commercial acceptance/approval, payment, entitlement provisioning, and WhatsApp connection/pilot approval only for WhatsApp packages. Team invitations and product catalog relevance are shown as optional. Widget installation is not marked verified because no backend installation signal exists. Release gates are always reported as outstanding until a release process supplies evidence. Readiness does not enable AI.

## Package and operator workflow

See [operator permissions](commercial-operator-permissions.md) and the [manual invoice/payment runbook](manual-invoice-payment-runbook.md). No final subscription prices are seeded. Package creation requires operator-supplied terms. Currency is NGN for this initial implementation; adding other currencies requires reviewed migration/API changes.

## Gaps and approval decisions

Product owner and counsel must approve the agreement version and text, public package descriptions, actual price, payment collection methods/reference scope, support channel/hours/timezone/escalation contact, maximum capacity and usage allocation, offer expiry, renewal/extension rules, overdue collection policy, notification schedule, privacy retention for evidence references, and what suspension/expiry means for live channel automation. No terms are invented here.

The expiry job changes commercial state and preserves history, but no service restriction policy has been approved or wired to website/WhatsApp AI execution. It therefore does not claim to suspend customer support or disable AI. Define that policy and add explicit channel execution gates before using expiry as a production restriction.

There is no operator dashboard, email notification workflow, invoice PDF/tax invoice, automated collection, financial accounting, support assignment UI, complete onboarding activation checklist, or automatic renewal. Existing merchant accounts and live flows are not changed by these records.

## Release boundary

Do not onboard a real paying merchant until an actual owner accepts approved price, caps, collection method and support coverage, and the applicable QA-002/staging gates pass. Website-only commercial release independence from Meta still needs product-owner approval as a release policy. See the [release readiness matrix](../kleva-mvp-30d/release-readiness-matrix.md).
