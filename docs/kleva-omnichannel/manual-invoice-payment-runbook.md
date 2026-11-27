# Manual pilot invoice and payment runbook

These are internal operational records for pilot collection. They are not legally reviewed tax invoices and do not charge a customer. Simulated test references are not payment confirmations.

## Before operating

1. Obtain approved commercial terms, merchant acceptance evidence and the approved collection method.
2. Confirm a unique operator login and only the package/enrollment/invoice/payment permission groups required for the task.
3. Confirm the offer is accepted, business ID and package-version ID from a reviewed secure operator record, and the capacity configuration is current.
4. Never put card numbers, PINs, banking credentials, raw customer data or sensitive evidence in CLI arguments or logs.

## Commands

Run `npm run commercial:operator -- <command> ...` with `COMMERCIAL_OPERATOR_DATABASE_USER` and `COMMERCIAL_OPERATOR_DATABASE_PASSWORD` set in the operator's protected environment. `commercial:operator` builds before execution.

1. Set approved business/channel/duration/usage limits with `capacity-set <max-businesses> <max-website> <max-whatsapp> <max-days> <max-input-tokens> <max-output-tokens> <max-embedding-tokens> <max-whatsapp-outbound>`.
2. Create a draft package with `package-create <key> <name> <description> <price> <PILOT|MONTHLY> <days> <WEBSITE|WHATSAPP|WEBSITE,WHATSAPP> '<allowances-json>' <per-request-tokens> '<support-json>'`. Price must have at most two decimal places. The allowance JSON has `aiInputTokens`, `aiOutputTokens`, `embeddingTokens`, and `whatsappOutbound`. No default price is provided.
3. Approve the returned version UUID using `package-approve <version-id>`. For future pricing/term changes use `package-version <package-id> ...` then approve the new version; never edit an existing version.
4. Prepare an offer with `offer-create <business-id> <package-version-id> <idempotency-uuid> <agreement-version> <support-owner>`. The owner reviews and accepts through Plan & Billing.
5. Approve a merchant-accepted offer with `offer-approve <enrollment-id> <ISO-start-timestamp>`.
6. Draft and issue an invoice with `invoice-create <enrollment-id> <unique-reference> <ISO-due-timestamp> <description>` then `invoice-issue <invoice-id>`.
7. Record a payment only after checking the approved collection source with `payment-record <invoice-id> <amount> <BANK_TRANSFER|EXTERNAL_REFERENCE|MANUAL_GATEWAY_CONFIRMATION> <reference-scope> <external-reference> <ISO-received-timestamp> <safe-evidence-reference>`. Recording is an unverified claim.
8. A separately authorized payment confirmer checks settlement and calls `payment-confirm <payment-id>`. Partial payments are supported. Currency is inherited from the invoice; excess allocation is rejected.
9. Reverse a mistaken confirmed record only through `payment-reverse <payment-id> <reason>`. This appends audit history and recalculates the invoice balance; do not delete or overwrite financial history.
10. After payment, explicitly provision agreed limits with `entitlement-provision <enrollment-id> <stable-idempotency-uuid>`, then activate commercial status with `offer-activate <enrollment-id>`. This does not activate AI or WhatsApp.

Use a new stable idempotency UUID for each intentional entitlement amendment. A retry must reuse the same key. A changed package requires a new version and explicit merchant acceptance. The CLI never sends an automatic charge request.

## Reconciliation

Check Plan & Billing after invoice issue/confirmation. Reconcile invoice `amount`, `paid_amount`, payment status and audit reference against the external settlement source. Never mark a merchant payment claim as confirmed without settlement evidence. Do not represent a provider or bank receipt as confirmed if it is still pending.
