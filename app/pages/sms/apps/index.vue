<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface SmsApp {
  title: string
  description: string
  table: string
  icon: string
}

const apps: SmsApp[] = [
  { title: '学生', description: '学生档案、分班与状态维护', table: 'students', icon: 'i-lucide-graduation-cap' },
  { title: '班级', description: '班级、学年与年级归属', table: 'classes', icon: 'i-lucide-school' },
  { title: '选课', description: '学生选课记录与退课历史', table: 'enrollments', icon: 'i-lucide-clipboard-list' },
  { title: '教师', description: '教师档案与任课分配', table: 'teachers', icon: 'i-lucide-user-round-check' },
  { title: '监护人', description: '监护人与学生关联关系', table: 'guardians', icon: 'i-lucide-users-round' },
  { title: '学生-监护人', description: '关联关系明细与主要联系人', table: 'studentGuardians', icon: 'i-lucide-link' },
  { title: '学年', description: '学年与当前学年设置', table: 'academicYears', icon: 'i-lucide-calendar-range' },
  { title: '学期', description: '学期与起止日期', table: 'terms', icon: 'i-lucide-calendar-days' },
  { title: '年级', description: '年级层级维护', table: 'grades', icon: 'i-lucide-layers' },
  { title: '科目', description: '科目编码与名称', table: 'subjects', icon: 'i-lucide-book-open' }
]
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-5">
    <div class="mx-auto max-w-4xl">
      <h1 class="text-lg font-semibold text-highlighted">
        应用
      </h1>
      <p class="mt-1 text-sm text-muted">
        传统表格入口。所有业务能力与聊天共用同一套服务端权限与审计。
      </p>

      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="app in apps"
          :key="app.table"
          :to="`/dashboard/${app.table}`"
          class="group rounded-xl border border-default bg-default p-4 transition-colors hover:border-primary"
        >
          <div class="flex items-center gap-2">
            <div class="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <UIcon
                :name="app.icon"
                class="size-4 text-primary"
              />
            </div>
            <p class="text-sm font-medium text-highlighted">
              {{ app.title }}
            </p>
            <UIcon
              name="i-lucide-arrow-up-right"
              class="ml-auto size-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
          <p class="mt-2 text-xs text-muted">
            {{ app.description }}
          </p>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
