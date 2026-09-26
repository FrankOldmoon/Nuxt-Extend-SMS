<script setup lang="ts">
/**
 * A mark, coloured against the school's own pass mark.
 *
 * The colour is the whole point: a 58 is red at a school that passes at 60 and
 * green at a school that passes at 50, and that decision belongs to one
 * component rather than to every table cell that prints a number.
 */
const props = withDefaults(defineProps<{
  mark: number | null | undefined
  passMark?: number
}>(), {
  passMark: 60
})

const { t } = useI18n()

const color = computed(() => {
  if (props.mark == null) return 'neutral' as const
  return passesMark(props.mark, props.passMark) ? 'success' as const : 'error' as const
})

const label = computed(() => props.mark == null ? t('sms.scores.notMarked') : formatMark(props.mark))
</script>

<template>
  <UBadge
    :color="color"
    variant="subtle"
    size="sm"
    :label="label"
  />
</template>
