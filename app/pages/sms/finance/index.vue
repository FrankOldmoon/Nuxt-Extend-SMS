<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'sms' })

interface InvoiceRow {
  id: number
  studentId: number
  studentName: string | null
  studentNo: string | null
  feeItemId: number
  feeName: string | null
  amount: number
  discount: number
  payable: number
  paid: number
  status: string
  dueDate: string | null
}

interface PaymentRow {
  id: number
  invoiceId: number
  studentId: number
  studentName: string | null
  studentNo: string | null
  feeName: string | null
  amount: number
  method: string
  reference: string | null
  paidAt: string
}

interface ReconciliationRow {
  id: number
  periodStart: string
  periodEnd: string
  method: string | null
  status: string
  paymentCount: number
  totalAmount: number
  notes: string | null
  confirmedAt: string | null
  createdAt: string
}

const PAYMENT_METHODS = [
  { label: '现金', value: 'cash' },
  { label: '转账', value: 'transfer' },
  { label: '微信', value: 'wechat' },
  { label: '支付宝', value: 'alipay' },
  { label: '其他', value: 'other' }
]
const METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS.map(item => [item.value, item.label]))
const INVOICE_STATUS: Record<string, { label: string, color: 'error' | 'warning' | 'success' | 'neutral' }> = {
  unpaid: { label: '未缴', color: 'error' },
  partial: { label: '部分缴', color: 'warning' },
  paid: { label: '已缴清', color: 'success' },
  void: { label: '已作废', color: 'neutral' }
}

useHead({ title: 'SMS 财务对账' })

const { can } = useSmsPermission()
const canWrite = computed(() => can('finance', 'update'))

const invoices = ref<InvoiceRow[]>([])
const payments = ref<PaymentRow[]>([])
const reconciliations = ref<ReconciliationRow[]>([])
const invoiceStatus = ref('unpaid')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')

const selectedInvoice = ref<InvoiceRow | null>(null)
const paymentForm = reactive({ amount: '', method: 'cash', reference: '' })

const reconciliationForm = reactive({
  periodStart: '',
  periodEnd: '',
  method: '',
  notes: ''
})

const today = new Date()

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function money(value: number): string {
  return `¥${value.toFixed(2)}`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function errorText(value: unknown): string {
  if (value && typeof value === 'object') {
    const data = (value as { data?: { message?: unknown } }).data
    if (data && typeof data.message === 'string') return data.message
    const direct = (value as { message?: unknown }).message
    if (typeof direct === 'string') return direct
  }
  return '操作失败，请稍后重试'
}

function outstanding(row: InvoiceRow): number {
  return Math.max(0, Math.round((row.payable - row.paid) * 100) / 100)
}

function openPayment(row: InvoiceRow): void {
  selectedInvoice.value = row
  paymentForm.amount = outstanding(row).toFixed(2)
  paymentForm.method = 'cash'
  paymentForm.reference = ''
}

async function loadInvoices(): Promise<void> {
  try {
    invoices.value = await $fetch<InvoiceRow[]>('/api/modules/sms/invoices', {
      query: {
        status: invoiceStatus.value || undefined,
        limit: 200
      }
    })
  } catch (value) {
    error.value = errorText(value)
    invoices.value = []
  }
}

async function loadPayments(): Promise<void> {
  try {
    payments.value = await $fetch<PaymentRow[]>('/api/modules/sms/payments', {
      query: { limit: 100 }
    })
  } catch {
    payments.value = []
  }
}

async function loadReconciliations(): Promise<void> {
  try {
    reconciliations.value = await $fetch<ReconciliationRow[]>('/api/modules/sms/reconciliations', {
      query: { limit: 100 }
    })
  } catch {
    reconciliations.value = []
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  await Promise.all([loadInvoices(), loadPayments(), loadReconciliations()])
  loading.value = false
}

async function submitPayment(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!selectedInvoice.value) return
  const amount = Number(paymentForm.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    error.value = '缴费金额必须大于 0'
    return
  }
  saving.value = true
  try {
    await $fetch('/api/modules/sms/payments', {
      method: 'POST',
      body: {
        invoiceId: selectedInvoice.value.id,
        amount,
        method: paymentForm.method,
        reference: paymentForm.reference.trim() || undefined
      }
    })
    message.value = '缴费已登记'
    selectedInvoice.value = null
    await Promise.all([loadInvoices(), loadPayments()])
  } catch (value) {
    error.value = errorText(value)
  } finally {
    saving.value = false
  }
}

async function createReconciliation(): Promise<void> {
  error.value = ''
  message.value = ''
  if (!reconciliationForm.periodStart || !reconciliationForm.periodEnd) {
    error.value = '请选择对账区间'
    return
  }
  saving.value = true
  try {
    const row = await $fetch<ReconciliationRow>('/api/modules/sms/reconciliations', {
      method: 'POST',
      body: {
        periodStart: reconciliationForm.periodStart,
        periodEnd: reconciliationForm.periodEnd,
        method: reconciliationForm.method || undefined,
        notes: reconciliationForm.notes.trim() || undefined
      }
    })
    message.value = `已生成对账批次：${row.paymentCount} 笔，合计 ${money(row.totalAmount)}`
    reconciliationForm.notes = ''
    await loadReconciliations()
  } catch (value) {
    error.value = errorText(value)
  } finally {
    saving.value = false
  }
}

async function confirmReconciliation(row: ReconciliationRow): Promise<void> {
  error.value = ''
  message.value = ''
  try {
    await $fetch('/api/modules/sms/reconciliations/confirm', {
      method: 'POST',
      body: { reconciliationId: row.id }
    })
    message.value = `对账批次 #${row.id} 已确认`
    await loadReconciliations()
  } catch (value) {
    error.value = errorText(value)
  }
}

watch(invoiceStatus, () => void loadInvoices())

onMounted(async () => {
  reconciliationForm.periodStart = localDate(new Date(today.getFullYear(), today.getMonth(), 1))
  reconciliationForm.periodEnd = localDate(today)
  await refresh()
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-6xl space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-highlighted">
            财务对账
          </h1>
          <p class="mt-1 text-xs text-muted">
            线下缴费登记与对账批次；本模块不接真实支付网关，流水号由收费人手工录入。
          </p>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="refresh()"
        >
          刷新
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

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-highlighted">
            应收账单
          </h2>
          <USelect
            v-model="invoiceStatus"
            :items="[
              { label: '未缴', value: 'unpaid' },
              { label: '部分缴', value: 'partial' },
              { label: '已缴清', value: 'paid' },
              { label: '已作废', value: 'void' },
              { label: '全部状态', value: '' }
            ]"
            value-key="value"
            class="w-40"
          />
        </div>

        <div
          v-if="selectedInvoice"
          class="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
        >
          <p class="text-xs text-muted">
            为
            <span class="text-highlighted">{{ selectedInvoice.studentName ?? `#${selectedInvoice.studentId}` }}</span>
            登记缴费 · 应收 {{ money(selectedInvoice.payable) }} · 未缴 {{ money(outstanding(selectedInvoice)) }}
          </p>
          <div class="grid gap-2 sm:grid-cols-4">
            <label class="space-y-1 text-xs text-muted">
              <span>金额 *</span>
              <UInput
                v-model="paymentForm.amount"
                type="number"
                min="0.01"
                step="0.01"
                class="w-full"
              />
            </label>
            <label class="space-y-1 text-xs text-muted">
              <span>方式</span>
              <USelect
                v-model="paymentForm.method"
                :items="PAYMENT_METHODS"
                value-key="value"
              />
            </label>
            <label class="space-y-1 text-xs text-muted">
              <span>流水号</span>
              <UInput
                v-model="paymentForm.reference"
                placeholder="可选"
                class="w-full"
              />
            </label>
            <div class="flex items-end gap-2">
              <UButton
                :loading="saving"
                icon="i-lucide-check"
                @click="submitPayment()"
              >
                确认收款
              </UButton>
              <UButton
                variant="ghost"
                color="neutral"
                @click="selectedInvoice = null"
              >
                取消
              </UButton>
            </div>
          </div>
        </div>

        <div
          v-if="invoices.length === 0"
          class="rounded-lg border border-dashed border-default px-3 py-4 text-center text-xs text-muted"
        >
          当前筛选条件下暂无账单
        </div>
        <div
          v-else
          class="overflow-x-auto rounded-lg border border-default"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2">
                  学生
                </th>
                <th class="px-3 py-2">
                  收费项
                </th>
                <th class="px-3 py-2">
                  应收
                </th>
                <th class="px-3 py-2">
                  已收
                </th>
                <th class="px-3 py-2">
                  状态
                </th>
                <th class="px-3 py-2">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in invoices"
                :key="row.id"
                class="border-t border-default"
              >
                <td class="px-3 py-2">
                  <p class="text-highlighted">
                    {{ row.studentName ?? `#${row.studentId}` }}
                  </p>
                  <p class="font-mono text-xs text-muted">
                    {{ row.studentNo ?? '—' }}
                  </p>
                </td>
                <td class="px-3 py-2 text-toned">
                  {{ row.feeName ?? `#${row.feeItemId}` }}
                  <p class="text-xs text-muted">
                    到期 {{ row.dueDate ?? '未设置' }}
                  </p>
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ money(row.payable) }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ money(row.paid) }}
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="INVOICE_STATUS[row.status]?.color ?? 'neutral'"
                    variant="soft"
                    size="sm"
                  >
                    {{ INVOICE_STATUS[row.status]?.label ?? row.status }}
                  </UBadge>
                </td>
                <td class="px-3 py-2">
                  <UButton
                    v-if="canWrite && row.status !== 'paid' && row.status !== 'void'"
                    size="xs"
                    variant="soft"
                    icon="i-lucide-wallet"
                    @click="openPayment(row)"
                  >
                    登记缴费
                  </UButton>
                  <span
                    v-else
                    class="text-xs text-muted"
                  >—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3 rounded-xl border border-default bg-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-highlighted">
            对账批次
          </h2>
          <span class="text-xs text-muted">
            按业务日期统计已登记收款，确认后留痕
          </span>
        </div>

        <div
          v-if="canWrite"
          class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label class="space-y-1 text-xs text-muted">
            <span>开始日期 *</span>
            <UInput
              v-model="reconciliationForm.periodStart"
              type="date"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>结束日期 *</span>
            <UInput
              v-model="reconciliationForm.periodEnd"
              type="date"
              class="w-full"
            />
          </label>
          <label class="space-y-1 text-xs text-muted">
            <span>支付方式</span>
            <USelect
              v-model="reconciliationForm.method"
              :items="[{ label: '全部方式', value: '' }, ...PAYMENT_METHODS]"
              value-key="value"
            />
          </label>
          <label class="space-y-1 text-xs text-muted lg:col-span-1">
            <span>备注</span>
            <UInput
              v-model="reconciliationForm.notes"
              placeholder="可选"
              class="w-full"
            />
          </label>
          <div class="flex items-end">
            <UButton
              class="w-full"
              :loading="saving"
              icon="i-lucide-file-check"
              @click="createReconciliation()"
            >
              生成批次
            </UButton>
          </div>
        </div>

        <div
          v-if="reconciliations.length === 0"
          class="rounded-lg border border-dashed border-default px-3 py-4 text-center text-xs text-muted"
        >
          暂无对账批次
        </div>
        <div
          v-else
          class="overflow-x-auto rounded-lg border border-default"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2">
                  区间
                </th>
                <th class="px-3 py-2">
                  方式
                </th>
                <th class="px-3 py-2">
                  笔数
                </th>
                <th class="px-3 py-2">
                  合计
                </th>
                <th class="px-3 py-2">
                  状态
                </th>
                <th class="px-3 py-2">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in reconciliations"
                :key="row.id"
                class="border-t border-default"
              >
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.periodStart }} ~ {{ row.periodEnd }}
                  <p
                    v-if="row.notes"
                    class="text-muted"
                  >
                    {{ row.notes }}
                  </p>
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.method ? METHOD_LABELS[row.method] ?? row.method : '全部方式' }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.paymentCount }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ money(row.totalAmount) }}
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="row.status === 'confirmed' ? 'success' : 'warning'"
                    variant="soft"
                    size="sm"
                  >
                    {{ row.status === 'confirmed' ? '已确认' : '草稿' }}
                  </UBadge>
                  <p
                    v-if="row.confirmedAt"
                    class="mt-1 text-[11px] text-muted"
                  >
                    {{ formatTime(row.confirmedAt) }}
                  </p>
                </td>
                <td class="px-3 py-2">
                  <UButton
                    v-if="canWrite && row.status === 'draft'"
                    size="xs"
                    variant="soft"
                    icon="i-lucide-lock"
                    @click="confirmReconciliation(row)"
                  >
                    确认对账
                  </UButton>
                  <span
                    v-else
                    class="text-xs text-muted"
                  >—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-2">
        <h2 class="text-sm font-medium text-highlighted">
          最近收款
        </h2>
        <div
          v-if="payments.length === 0"
          class="rounded-xl border border-default bg-default p-6 text-center text-sm text-muted"
        >
          暂无收款记录
        </div>
        <div
          v-else
          class="overflow-x-auto rounded-xl border border-default"
        >
          <table class="w-full text-left text-sm">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2">
                  时间
                </th>
                <th class="px-3 py-2">
                  学生
                </th>
                <th class="px-3 py-2">
                  收费项
                </th>
                <th class="px-3 py-2">
                  金额
                </th>
                <th class="px-3 py-2">
                  方式
                </th>
                <th class="px-3 py-2">
                  流水号
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in payments"
                :key="row.id"
                class="border-t border-default"
              >
                <td class="px-3 py-2 text-xs text-toned">
                  {{ formatTime(row.paidAt) }}
                </td>
                <td class="px-3 py-2">
                  <p class="text-highlighted">
                    {{ row.studentName ?? `#${row.studentId}` }}
                  </p>
                  <p class="font-mono text-xs text-muted">
                    {{ row.studentNo ?? '—' }}
                  </p>
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ row.feeName ?? `#${row.invoiceId}` }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ money(row.amount) }}
                </td>
                <td class="px-3 py-2 text-xs text-toned">
                  {{ METHOD_LABELS[row.method] ?? row.method }}
                </td>
                <td class="px-3 py-2 font-mono text-xs text-muted">
                  {{ row.reference ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
