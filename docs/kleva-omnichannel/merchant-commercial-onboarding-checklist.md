# Merchant commercial onboarding checklist

The dashboard checklist uses backend records. It does not infer completion from visiting a page.

## Commercial setup

- [ ] A business owner receives an offer with approved package/version, price, currency, duration, channels, allowances, support coverage and agreement-version reference.
- [ ] The owner reviews the approved agreement text outside the app and explicitly accepts the offer from Plan & Billing. Account registration is not acceptance.
- [ ] An authorized commercial operator approves the accepted offer and issues the manual invoice.
- [ ] Settlement is verified by a separate authorized confirmer; merchant-provided references remain unconfirmed claims.
- [ ] Agreed usage allowances are provisioned through the existing usage ledger with an idempotency key.
- [ ] Commercial status is activated explicitly after payment/allowance checks.

## Website-only setup

- [ ] Business profile is complete.
- [ ] At least one FAQ, product/service record or document is published.
- [ ] Assistant configuration exists and Playground has a completed test result.
- [ ] Website widget exists and an allowed domain is configured.
- [ ] Widget installation is checked manually; the platform currently has no backend signal to mark this step complete.
- [ ] Release and activation gates are reviewed independently; payment and commercial activation alone do not enable AI.
- [ ] WhatsApp connection and Meta approval are optional for the website-only package.

## WhatsApp add-on

- [ ] Verified WhatsApp connection and current policy/configuration requirements are satisfied.
- [ ] Merchant consent, existing WhatsApp pilot operator approval for the exact connection, quotas and other release gates are independently verified.

Team invitations and product catalog setup remain optional when not relevant. This checklist does not authorize production launch; follow applicable QA-002 and staging requirements.
