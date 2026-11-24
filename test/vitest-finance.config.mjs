// Run from the Nuxt-Admin host root after cloning this layer into modules/sms.
import base from '../../../test/config/vitest-contributions.config.mjs';
if (!process.env.SMS_FINANCE_TEST_DATABASE_URL) throw Error('Set SMS_FINANCE_TEST_DATABASE_URL to a migrated test database; .env is intentionally not loaded.');
process.env.SMS_FINANCE_TEST_SCHEMA = 'sms_finance_test_' + Date.now();
export default { ...base, test: { ...base.test, include: ['modules/sms/test/financeAccounting.test.ts'], hookTimeout: 30000, testTimeout: 20000 } };
