# Integration and validation

Install this repository as `modules/sms` inside Nuxt-Admin. This module is not a separate frontend/backend application and uses the host dependency installation.

The UI contribution requires the matching Nuxt-Admin contribution: DashboardBusinessTable, compact DashboardCrudPage with filter/action slots and metadata permissions, filtered exports and shared pagination behavior. Merge or check out the host contribution before this module branch. Refund accounting services and its migration do not depend on those UI components.

From the host root:

```sh
pnpm test:contributions
```

The host configuration discovers this module's `test/recordReuse.test.ts` and `test/refundAccounting.test.ts` when present.

## Explicit database test

Use a PostgreSQL test database with SMS migrations applied. Set SMS_FINANCE_TEST_DATABASE_URL in the process environment, then run from the host root:

```sh
pnpm exec vitest run --config modules/sms/test/vitest-finance.config.mjs --configLoader native
```

This configuration intentionally does not read `.env` or default to DATABASE_URL. It creates a unique sms_finance_test_* schema, copies table structures (not business data), uses its own sequences, and removes that schema after testing. Notifications and audit delivery are mocked; invoice/payment/refund/approval-task persistence uses real PostgreSQL transactions. Tests cover fee cancellation, payment return, rejection, explicit choice, duplicate approval, cumulative over-refunds and concurrent collections.

See `refund-accounting.md` for the additive migration and historical refund behavior. This contribution includes no student datasets, database dumps, local credentials or live approvals.
