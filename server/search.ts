/**
 * 全局搜索（⌘K 命令面板）。
 *
 * 一次请求聚合学生、班级、知识库和通知；每一类都复用各自领域服务的权限与
 * 数据范围，权限不足时静默返回空，避免前端拿到越权数据或报错。
 */
import { canUseSms, type SmsActor } from './context'
import { searchStudents } from './students'
import { listClasses } from './academics'
import { searchKnowledge } from './knowledge'
import { listNotifications } from './notifications'

export type SmsSearchType = 'student' | 'class' | 'knowledge' | 'notification'

export interface SmsSearchItem {
  type: SmsSearchType
  id: number
  title: string
  subtitle: string | null
  link: string
}

export interface SmsSearchOptions {
  q?: unknown
  limit?: unknown
}

function clampLimit(value: unknown, fallback = 5): number {
  const number = Number(value ?? fallback)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.floor(number), 1), 20)
}

function safeLink(link: string | null | undefined): string {
  return link && link.startsWith('/') && !link.startsWith('//') ? link : '/sms/notifications'
}

export async function searchSms(actor: SmsActor, options: SmsSearchOptions = {}): Promise<SmsSearchItem[]> {
  const query = typeof options.q === 'string' ? options.q.trim().slice(0, 80) : ''
  if (!query) return []
  const limit = clampLimit(options.limit)

  const [students, classes, articles, notifications] = await Promise.all([
    canUseSms(actor, 'read', 'students')
      ? searchStudents(actor, { query, limit }).catch(() => [])
      : Promise.resolve([]),
    canUseSms(actor, 'read', 'classes')
      ? listClasses(actor, { query, limit }).catch(() => [])
      : Promise.resolve([]),
    canUseSms(actor, 'read', 'knowledge')
      ? searchKnowledge(actor, { query, limit }).catch(() => [])
      : Promise.resolve([]),
    canUseSms(actor, 'read', 'notifications')
      ? listNotifications(actor, { query, limit }).catch(() => [])
      : Promise.resolve([])
  ])

  const items: SmsSearchItem[] = []
  for (const row of students) {
    items.push({
      type: 'student',
      id: row.id,
      title: row.name,
      subtitle: [row.studentNo, row.className].filter(Boolean).join(' · ') || null,
      link: `/sms/students?q=${encodeURIComponent(row.studentNo || row.name)}`
    })
  }
  for (const row of classes) {
    items.push({
      type: 'class',
      id: row.id,
      title: row.name,
      subtitle: '班级',
      link: `/sms/classes?q=${encodeURIComponent(row.name)}`
    })
  }
  for (const row of articles) {
    items.push({
      type: 'knowledge',
      id: row.id,
      title: row.title,
      subtitle: row.tags ?? '知识库',
      link: `/sms/knowledge?q=${encodeURIComponent(query)}`
    })
  }
  for (const row of notifications) {
    items.push({
      type: 'notification',
      id: row.id,
      title: row.title,
      subtitle: row.body ?? row.category,
      link: safeLink(row.link)
    })
  }
  return items
}
