<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface ClassRow {
  id: number
  name: string
  academicYearName: string | null
  gradeName: string | null
}

useHead({ title: 'SMS 班级管理' })

const route = useRoute()
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const rows = ref<ClassRow[]>([])
const loading = ref(false)
const initialized = ref(false)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    rows.value = await $fetch<ClassRow[]>('/api/modules/sms/classes', {
      query: { q: search.value.trim() || undefined, limit: 200 }
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '班级列表加载失败'
  } finally {
    loading.value = false
    initialized.value = true
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void load(), 300)
})

onMounted(load)
onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-4xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            班级管理
          </h1>
          <p class="mt-1 text-xs text-muted">
            只展示当前用户可见的班级（教师为所授班级，学生/家长为关联班级）。
          </p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="load()"
        >
          刷新
        </UButton>
      </header>

      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索班级名称"
        class="w-64"
      />

      <p
        v-if="error"
        class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
      >
        {{ error }}
      </p>

      <div
        v-if="!initialized || (loading && rows.length === 0)"
        class="space-y-2"
      >
        <div
          v-for="index in 5"
          :key="index"
          class="h-12 animate-pulse rounded-lg border border-default bg-elevated/60"
        />
      </div>

      <p
        v-else-if="rows.length === 0"
        class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
      >
        没有符合条件的班级
      </p>

      <div
        v-else
        class="overflow-hidden rounded-xl border border-default"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-elevated/50 text-xs text-muted">
            <tr>
              <th class="px-3 py-2">
                班级
              </th>
              <th class="px-3 py-2">
                年级
              </th>
              <th class="px-3 py-2">
                学年
              </th>
              <th class="px-3 py-2 text-right">
                ID
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              class="border-t border-default"
            >
              <td class="px-3 py-2 text-highlighted">
                {{ row.name }}
              </td>
              <td class="px-3 py-2 text-toned">
                {{ row.gradeName ?? '—' }}
              </td>
              <td class="px-3 py-2 text-toned">
                {{ row.academicYearName ?? '—' }}
              </td>
              <td class="px-3 py-2 text-right text-xs text-muted">
                {{ row.id }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-center text-xs text-muted">
        共 {{ rows.length }} 个班级
      </p>
    </div>
  </div>
</template>
