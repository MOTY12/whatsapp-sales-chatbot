# Commercial operator permissions

Commercial operations are separate from `kleva_pilot_operator_*`, which only approves WhatsApp AI pilot enrollments. Commercial operators use one individually named PostgreSQL login `kleva_commercial_operator_<name>` and receive only reviewed permission groups. Do not use the HTTP runtime, merchant role, identity role, migration role, or a shared application login as an operator.

| Permission group | Allowed operations |
| --- | --- |
| `kleva_commercial_package_manager` | Create a package/version and approve a package version |
| `kleva_commercial_enrollment_manager` | Create an offer, approve an owner-accepted offer, activate commercial state after payment/entitlement checks |
| `kleva_commercial_invoice_manager` | Draft and issue invoices |
| `kleva_commercial_payment_recorder` | Record externally received payment claims |
| `kleva_commercial_payment_confirmer` | Confirm received payments and reverse a confirmed payment with a reason |
| `kleva_commercial_entitlement_manager` | Provision the accepted allowance snapshot idempotently |
| `kleva_commercial_capacity_manager` | Set pilot capacity and maximum usage allocations |

The migration revokes default `PUBLIC` execution and grants each function only to its matching group if that group exists. Functions check membership with `pg_has_role(session_user, ..., 'member')`; naming a login with the operator prefix does not grant authority. Group roles are created by `deploy/role-bootstrap.sql`. A database administrator must create each login and grant only the required groups, e.g. `GRANT kleva_commercial_invoice_manager TO kleva_commercial_operator_<name>;`. Use `INHERIT` for the operator login and a unique strong credential held by the operator. Keep database access private and rotate/revoke the individual login when access ends.

After membership is provisioned, configure `COMMERCIAL_OPERATOR_DATABASE_USER` and `COMMERCIAL_OPERATOR_DATABASE_PASSWORD`, then run `npm run commercial:grant-operator`. It verifies at least one recognized group and grants schema usage; it does not add permission groups. Run commands with `npm run commercial:operator -- <command> ...`. The CLI logs command/category only and never prints database credentials. It does not expose conversation content or customer data.

The operator user receives no table access. Merchant commercial reads/acceptance are session and tenant scoped. Audit rows are append-only. Keep payment evidence outside application logs; store only a safe external evidence reference.
