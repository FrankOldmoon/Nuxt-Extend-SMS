<script setup lang="ts">
/**
 * One attendance status, coloured consistently everywhere.
 *
 * `late` is a warning rather than an error on purpose: the student was there,
 * and the school's attendance rate counts it as attended (see the module's
 * `attendance.ts`), so the badge must not read as a failure.
 */
const props = defineProps<{ status: string }>()
const { t } = useI18n()

const color = computed(() => {
  switch (props.status) {
    case 'present':
      return 'success' as const
    case 'late':
      return 'warning' as const
    case 'absent':
      return 'error' as const
    case 'leave':
      return 'info' as const
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
    :label="t(`sms.attendance.${props.status}`)"
  />
</template>
