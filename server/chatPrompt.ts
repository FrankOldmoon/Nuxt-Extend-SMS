/**
 * SMS chat prompt — role context and capability usage rules.
 *
 * The prompt is generated from the *registered capability set* filtered by the
 * signed-in actor, so it can never drift from the real permission matrix again
 * (it previously hard-coded "students cannot write", which was wrong).
 */
import { capabilityPermissionMatches } from '../../../server/sdk'
import type { CapabilityDefinition } from '../../../server/sdk'
import { smsCapabilities } from './capabilities'
import { isSmsAdmin, type SmsActor } from './context'

const ROLE_HINTS: Record<string, string> = {
  admin: '管理员可见全组织数据，可执行全部能力。',
  teacher: '教师只能访问自己被分配班级的学生、选课与监护人；不能跨班操作。',
  student: '学生只能查看自己的档案、课表、成绩与考勤，可提交作业、选课和请假。',
  guardian: '监护人只能查看已关联学生的档案与考勤，可为孩子提交/取消请假。'
}

type Capability = CapabilityDefinition<SmsActor, unknown>

/** 能力权限形如 `sms.students.read`，这里按资源名聚合，便于模型快速定位。 */
function groupByResource(capabilities: readonly Capability[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const capability of capabilities) {
    const resource = capability.id.split('.')[1] ?? 'other'
    const list = groups.get(resource) ?? []
    list.push(`${capability.id}（${capability.title}）`)
    groups.set(resource, list)
  }
  return groups
}

function canRun(actor: SmsActor, capability: Capability): boolean {
  if (isSmsAdmin(actor)) return true
  if (!actor.organizationId) return false
  return capabilityPermissionMatches(actor.permissions ?? [], capability.permission)
}

function formatGroups(groups: Map<string, string[]>): string {
  if (groups.size === 0) return '（无）'
  return [...groups.entries()]
    .map(([resource, items]) => `${resource}：${items.join('；')}`)
    .join('\n')
}

export function buildSmsChatPrompt(context: unknown): string {
  const actor = context as SmsActor | undefined
  const role = actor?.roleName ?? '未知角色'
  const hint = ROLE_HINTS[role] ?? '只能访问当前组织内、角色允许的数据。'

  // 无 actor 上下文（例如构建期预览）时只给出通用规则，不虚构能力。
  const readable = actor
    ? smsCapabilities.filter(capability => capability.operation === 'query' && canRun(actor, capability))
    : []
  const writable = actor
    ? smsCapabilities.filter(capability => capability.operation === 'command' && canRun(actor, capability))
    : []

  return [
    `【SMS 学校信息管理】当前角色：${role}。${hint}`,
    '',
    '可用只读能力：',
    formatGroups(groupByResource(readable)),
    '',
    '可用写能力（会生成表单，用户确认后才执行）：',
    formatGroups(groupByResource(writable)),
    '',
    '工作流程：',
    '1. 用户提到学生、班级、教师或监护人姓名时，先用只读能力查到 ID，再执行写操作。',
    '2. 写能力执行前会生成草稿表单；用户确认前不要说操作已经完成。',
    '3. 删除学生、退费、成绩发布等高风险操作会触发审批或二次确认，不要尝试绕过。',
    '4. 审批相关问题优先使用 sms.approvals.list 获取统一收件箱，而不是逐个资源查询。',
    '5. 校规、制度类问题先查 sms.knowledge.search；回答时注明引用文章标题与更新时间。',
    '6. 查询结果为空时先确认姓名/学号/日期是否准确，再建议调整条件。',
    '7. 查询结果由界面以固定表格展示，请只回答结论与数量，不要输出 Markdown 表格或逐条复述字段。'
  ].join('\n')
}
