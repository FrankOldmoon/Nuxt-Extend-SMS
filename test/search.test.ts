import { describe, expect, it } from 'vitest'
import { APPROVAL_BATCH_MAX, decideApprovalBatch } from '../server/approvalActions'
import { searchSms } from '../server/search'
import type { SmsActor } from '../server/context'

const admin: SmsActor = {
  userId: 1,
  organizationId: 1,
  tenantId: 1,
  roleName: 'admin',
  permissions: ['*']
}

describe('批量审批参数校验', () => {
  it('拒绝缺少 decision 的请求', async () => {
    await expect(decideApprovalBatch(admin, { items: [{ kind: 'leave', subjectId: 1 }] }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('拒绝空 items', async () => {
    await expect(decideApprovalBatch(admin, { decision: 'approve', items: [] }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('拒绝超过单次上限的请求', async () => {
    const items = Array.from({ length: APPROVAL_BATCH_MAX + 1 }, (_, index) => ({
      kind: 'leave',
      subjectId: index + 1
    }))
    await expect(decideApprovalBatch(admin, { decision: 'approve', items }))
      .rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('全局搜索', () => {
  it('空关键词直接返回空数组，不触发数据库查询', async () => {
    expect(await searchSms(admin, { q: '   ' })).toEqual([])
    expect(await searchSms(admin, {})).toEqual([])
  })
})
