import { describe, expect, it } from 'vitest'
import { APPROVAL_BATCH_MAX, decideApprovalBatch } from '../server/approvalActions'
import { assertMovementTransition, nextStudentStatus } from '../server/movements'
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

describe('学籍异动状态机', () => {
  it('覆盖合法的状态流转', () => {
    expect(assertMovementTransition('active', 'suspend')).toBe('suspended')
    expect(assertMovementTransition('suspended', 'resume')).toBe('active')
    expect(assertMovementTransition('active', 'transfer_out')).toBe('transferred')
    expect(assertMovementTransition('suspended', 'transfer_out')).toBe('transferred')
    expect(assertMovementTransition('transferred', 'transfer_in')).toBe('active')
    expect(assertMovementTransition('active', 'graduate')).toBe('graduated')
    expect(nextStudentStatus('transfer_in')).toBe('active')
  })

  it('拒绝非法的状态流转', () => {
    expect(() => assertMovementTransition('suspended', 'suspend')).toThrow()
    expect(() => assertMovementTransition('active', 'resume')).toThrow()
    expect(() => assertMovementTransition('graduated', 'transfer_out')).toThrow()
    expect(() => assertMovementTransition('active', 'transfer_in')).toThrow()
    expect(() => assertMovementTransition('suspended', 'graduate')).toThrow()
  })
})

describe('全局搜索', () => {
  it('空关键词直接返回空数组，不触发数据库查询', async () => {
    expect(await searchSms(admin, { q: '   ' })).toEqual([])
    expect(await searchSms(admin, {})).toEqual([])
  })
})
