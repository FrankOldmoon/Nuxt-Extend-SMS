import { describe, expect, it } from 'vitest'
import { formatPrometheusMetrics, type SmsMetrics } from '../server/observability'

const metrics: SmsMetrics = {
  generatedAt: '2026-11-14T05:00:00.000Z',
  notifications: { total: 12, unread: 3 },
  approvals: { pending: 2, overdue: 1 },
  imports: { batches: 4 },
  agents: { failed: 1, running: 2 },
  knowledge: { published: 5 },
  outbox: { pending: 4, failed: 1 },
  jobs: { pending: 3, failed: 2 }
}

describe('formatPrometheusMetrics', () => {
  it('emits help/type/value lines with the organization label', () => {
    const text = formatPrometheusMetrics(metrics, 7)
    expect(text).toContain('# TYPE sms_notifications_total gauge')
    expect(text).toContain('sms_notifications_total{organization_id="7"} 12')
    expect(text).toContain('sms_notification_outbox_pending{organization_id="7"} 4')
    expect(text).toContain('sms_background_jobs_failed{organization_id="7"} 2')
  })

  it('omits the label when no organization is given', () => {
    const text = formatPrometheusMetrics(metrics)
    expect(text).toContain('sms_notifications_unread 3')
    expect(text).toContain('sms_metrics_generated_at_seconds 1794632400')
    expect(text.endsWith('\n')).toBe(true)
  })
})
