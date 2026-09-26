<script setup lang="ts">
/**
 * A teacher submission's status.
 *
 * One component so "approved" is green on the review queue, on a course header
 * and in the gradebook's locked notice — and so the lock the API enforces is
 * always visible next to the grid it locks.
 */
const props = defineProps<{ status: string }>()
const { t } = useI18n()

const color = computed(() => {
  switch (props.status) {
    case 'approved':
      return 'success' as const
    case 'pending':
      return 'warning' as const
    case 'rejected':
      return 'error' as const
    default:
      return 'neutral' as const
  }
})
</script>

<template>
  <UBadge
    :color="color"
    variant="subtle"
    size="sm"
    :label="t(`sms.review.${props.status}`)"
  />
</template>
