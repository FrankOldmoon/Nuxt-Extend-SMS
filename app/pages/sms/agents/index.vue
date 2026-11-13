<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface AgentTemplate {
  id: string
  title: string
  description: string
  icon: string
  prompt: string
}

const agents: AgentTemplate[] = [
  {
    id: 'new-enrollment',
    title: '新生入学',
    description: '查询班级、创建学生并完成分班选课。每一步写入都需要表单确认。',
    icon: 'i-lucide-user-plus',
    prompt: '帮我办理新生入学：先列出当前学年可见的班级，然后为学生「张三」（学号 S2026001）创建档案并加入七年级 A 班。'
  },
  {
    id: 'class-students',
    title: '班级学生查询',
    description: '查看某个班级的学生名单与选课状态。',
    icon: 'i-lucide-users',
    prompt: '列出七年级 A 班的学生名单，并告诉我每个学生的学号。'
  },
  {
    id: 'teacher-courses',
    title: '教师任课查询',
    description: '查询教师本学期任教的班级与科目。',
    icon: 'i-lucide-book-user',
    prompt: '查询教师「李老师」本学期的任课班级和科目。'
  }
]

function start(agent: AgentTemplate): void {
  void navigateTo({ path: '/sms/chat', query: { prompt: agent.prompt } })
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-5">
    <div class="mx-auto max-w-3xl">
      <h1 class="text-lg font-semibold text-highlighted">
        Agent 模板
      </h1>
      <p class="mt-1 text-sm text-muted">
        每个模板是一段预置的对话目标，工具集与审批策略仍然由服务端权限决定。
      </p>

      <div class="mt-5 space-y-3">
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="flex items-start gap-3 rounded-xl border border-default bg-default p-4"
        >
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <UIcon
              :name="agent.icon"
              class="size-4 text-primary"
            />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-highlighted">
              {{ agent.title }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-muted">
              {{ agent.description }}
            </p>
          </div>
          <UButton
            size="sm"
            variant="soft"
            @click="start(agent)"
          >
            开始
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
