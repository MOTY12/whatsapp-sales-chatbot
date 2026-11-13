# Merchant business API

Use the existing OIDC browser session cookie. For POST and PATCH, send the configured merchant `Origin` and the CSRF cookie value in `X-CSRF-Token`. All requests and responses use JSON. The API sends `Cache-Control: no-store`.

| Method and path | Permission | Result |
| --- | --- | --- |
| `POST /merchant/businesses` | Signed-in merchant with CSRF proof | 201 with the business profile and owner role |
| `GET /merchant/businesses/:businessId` | Active owner, editor or agent membership on an active business | 200 with the profile and caller's role |
| `PATCH /merchant/businesses/:businessId` | Active owner on an active business, with CSRF proof | 200 with the updated profile and role |

`GET /auth/businesses/:businessId` returns the same profile with the same permissions. Staff retain their existing restricted permissions. Requests without a valid session receive 401. Invalid CSRF or insufficient role receives 403. A business outside the caller's active memberships receives 404.

POST requires `name`, `industry`, `phone` and `timezone`. PATCH accepts any nonempty subset of the profile fields. Text is trimmed and bounded to 120 characters for name, 80 for industry, 2,000 for description and 500 for opening hours. Phone must include a country code and is stored as a plus sign followed by digits. The timezone must be a recognized named IANA zone. Description and opening hours are optional free text and can be cleared with JSON null. Unknown fields and invalid values receive 400.

Responses include `id`, `name`, `status`, `role`, `industry`, `phone`, `timezone`, `description` and `openingHours`. Provider credentials and IDs, ownership identifiers and raw config stay private. The contact phone is independent of the WhatsApp connection.

## Retrying creation

Send a version 4 UUID in `Idempotency-Key`. Generate one key per intended business, then reuse it and the same profile for all retries. PostgreSQL keys the receipt by account and UUID. Equivalent normalized payloads return 201 with the same business ID and its current authorized profile. A different payload on the same key returns 409. A deleted or no-longer-accessible business returns 404 on an identical replay. Receipts have no time-based expiration. Different keys represent separate creation requests, even if the profile or phone matches.

## Deployment and rollback

Apply `AddMerchantOnboarding1760000000005` and rerun `npm run auth:grant` as the migration owner before serving the routes. The merchant login can execute three specific functions. It has no direct business or membership writes and no access to the receipt table or raw config. Creation derives the account from the active database session and commits the receipt, business and owner together. The PATCH function rechecks the scoped owner and locks that membership while applying an allowlisted update.

Roll back the application if necessary. The migration refuses to revert after onboarding data exists because reverting would discard replay protection or restore an incompatible WhatsApp-number constraint. Legacy WhatsApp registration still supplies its routing number and keeps its existing behavior.
