<script setup lang="ts">
import type {
  SmsApprovalUi,
  SmsChatMessage,
  SmsChatUi,
  SmsFormUi,
  SmsResultUi
} from '../../composables/useSmsChat'

const props = defineProps<{
  messages: SmsChatMessage[]
  pendingFormId?: number | null
  pendingApprovalBatch?: string | null
  submitting?: boolean
}>()

const emit = defineEmits<{
  submitDraft: [draftId: number, payload: Record<string, unknown>]
  cancelDraft: [draftId: number]
  decide: [batchId: string, decision: 'approve' | 'reject']
}>()

function asForm(ui?: SmsChatUi): SmsFormUi | null {
  return ui?.kind === 'form' ? ui : null
}

function asApproval(ui?: SmsChatUi): SmsApprovalUi | null {
  return ui?.kind === 'approval' ? ui : null
}

function asResult(ui?: SmsChatUi): SmsResultUi | null {
  return ui?.kind === 'result' ? ui : null
}

const isPendingForm = (ui?: SmsChatUi) => asForm(ui)?.draftId === props.pendingFormId
const isPendingApproval = (ui?: SmsChatUi) => asApproval(ui)?.batchId === props.pendingApprovalBatch
</script>

<template>
  <div class="space-y-4">
    <template
      v-for="(message, index) in messages"
      :key="message.id ?? `local-${index}`"
    >
      <div
        v-if="message.role === 'user'"
        class="flex justify-end"
      >
        <div class="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-sm text-white">
          {{ message.content }}
        </div>
      </div>

      <div
        v-else
        class="max-w-[92%]"
      >
        <div
          v-if="message.content"
          class="whitespace-pre-wrap rounded-2xl border border-default bg-default px-3.5 py-2 text-sm leading-relaxed text-highlighted"
        >
          {{ message.content }}
        </div>

        <SmsToolCallCard
          v-for="call in message.toolCalls ?? []"
          :key="call.id"
          :card="call"
        />

        <template v-if="asForm(message.ui)">
          <ChatFormCard
            v-if="isPendingForm(message.ui)"
            :schema="asForm(message.ui)!.form"
            :initial="asForm(message.ui)!.initial"
            :preview="asForm(message.ui)!.preview"
            :submitting="submitting"
            @submit="emit('submitDraft', asForm(message.ui)!.draftId, $event)"
            @cancel="emit('cancelDraft', asForm(message.ui)!.draftId)"
          />
          <p
            v-else
            class="mt-2 text-[11px] text-muted"
          >
            表单已处理。
          </p>
        </template>

        <template v-else-if="asApproval(message.ui)">
          <SmsApprovalCard
            v-if="isPendingApproval(message.ui)"
            :approval="asApproval(message.ui)!"
            :submitting="submitting"
            @decide="emit('decide', asApproval(message.ui)!.batchId, $event)"
          />
          <p
            v-else
            class="mt-2 text-[11px] text-muted"
          >
            审批已处理。
          </p>
        </template>

        <div
          v-else-if="asResult(message.ui)"
          class="mt-2 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          <UIcon
            name="i-lucide-circle-check-big"
            class="mt-0.5 size-4 shrink-0"
          />
          <div class="min-w-0">
            <p class="font-medium">
              {{ asResult(message.ui)!.title }}
            </p>
            <p class="mt-0.5 break-words">
              {{ asResult(message.ui)!.summary }}
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
