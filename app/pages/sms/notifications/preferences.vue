<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface Preference {
  category: string
  muted: boolean
}

const LABELS: Record<string, string> = {
  attendance: '考勤',
  leave: '请假',
  finance: '财务',
  approval: '审批',
  academic: '教学',
  system: '系统'
}

useHead({ title: 'SMS 通知偏好' })

const preferences = ref<Preference[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const message = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    preferences.value = await $fetch<Preference[]>('/api/modules/sms/notifications/preferences')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function toggle(row: Preference): Promise<void> {
  row.muted = !row.muted
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    preferences.value = await $fetch<Preference[]>('/api/modules/sms/notifications/preferences', {
      method: 'PUT',
      body: { preferences: preferences.value.map(item => ({ category: item.category, muted: item.muted })) }
    })
    message.value = '偏好已保存'
  } catch (err) {
    row.muted = !row.muted
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-2xl space-y-4">
      <header class="flex items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            通知偏好
          </h1>
          <p class="mt-1 text-xs text-muted">
            静音后该分类不再写入站内信，也不触发外部渠道。
          </p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-lucide-inbox"
          to="/sms/notifications"
        >
          返回收件箱
        </UButton>
      </header>

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        {{ error }}
      </p>
      <p
        v-if="message"
        class="rounded-lg border border-success/40 bg-success/10 p-3 text-xs text-success"
      >
        {{ message }}
      </p>

      <section class="divide-y divide-default rounded-xl border border-default bg-default">
        <div
          v-for="row in preferences"
          :key="row.category"
          class="flex items-center justify-between p-4"
        >
          <div>
            <p class="text-sm text-highlighted">
              {{ LABELS[row.category] ?? row.category }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ row.category }}
            </p>
          </div>
          <USwitch
            :model-value="!row.muted"
            :disabled="saving"
            @update:model-value="toggle(row)"
          />
        </div>
      </section>

      <p
        v-if="!loading && preferences.length === 0"
        class="text-center text-xs text-muted"
      >
        暂无可配置分类
      </p>
    </div>
  </div>
</template>
