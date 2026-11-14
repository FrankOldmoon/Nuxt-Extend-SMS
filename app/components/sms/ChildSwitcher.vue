<script setup lang="ts">
/**
 * 家长多子女切换器。
 *
 * 子女列表由服务端按 `sms_student_guardians` 返回，非家长角色为空数组，
 * 组件会自动隐藏；页面把选中的 studentId 传给接口，服务端仍会再次校验。
 */
interface ChildRow {
  id: number
  name: string
  studentNo: string
  classId: number | null
  className: string | null
  status: string
}

const STORAGE_KEY = 'sms.guardianChildId'

const model = defineModel<number | null>({ default: null })
const emit = defineEmits<{ select: [child: ChildRow | null] }>()

const children = ref<ChildRow[]>([])
const loading = ref(true)
const value = ref('')

const options = computed(() => children.value.map(child => ({
  label: `${child.name}（${child.studentNo}${child.className ? ` · ${child.className}` : ''}）`,
  value: String(child.id)
})))

function syncChild(id: string): void {
  const numeric = Number(id)
  const child = children.value.find(item => item.id === numeric) ?? null
  model.value = child?.id ?? null
  emit('select', child)
  if (child) {
    try {
      localStorage.setItem(STORAGE_KEY, String(child.id))
    } catch {
      // localStorage 不可用时仅保留内存状态。
    }
  }
}

onMounted(async () => {
  try {
    children.value = await $fetch<ChildRow[]>('/api/modules/sms/guardian/children')
  } catch {
    children.value = []
  } finally {
    loading.value = false
  }
  if (children.value.length === 0) return
  let stored = ''
  try {
    stored = localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    stored = ''
  }
  const preferred = children.value.find(item => String(item.id) === stored) ?? children.value[0]!
  value.value = String(preferred.id)
  model.value = preferred.id
  emit('select', preferred)
})

watch(model, (next) => {
  if (next === null) {
    value.value = ''
  } else if (String(next) !== value.value) {
    value.value = String(next)
  }
})
</script>

<template>
  <div
    v-if="!loading && children.length > 1"
    class="flex items-center gap-2"
  >
    <span class="text-xs text-muted">当前子女</span>
    <USelect
      :model-value="value"
      :items="options"
      value-key="value"
      class="w-56"
      @update:model-value="syncChild(String($event))"
    />
  </div>
</template>
