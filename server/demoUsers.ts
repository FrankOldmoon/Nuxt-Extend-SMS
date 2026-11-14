/**
 * Dev/test demo accounts for SMS role e2e.
 *
 * Playwright expects `teacher@example.com` / `guardian@example.com` /
 * `finance@example.com` to sign in and hit the module APIs. Seeding is gated by
 * `SEED_SMS_DEMO_USERS=true` and never runs in production, so deployments do
 * not receive well-known credentials.
 */
import { pool } from '../../../server/sdk'
import { hashPassword } from '../../../server/utils/password'

interface DemoAccount {
  email: string
  username: string
  name: string
  role: string
  password: string
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'teacher@example.com', username: 'e2e_teacher', name: 'E2E Teacher', role: 'teacher', password: 'Teacher@123' },
  { email: 'guardian@example.com', username: 'e2e_guardian', name: 'E2E Guardian', role: 'guardian', password: 'Guardian@123' },
  { email: 'finance@example.com', username: 'e2e_finance', name: 'E2E Finance', role: 'finance', password: 'Finance@123' }
]

export async function ensureSmsDemoUsers(): Promise<{ created: string[], skipped: string[] }> {
  const created: string[] = []
  const skipped: string[] = []
  if (process.env.NODE_ENV === 'production' || process.env.SEED_SMS_DEMO_USERS !== 'true') {
    return { created, skipped: DEMO_ACCOUNTS.map(account => account.email) }
  }

  const orgResult = await pool.query<{ id: number }>('SELECT id FROM organizations ORDER BY id LIMIT 1')
  const organizationId = orgResult.rows[0]?.id
  if (!organizationId) return { created, skipped: DEMO_ACCOUNTS.map(account => account.email) }

  for (const account of DEMO_ACCOUNTS) {
    const roleResult = await pool.query<{ id: number }>('SELECT id FROM roles WHERE name = $1 LIMIT 1', [account.role])
    const roleId = roleResult.rows[0]?.id
    if (!roleId) {
      skipped.push(account.email)
      continue
    }

    const existing = await pool.query<{ id: number }>('SELECT id FROM users WHERE email = $1 LIMIT 1', [account.email])
    let userId = existing.rows[0]?.id
    if (!userId) {
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO users (username, name, email, password_hash, is_active, role_id, email_verified_at)
         VALUES ($1, $2, $3, $4, true, $5, now())
         RETURNING id`,
        [account.username, account.name, account.email, hashPassword(account.password), roleId]
      )
      userId = inserted.rows[0]?.id
      if (userId) created.push(account.email)
    }
    if (!userId) {
      skipped.push(account.email)
      continue
    }

    await pool.query(
      `INSERT INTO organization_memberships (user_id, organization_id, role_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (user_id, organization_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active'`,
      [userId, organizationId, roleId]
    )
  }
  return { created, skipped }
}
