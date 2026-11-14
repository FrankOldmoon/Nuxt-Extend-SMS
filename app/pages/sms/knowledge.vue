<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface KnowledgeRow {
  id: number
  title: string
  content: string
  snippet: string
  tags: string | null
  audience: string
  status: string
  updatedAt: string
}

useHead({ title: 'SMS 知识库管理' })

const status = ref<'published' | 'draft' | 'archived'>('published')
const query = ref('')
const rows = ref<KnowledgeRow[]>([])
const loading = ref(false)
const error = ref('')
const message = ref('')

const form = reactive({
  title: '',
  content: '',
  tags: '',
  audience: 'all',
  status: 'published'
})
const saving = ref(false)
const editingId = ref<number | null>(null)
const preview = ref(false)

/** 进入编辑：把列表行回填到表单，并切到预览关闭状态。 */
function startEdit(row: KnowledgeRow): void {
  editingId.value = row.id
  form.title = row.title
  form.content = row.content
  form.tags = row.tags ?? ''
  form.audience = row.audience
  form.status = row.status
  preview.value = false
}

function resetForm(): void {
  editingId.value = null
  form.title = ''
  form.content = ''
  form.tags = ''
  form.audience = 'all'
  form.status = 'published'
  preview.value = false
}

const audiences = [
  { label: '所有人', value: 'all' },
  { label: '教职工', value: 'staff' },
  { label: '学生', value: 'student' },
  { label: '家长', value: 'guardian' }
]

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    rows.value = await $fetch<KnowledgeRow[]>('/api/modules/sms/knowledge', {
      query: { status: status.value, query: query.value || undefined, limit: 50 }
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function createArticle(): Promise<void> {
  saving.value = true
  error.value = ''
  message.value = ''
  const editing = editingId.value !== null
  try {
    if (editing) {
      await $fetch('/api/modules/sms/knowledge/update', {
        method: 'POST',
        body: { articleId: editingId.value, ...form }
      })
      message.value = '文章已更新'
    } else {
      await $fetch('/api/modules/sms/knowledge', {
        method: 'POST',
        body: { ...form }
      })
      message.value = '文章已创建'
    }
    resetForm()
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : (editing ? '更新失败' : '创建失败')
  } finally {
    saving.value = false
  }
}

async function setStatus(row: KnowledgeRow, next: 'published' | 'archived'): Promise<void> {
  error.value = ''
  try {
    await $fetch('/api/modules/sms/knowledge/update', {
      method: 'POST',
      body: { articleId: row.id, status: next }
    })
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '更新失败'
  }
}

function switchStatus(next: typeof status.value): void {
  status.value = next
  void load()
}

onMounted(load)
</script>

<template>
  <div class="p-4">
    <div class="mx-auto max-w-4xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            知识库管理
          </h1>
          <p class="mt-1 text-xs text-muted">
            校规与流程文章；下架后不再参与检索，但保留引用记录。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-for="option in ['published', 'draft', 'archived'] as const"
            :key="option"
            size="xs"
            :variant="status === option ? 'solid' : 'soft'"
            @click="switchStatus(option)"
          >
            {{ option === 'published' ? '已发布' : option === 'draft' ? '草稿' : '已下架' }}
          </UButton>
        </div>
      </header>

      <p v-if="error" class="rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error">
        {{ error }}
      </p>
      <p v-if="message" class="rounded-lg border border-success/40 bg-success/10 p-3 text-xs text-success">
        {{ message }}
      </p>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium text-highlighted">
            {{ editingId === null ? '新建文章' : `编辑文章 #${editingId}` }}
          </h2>
          <UButton
            v-if="editingId !== null"
            size="xs"
            variant="ghost"
            @click="resetForm()"
          >
            取消编辑
          </UButton>
        </div>
        <UInput v-model="form.title" placeholder="标题" class="w-full" />
        <div class="flex items-center justify-end">
          <UButton size="xs" variant="ghost" @click="preview = !preview">
            {{ preview ? '继续编辑' : '预览' }}
          </UButton>
        </div>
        <div
          v-if="preview"
          class="min-h-24 whitespace-pre-wrap rounded-lg border border-default bg-elevated/40 p-3 text-sm text-toned"
        >
          {{ form.content || '（暂无内容）' }}
        </div>
        <UTextarea v-else v-model="form.content" placeholder="正文" :rows="6" class="w-full" />
        <div class="grid gap-2 sm:grid-cols-3">
          <UInput v-model="form.tags" placeholder="标签（逗号分隔）" />
          <USelect v-model="form.audience" :items="audiences" value-key="value" />
          <USelect
            v-model="form.status"
            :items="[{ label: '发布', value: 'published' }, { label: '草稿', value: 'draft' }]"
            value-key="value"
          />
        </div>
        <UButton :loading="saving" @click="createArticle()">
          {{ editingId === null ? '保存' : '更新' }}
        </UButton>
      </section>

      <section class="space-y-2">
        <div class="flex items-center gap-2">
          <UInput v-model="query" placeholder="搜索标题/正文/标签" class="flex-1" @keyup.enter="load()" />
          <UButton size="sm" :loading="loading" @click="load()">
            搜索
          </UButton>
        </div>

        <p v-if="!loading && rows.length === 0" class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted">
          暂无文章
        </p>

        <ul class="space-y-2">
          <li
            v-for="row in rows"
            :key="row.id"
            class="rounded-xl border border-default bg-default p-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ row.title }}
                </p>
                <p class="mt-1 text-xs text-muted">
                  {{ row.audience }} · {{ row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—' }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  size="xs"
                  variant="ghost"
                  @click="startEdit(row)"
                >
                  编辑
                </UButton>
                <UButton
                  size="xs"
                  variant="ghost"
                  @click="setStatus(row, status === 'archived' ? 'published' : 'archived')"
                >
                  {{ status === 'archived' ? '重新发布' : '下架' }}
                </UButton>
              </div>
            </div>
            <p class="mt-2 line-clamp-3 text-xs text-muted">
              {{ row.snippet }}
            </p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
